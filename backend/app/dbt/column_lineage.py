"""
Column-level lineage builder using sqlglot.

Strategy:
- For each model node, normalize its SQL (strip Jinja; replace fully-qualified
  relation names with short model names).
- Build a column-stub SELECT for each parent model (SELECT col1, col2 FROM x)
  so sqlglot can resolve column names without recursing into full parent SQL.
- Use sqlglot.lineage.lineage() with these stubs as `sources`.
- Match lineage nodes back to parent unique_ids via source_name.

Result shape:
  {unique_id: {column_name: [ColumnRef(node=parent_uid, column=parent_col_name)]}}

Cached in-process by manifest path + mtime.
"""

import json
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

_RE_CONFIG_BLOCK = re.compile(r"\{\{[\s\S]*?config\([\s\S]*?\)\s*\}\}", re.DOTALL)
_RE_JINJA_TAG = re.compile(r"\{%-?\s.*?-?%\}", re.DOTALL)
_RE_REF = re.compile(r"""\{\{\s*ref\(['"](\w+)['"]\)\s*\}\}""")
_RE_SOURCE = re.compile(r"""\{\{\s*source\(['"][^'"]+['"],\s*['"](\w+)['"]\)\s*\}\}""")
_RE_JINJA_EXPR = re.compile(r"\{\{[^}]*\}\}")


@dataclass(frozen=True)
class ColumnRef:
    node: str    # unique_id of the upstream model
    column: str  # column name in the upstream model


_cache: dict[str, tuple[float, dict[str, dict[str, list[ColumnRef]]]]] = {}


def _strip_jinja(sql: str) -> str:
    sql = _RE_CONFIG_BLOCK.sub("", sql)
    sql = _RE_JINJA_TAG.sub("", sql)
    sql = _RE_REF.sub(r"\1", sql)
    sql = _RE_SOURCE.sub(r"\1", sql)
    sql = _RE_JINJA_EXPR.sub("NULL", sql)
    return sql.strip()


def _normalize_sql(sql: str, rel_to_short: dict[str, str]) -> str:
    """Replace fully-qualified relation_names with short model names, longest first."""
    for rel in sorted(rel_to_short, key=len, reverse=True):
        sql = sql.replace(rel, rel_to_short[rel])
    return sql


def _strip_ctes(sql: str, dialect: str | None) -> str | None:
    """
    Return just the final SELECT from a CTE model (strip the WITH clause).
    This prevents sqlglot from recursing into grandparent CTEs when the SQL
    is used as a source for a downstream model's lineage call.
    Returns None if parsing fails.
    """
    try:
        import sqlglot as sg
        parsed = sg.parse_one(sql, dialect=dialect)
        if parsed is None:
            return None
        stripped = parsed.copy()
        stripped.set("with_", None)
        return stripped.sql(dialect=dialect or "")
    except Exception:
        return None


def build_column_lineage(
    manifest_path: Path,
) -> dict[str, dict[str, list[ColumnRef]]]:
    try:
        mtime = manifest_path.stat().st_mtime
    except OSError:
        return {}

    cache_key = str(manifest_path)
    if cache_key in _cache and _cache[cache_key][0] == mtime:
        return _cache[cache_key][1]

    try:
        data: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("column_lineage_manifest_read_failed path=%s error=%s", manifest_path, exc)
        return {}

    adapter_type: str | None = (data.get("metadata") or {}).get("adapter_type")
    dialect = _resolve_dialect(adapter_type)

    raw_nodes: dict[str, Any] = {**data.get("nodes", {}), **data.get("sources", {})}
    parent_map: dict[str, list[str]] = data.get("parent_map") or {}

    short_names: dict[str, str] = {}         # uid → short name
    rel_to_short: dict[str, str] = {}        # relation_name → short name
    node_sql: dict[str, str] = {}            # uid → best available SQL (compiled or jinja-stripped raw)
    node_columns: dict[str, list[str]] = {}  # uid → documented column names

    for uid, raw in raw_nodes.items():
        name = raw.get("name") or uid.split(".")[-1]
        short_names[uid] = name

        rel = raw.get("relation_name") or ""
        if rel:
            rel_to_short[rel] = name

        sql = raw.get("compiled_code") or raw.get("compiled_sql") or ""
        if not sql:
            raw_sql = raw.get("raw_code") or raw.get("raw_sql") or ""
            if raw_sql:
                sql = _strip_jinja(raw_sql)

        cols = list((raw.get("columns") or {}).keys())
        if cols:
            node_columns[uid] = cols

        # Seeds and sources have no SQL — synthesize a stub so sqlglot can
        # resolve columns through them when they appear as upstream sources.
        # No FROM clause: avoids circular expansion when the stub is itself
        # referenced by a CTE that selects from the same name.
        if not sql and cols:
            col_list = ", ".join(cols)
            sql = f"SELECT {col_list}"

        if sql:
            node_sql[uid] = sql

    name_to_uid: dict[str, str] = {v: k for k, v in short_names.items()}

    result: dict[str, dict[str, list[ColumnRef]]] = {}

    for uid, columns in node_columns.items():
        sql = node_sql.get(uid)
        if not sql:
            continue

        # Normalize: replace fully-qualified names → short names so sqlglot sees 'stg_customers'
        sql = _normalize_sql(sql, rel_to_short)

        parent_uids = parent_map.get(uid, [])
        parent_short_names = {short_names[p] for p in parent_uids if p in short_names}

        # Build sources: short_name → parent's CTE-stripped final SELECT.
        # Stripping the WITH clause prevents sqlglot from recursing into
        # grandparent CTEs, while still exposing the full column list.
        sources: dict[str, str] = {}
        for p in parent_uids:
            pname = short_names.get(p)
            psql = node_sql.get(p)
            if not pname or not psql:
                continue
            normalized = _normalize_sql(psql, rel_to_short)
            source_sql = _strip_ctes(normalized, dialect) or normalized
            sources[pname] = source_sql

        col_lineage: dict[str, list[ColumnRef]] = {}
        for col_name in columns:
            refs = _trace_column(col_name, sql, dialect, parent_short_names, name_to_uid, sources)
            if refs:
                col_lineage[col_name] = refs

        if col_lineage:
            result[uid] = col_lineage

    _cache[cache_key] = (mtime, result)
    return result


def _resolve_dialect(adapter_type: str | None) -> str | None:
    if not adapter_type:
        return None
    _known = {
        "bigquery", "duckdb", "hive", "mysql", "postgres", "presto",
        "redshift", "snowflake", "spark", "sqlite", "starrocks",
        "teradata", "trino", "tsql",
    }
    lower = adapter_type.lower()
    for known in _known:
        if known in lower:
            return known
    return None


def _trace_column(
    col_name: str,
    sql: str,
    dialect: str | None,
    parent_short_names: set[str],
    name_to_uid: dict[str, str],
    sources: dict[str, str],
) -> list[ColumnRef]:
    try:
        from sqlglot.lineage import lineage as sg_lineage

        node = sg_lineage(col_name, sql, dialect=dialect, sources=sources)
        refs: list[ColumnRef] = []
        seen: set[tuple[str, str]] = set()

        for ln in node.walk():
            # source_name identifies which named source this column came from
            raw_sname = ln.source_name or ""
            # Normalize: strip quotes, take last segment (handles qualified names)
            table_name = raw_sname.replace('"', '').split(".")[-1]
            if not table_name or table_name not in parent_short_names:
                continue
            parent_uid = name_to_uid.get(table_name)
            if parent_uid is None:
                continue
            upstream_col = (ln.name or col_name).split(".")[-1]
            key = (parent_uid, upstream_col)
            if key not in seen:
                seen.add(key)
                refs.append(ColumnRef(node=parent_uid, column=upstream_col))

        return refs

    except Exception as exc:
        log.debug("column_lineage_parse_failed col=%s error=%s", col_name, exc)
        return []
