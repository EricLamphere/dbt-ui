"""
Column-level lineage builder using sqlglot.

Strategy (SQL-first):
- For each model node, use compiled_code from the manifest (requires dbt compile
  to have been run).  Models without compiled SQL are skipped — Jinja-stripped raw
  SQL produces unreliable lineage because macro expansions, conditional blocks, and
  Jinja variables in SQL expressions are impossible to recover accurately.
- Derive each model's column list by parsing the compiled SQL's outer SELECT with
  sqlglot (`named_selects`) — this means models are eligible for lineage even when
  they have no yml `columns:` documentation at all.  yml-documented columns are
  used only as a fallback when the SQL parse can't determine an explicit column
  list (e.g. a top-level `SELECT *`, or when parsing fails).
- Replace fully-qualified relation names with short model names so sqlglot sees
  'stg_customers' rather than '"db"."schema"."stg_customers"'.
- Build a column-stub SELECT for each parent model so sqlglot can resolve column
  names without recursing into full parent SQL.
- Use sqlglot.lineage.lineage() with these stubs as `sources`.
- Match lineage nodes back to parent unique_ids via source_name.

Result shape:
  {unique_id: {column_name: [ColumnRef(node=parent_uid, column=parent_col_name)]}}

Work is split into two phases so the CPU-heavy part can be fanned out across a
ProcessPoolExecutor (see api/column_lineage.py):
  - prepare_lineage_jobs() / _prepare_jobs_from_data(): cheap manifest parsing +
    per-model job assembly (no sqlglot.lineage calls).
  - trace_job(): the actual per-model sqlglot.lineage.lineage() tracing. This is
    a plain module-level function so it can be pickled and submitted to a
    ProcessPoolExecutor.

build_column_lineage() remains a synchronous, in-process, single-source-of-truth
entry point (used directly by tests and any caller that just wants the full
result computed inline) — it shares the same prepare/trace logic, just without
a pool.

build_column_lineage() results are cached in-process by manifest path + mtime.
"""

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.logging_setup import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class ColumnRef:
    node: str    # unique_id of the upstream model
    column: str  # column name in the upstream model


@dataclass(frozen=True)
class LineageJob:
    """Everything trace_job() needs to compute lineage for one model's columns.

    Kept flat and made of only plain str/tuple/dict values so instances can be
    pickled across a ProcessPoolExecutor boundary cheaply.
    """
    uid: str
    columns: tuple[str, ...]
    sql: str
    dialect: str | None
    parent_short_names: tuple[str, ...]
    name_to_uid: dict[str, str]
    sources: dict[str, str]
    # short_name -> canonical (as-documented/derived) column names for that parent.
    # Used to restore correct-case column names after a case-insensitive match —
    # dialects like Snowflake normalize unquoted identifiers to uppercase, so
    # sqlglot's resolved names don't match the manifest's original casing.
    parent_columns: dict[str, tuple[str, ...]] = field(default_factory=dict)
    name: str = field(default="")  # short model name, for progress display


_cache: dict[str, tuple[float, dict[str, dict[str, list[ColumnRef]]]]] = {}


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


def _derive_sql_columns(
    sql: str, dialect: str | None, parsed: Any = None
) -> tuple[list[str] | None, Any]:
    """
    Parse (or reuse an already-parsed tree for) the outer SELECT of `sql` and
    return its projected column names, in order, alongside the parsed tree so
    callers doing further AST work (e.g. UNPIVOT stripping) don't need a
    second parse of the same SQL.

    Returns (None, tree) if the column list can't be fully determined — e.g. a
    top-level `SELECT *` (sqlglot reports a literal '*' entry), or (None, None)
    if parsing fails outright. Callers should fall back to yml-documented
    columns in either case.
    """
    try:
        import sqlglot as sg
        tree = parsed if parsed is not None else sg.parse_one(sql, dialect=dialect)
        if tree is None:
            return None, None
        cols = list(tree.named_selects)
        if not cols or any(c in ("", "*") for c in cols):
            return None, tree
        return cols, tree
    except Exception:
        return None, None


def _strip_unpivot(parsed: Any) -> tuple[Any, set[str]]:
    """
    If the outer SELECT's FROM has an UNPIVOT modifier, remove it and drop the
    SELECT projections whose output column is produced by the unpivot (no
    single upstream column exists for those — they fan in from multiple
    source columns). Returns (possibly unmodified) parsed expr + the set of
    dropped output column names (case as written in the SQL).

    Without this, sqlglot's lineage() treats the pivoted table as an opaque
    leaf and refuses to trace *any* column from the outer select — not just
    the genuinely-pivoted ones — since it can't resolve the FROM clause at
    all. Only handles UNPIVOT, not PIVOT (rarer here, reshapes wide, more
    complex — left as an opaque leaf, no regression, just not improved).
    """
    from sqlglot import exp

    if not isinstance(parsed, exp.Select):
        return parsed, set()
    # sqlglot's arg key for the FROM clause has varied across versions
    # ("from_" vs "from") — check both defensively.
    from_expr = parsed.args.get("from_") or parsed.args.get("from")
    table = from_expr.this if from_expr else None
    if not isinstance(table, exp.Table):
        return parsed, set()
    pivots = table.args.get("pivots") or []
    unpivots = [p for p in pivots if p.args.get("unpivot")]
    if not unpivots:
        return parsed, set()

    produced: set[str] = set()
    for p in unpivots:
        for value_col in p.args.get("expressions") or []:
            if isinstance(value_col, exp.Column):
                produced.add(value_col.name)
        for pivot_field in p.args.get("fields") or []:
            name_col = pivot_field.this if isinstance(pivot_field, exp.In) else None
            if isinstance(name_col, exp.Column):
                produced.add(name_col.name)
    if not produced:
        return parsed, set()

    stripped = parsed.copy()
    stripped_from = stripped.args.get("from_") or stripped.args.get("from")
    stripped_table = stripped_from.this
    remaining = [p for p in (stripped_table.args.get("pivots") or []) if not p.args.get("unpivot")]
    stripped_table.set("pivots", remaining or None)
    kept = [e for e in stripped.expressions if e.alias_or_name not in produced]
    stripped.set("expressions", kept)
    return stripped, produced


def _prepare_jobs_from_data(data: dict[str, Any]) -> list[LineageJob]:
    adapter_type: str | None = (data.get("metadata") or {}).get("adapter_type")
    dialect = _resolve_dialect(adapter_type)

    raw_nodes: dict[str, Any] = {**data.get("nodes", {}), **data.get("sources", {})}
    parent_map: dict[str, list[str]] = data.get("parent_map") or {}

    short_names: dict[str, str] = {}          # uid → short name
    rel_to_short: dict[str, str] = {}         # relation_name → short name
    node_sql: dict[str, str] = {}             # uid → compiled SQL (has real upstream deps)
    node_columns_yml: dict[str, list[str]] = {}  # uid → documented yml column names

    for uid, raw in raw_nodes.items():
        name = raw.get("name") or uid.split(".")[-1]
        short_names[uid] = name

        rel = raw.get("relation_name") or ""
        if rel:
            rel_to_short[rel] = name

        # Only use compiled SQL — Jinja-stripped raw SQL produces unreliable lineage
        # because stripped Jinja leaves broken expressions that confuse sqlglot's
        # optimizer (unknown columns, invalid date literals, macro expansions, etc.).
        # If the project hasn't been compiled yet, compiled_code will be absent and
        # lineage will simply be skipped for those nodes.
        sql = raw.get("compiled_code") or raw.get("compiled_sql") or ""

        cols = list((raw.get("columns") or {}).keys())
        if cols:
            node_columns_yml[uid] = cols

        if sql:
            node_sql[uid] = sql

    name_to_uid: dict[str, str] = {v: k for k, v in short_names.items()}

    # Normalize compiled SQL (fully-qualified → short names) and derive each
    # node's effective column list: SQL-parsed first, yml-documented as fallback.
    node_norm_sql: dict[str, str] = {}
    node_columns_effective: dict[str, list[str]] = {}

    for uid, sql in node_sql.items():
        normalized = _normalize_sql(sql, rel_to_short)

        # Parse once (if it parses at all) and reuse the tree for both the
        # UNPIVOT check and column derivation below — avoids a second full
        # parse of the same SQL. Models without a pivot (the vast majority)
        # only pay for one already-necessary parse plus a cheap attribute
        # check in _strip_unpivot.
        try:
            import sqlglot as sg
            parsed = sg.parse_one(normalized, dialect=dialect)
        except Exception:
            parsed = None

        produced: set[str] = set()
        if parsed is not None:
            parsed, produced = _strip_unpivot(parsed)
            if produced:
                try:
                    normalized = parsed.sql(dialect=dialect or "")
                except Exception:
                    # Re-rendering the stripped tree failed — don't trust the
                    # exclusion set against SQL we're not actually using.
                    produced = set()

        node_norm_sql[uid] = normalized

        sql_cols, _tree = _derive_sql_columns(normalized, dialect, parsed=parsed)
        if sql_cols is not None:
            if produced:
                # _strip_unpivot already removed these projections from the
                # parsed tree, so named_selects should already exclude them —
                # this is a defensive belt-and-suspenders filter.
                sql_cols = [c for c in sql_cols if c not in produced]
            node_columns_effective[uid] = sql_cols
        elif uid in node_columns_yml:
            node_columns_effective[uid] = node_columns_yml[uid]
        # else: column list undeterminable (e.g. bare `SELECT *` with no yml
        # docs) — this node won't get its own lineage traced, but it may still
        # be usable as a parent stub via its full (CTE-stripped) compiled SQL.

    # Nodes with no compiled SQL at all (seeds, sources) fall back to yml
    # columns directly and get a synthetic no-FROM stub so they can still act
    # as a resolvable source for downstream models.
    for uid, cols in node_columns_yml.items():
        if uid not in node_sql:
            node_columns_effective[uid] = cols
            node_norm_sql[uid] = "SELECT " + ", ".join(cols)

    jobs: list[LineageJob] = []
    for uid, sql in node_sql.items():
        columns = node_columns_effective.get(uid)
        if not columns:
            continue

        parent_uids = parent_map.get(uid, [])
        parent_short_names = {short_names[p] for p in parent_uids if p in short_names}
        if not parent_short_names:
            continue

        # Build sources: short_name → SQL stub for sqlglot to resolve columns against.
        # Prefer a simple "SELECT col1, col2" stub from the parent's effective
        # columns (SQL-derived or yml) — this is recursion-safe and gives
        # sqlglot exactly what it needs. Full compiled SQL (even CTE-stripped)
        # can cause sqlglot to recurse into dangling CTE references and blow
        # Python's stack on complex models. Fall back to stripped compiled SQL
        # only when the parent's columns couldn't be determined at all.
        sources: dict[str, str] = {}
        parent_columns: dict[str, tuple[str, ...]] = {}
        for p in parent_uids:
            pname = short_names.get(p)
            if not pname:
                continue
            pcols = node_columns_effective.get(p)
            if pcols:
                sources[pname] = "SELECT " + ", ".join(pcols)
                parent_columns[pname] = tuple(pcols)
                continue
            psql = node_norm_sql.get(p)
            if not psql:
                continue
            source_sql = _strip_ctes(psql, dialect) or psql
            sources[pname] = source_sql
            # No known canonical column list for this fallback (full/CTE-stripped
            # SQL, used only when the parent's own columns couldn't be determined)
            # — _trace_column falls back to sqlglot's dialect-cased spelling.

        jobs.append(LineageJob(
            uid=uid,
            columns=tuple(columns),
            sql=node_norm_sql[uid],
            dialect=dialect,
            parent_short_names=tuple(sorted(parent_short_names)),
            name_to_uid=name_to_uid,
            sources=sources,
            parent_columns=parent_columns,
            name=short_names.get(uid, uid),
        ))

    return jobs


def prepare_lineage_jobs(manifest_path: Path) -> list[LineageJob]:
    """Read + parse the manifest and build the list of per-model lineage jobs.

    This is the "fast prep" phase — no sqlglot.lineage.lineage() calls happen
    here, only cheap parsing of each model's outer SELECT to enumerate its
    projected columns. Safe to run in a thread executor from the event loop.
    """
    try:
        data: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("column_lineage_manifest_read_failed", path=str(manifest_path), error=str(exc))
        return []
    return _prepare_jobs_from_data(data)


def trace_job(job: LineageJob) -> tuple[str, dict[str, list[ColumnRef]]]:
    """Compute lineage for every column in one model. Module-level so it can be
    pickled and submitted to a ProcessPoolExecutor."""
    col_lineage: dict[str, list[ColumnRef]] = {}

    # Lowercase once per job (not per column) — dialects that normalize
    # unquoted identifiers to a different case than the manifest's original
    # names (e.g. sqlglot uppercases for dialect="snowflake", matching real
    # Snowflake semantics) would otherwise never match parent_short_names /
    # name_to_uid, silently breaking every trace on that dialect.
    parent_short_names_lower = {p.lower() for p in job.parent_short_names}
    name_to_uid_lower = {k.lower(): v for k, v in job.name_to_uid.items()}
    parent_columns_lower = {
        short_name.lower(): {c.lower(): c for c in cols}
        for short_name, cols in job.parent_columns.items()
    }

    for col_name in job.columns:
        refs = _trace_column(
            col_name, job.sql, job.dialect,
            parent_short_names_lower, name_to_uid_lower, job.sources, parent_columns_lower,
        )
        if refs:
            col_lineage[col_name] = refs
    return job.uid, col_lineage


def build_column_lineage(
    manifest_path: Path,
) -> dict[str, dict[str, list[ColumnRef]]]:
    """Synchronous, in-process, no-pool computation of lineage for every model
    in the manifest. Shares job-prep/trace logic with the parallel API path.
    """
    import sys
    import logging as _logging
    # This may run in a subprocess — configure its root logger so debug output is visible.
    _logging.basicConfig(level=_logging.DEBUG, format="%(levelname)s %(name)s %(message)s")
    # sqlglot's lineage optimizer can recurse very deeply on complex compiled SQL.
    sys.setrecursionlimit(5000)

    try:
        mtime = manifest_path.stat().st_mtime
    except OSError:
        return {}

    cache_key = str(manifest_path)
    if cache_key in _cache and _cache[cache_key][0] == mtime:
        return _cache[cache_key][1]

    jobs = prepare_lineage_jobs(manifest_path)

    result: dict[str, dict[str, list[ColumnRef]]] = {}
    for job in jobs:
        uid, col_lineage = trace_job(job)
        if col_lineage:
            result[uid] = col_lineage

    _cache[cache_key] = (mtime, result)
    return result


def _resolve_dialect(adapter_type: str | None) -> str | None:
    if not adapter_type:
        return None
    # Explicit mappings for adapters whose name doesn't match the sqlglot dialect name.
    _aliases = {
        "athena": "trino",   # AWS Athena is based on Trino
        "glue": "spark",     # AWS Glue uses Spark SQL
        "synapse": "tsql",   # Azure Synapse uses T-SQL
        "fabric": "tsql",
    }
    lower = adapter_type.lower()
    if lower in _aliases:
        return _aliases[lower]
    _known = {
        "bigquery", "duckdb", "hive", "mysql", "postgres", "presto",
        "redshift", "snowflake", "spark", "sqlite", "starrocks",
        "teradata", "trino", "tsql",
    }
    for known in _known:
        if known in lower:
            return known
    return None


def _trace_column(
    col_name: str,
    sql: str,
    dialect: str | None,
    parent_short_names_lower: set[str],
    name_to_uid_lower: dict[str, str],
    sources: dict[str, str],
    parent_columns_lower: dict[str, dict[str, str]],
) -> list[ColumnRef]:
    try:
        from sqlglot.lineage import lineage as sg_lineage

        node = sg_lineage(col_name, sql, dialect=dialect, sources=sources,
                          validate_qualify_columns=False)
        refs: list[ColumnRef] = []
        seen: set[tuple[str, str]] = set()

        found_source_names: set[str] = set()
        for ln in node.walk():
            # source_name identifies which named source this column came from.
            # Compared case-insensitively: dialects sqlglot case-normalizes
            # (e.g. Snowflake → uppercase) return a different case than the
            # manifest's original model names, so a case-sensitive match here
            # would silently break every trace on those dialects.
            raw_sname = ln.source_name or ""
            # Normalize: strip quotes, take last segment (handles qualified names)
            table_name = raw_sname.replace('"', '').split(".")[-1]
            table_name_lower = table_name.lower()
            if table_name_lower:
                found_source_names.add(table_name_lower)
            if not table_name_lower or table_name_lower not in parent_short_names_lower:
                continue
            parent_uid = name_to_uid_lower.get(table_name_lower)
            if parent_uid is None:
                continue
            upstream_col_raw = (ln.name or col_name).split(".")[-1]
            # Restore the parent's canonical (documented/derived) column
            # casing — sqlglot's resolved name may be dialect-normalized-case,
            # but downstream consumers need the real column name to correlate
            # against that node's own column list.
            canon = parent_columns_lower.get(table_name_lower, {})
            upstream_col = canon.get(upstream_col_raw.lower(), upstream_col_raw)
            key = (parent_uid, upstream_col)
            if key not in seen:
                seen.add(key)
                refs.append(ColumnRef(node=parent_uid, column=upstream_col))

        if not refs and parent_short_names_lower:
            log.debug(
                "column_lineage_no_refs",
                col=col_name,
                expected_parents=parent_short_names_lower,
                found_source_names=found_source_names,
            )
        return refs

    except Exception as exc:
        log.debug("column_lineage_parse_failed", col=col_name, error=str(exc))
        return []
