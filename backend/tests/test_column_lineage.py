"""
Tests for the column-level lineage builder (app.dbt.column_lineage)
and the /api/projects/{id}/column-lineage endpoint.
"""

import json
from pathlib import Path

import pytest

from app.dbt.column_lineage import build_column_lineage, ColumnRef


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _write_manifest(tmp_path: Path, data: dict) -> Path:
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(data))
    return path


def _node(unique_id: str, compiled_sql: str = "", columns: dict | None = None) -> dict:
    return {
        "unique_id": unique_id,
        "name": unique_id.split(".")[-1],
        "resource_type": "model",
        "schema": "analytics",
        "database": "warehouse",
        "config": {"materialized": "table"},
        "tags": [],
        "description": "",
        "original_file_path": f"models/{unique_id.split('.')[-1]}.sql",
        "compiled_code": compiled_sql,
        "columns": columns or {},
    }


# ---------------------------------------------------------------------------
# Unit tests: build_column_lineage
# ---------------------------------------------------------------------------

def test_missing_manifest_returns_empty(tmp_path: Path) -> None:
    result = build_column_lineage(tmp_path / "manifest.json")
    assert result == {}


def test_invalid_json_returns_empty(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    path.write_text("not valid json{{{")
    result = build_column_lineage(path)
    assert result == {}


def test_no_yml_columns_lineage_computed_from_sql_alone(tmp_path: Path) -> None:
    """
    Goal A: lineage should be computed from compiled SQL alone — no yml
    `columns:` documentation required on either the parent or the child.
    """
    data = {
        "nodes": {
            "model.proj.stg_orders": _node(
                "model.proj.stg_orders",
                compiled_sql="SELECT id AS order_id FROM raw.orders",
                columns={},  # no yml docs
            ),
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT order_id FROM stg_orders",
                columns={},  # no yml docs
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)

    assert "model.proj.orders" in result
    refs = result["model.proj.orders"].get("order_id", [])
    assert len(refs) == 1
    assert refs[0] == ColumnRef(node="model.proj.stg_orders", column="order_id")


def test_select_star_falls_back_to_yml_columns(tmp_path: Path) -> None:
    """
    A top-level `SELECT *` can't be enumerated by sqlglot, so the column list
    should fall back to yml-documented columns when present.
    """
    data = {
        "nodes": {
            "model.proj.stg_orders": _node(
                "model.proj.stg_orders",
                compiled_sql="SELECT id AS order_id FROM raw.orders",
                columns={"order_id": {"description": "", "data_type": ""}},
            ),
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT * FROM stg_orders",
                columns={"order_id": {"description": "", "data_type": ""}},
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)

    assert "model.proj.orders" in result
    refs = result["model.proj.orders"].get("order_id", [])
    assert len(refs) == 1
    assert refs[0] == ColumnRef(node="model.proj.stg_orders", column="order_id")


def test_select_star_without_yml_produces_no_lineage_no_crash(tmp_path: Path) -> None:
    """
    A top-level `SELECT *` with no yml columns documented either can't be
    resolved at all — should produce no lineage for that node, without
    crashing.
    """
    data = {
        "nodes": {
            "model.proj.stg_orders": _node(
                "model.proj.stg_orders",
                compiled_sql="SELECT id AS order_id FROM raw.orders",
                columns={},
            ),
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT * FROM stg_orders",
                columns={},  # no yml fallback available either
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)
    assert "model.proj.orders" not in result


def test_simple_column_lineage(tmp_path: Path) -> None:
    """Column order_id in model B traces back to column order_id in model A."""
    data = {
        "nodes": {
            "model.proj.stg_orders": _node(
                "model.proj.stg_orders",
                compiled_sql="SELECT id AS order_id FROM raw.orders",
                columns={"order_id": {"description": "", "data_type": ""}},
            ),
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT order_id FROM stg_orders",
                columns={"order_id": {"description": "", "data_type": ""}},
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)

    assert "model.proj.orders" in result
    assert "order_id" in result["model.proj.orders"]
    refs = result["model.proj.orders"]["order_id"]
    assert len(refs) == 1
    assert refs[0] == ColumnRef(node="model.proj.stg_orders", column="order_id")


def test_column_rename_traced(tmp_path: Path) -> None:
    """order_id in child comes from id in parent (alias mapping)."""
    data = {
        "nodes": {
            "model.proj.stg_orders": _node(
                "model.proj.stg_orders",
                compiled_sql="SELECT id FROM raw.orders",
                columns={"id": {"description": "", "data_type": ""}},
            ),
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT stg_orders.id AS order_id FROM stg_orders",
                columns={"order_id": {"description": "", "data_type": ""}},
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)

    assert "model.proj.orders" in result
    refs = result["model.proj.orders"].get("order_id", [])
    assert len(refs) == 1
    assert refs[0].node == "model.proj.stg_orders"
    assert refs[0].column == "id"


def test_no_compiled_sql_skipped(tmp_path: Path) -> None:
    """Models without compiled SQL produce no column lineage."""
    data = {
        "nodes": {
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="",
                columns={"order_id": {"description": "", "data_type": ""}},
            ),
        },
        "sources": {},
        "parent_map": {},
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)
    assert result == {}


def test_column_not_in_parent_skipped(tmp_path: Path) -> None:
    """
    If the table referenced in SQL is not in parent_map, the leaf node is
    ignored (it could be a raw table, not a model).
    """
    data = {
        "nodes": {
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT id AS order_id FROM raw_orders",
                columns={"order_id": {"description": "", "data_type": ""}},
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": [],  # no parents registered
        },
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)
    # raw_orders is not a known parent, so no refs recorded
    assert result == {}


def test_result_cached_by_mtime(tmp_path: Path) -> None:
    """Calling build_column_lineage twice with same mtime returns the same object."""
    data = {
        "nodes": {
            "model.proj.stg": _node(
                "model.proj.stg",
                compiled_sql="SELECT id FROM raw_t",
                columns={"id": {"description": "", "data_type": ""}},
            ),
            "model.proj.final": _node(
                "model.proj.final",
                compiled_sql="SELECT id FROM stg",
                columns={"id": {"description": "", "data_type": ""}},
            ),
        },
        "sources": {},
        "parent_map": {"model.proj.final": ["model.proj.stg"]},
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result1 = build_column_lineage(path)
    result2 = build_column_lineage(path)
    # Same object from cache
    assert result1 is result2


def test_dialect_resolved_from_metadata(tmp_path: Path) -> None:
    """DuckDB adapter type is recognised without error."""
    data = {
        "nodes": {
            "model.proj.stg": _node(
                "model.proj.stg",
                compiled_sql="SELECT id FROM raw_t",
                columns={"id": {}},
            ),
            "model.proj.final": _node(
                "model.proj.final",
                compiled_sql="SELECT id FROM stg",
                columns={"id": {}},
            ),
        },
        "sources": {},
        "parent_map": {"model.proj.final": ["model.proj.stg"]},
        "metadata": {"adapter_type": "duckdb"},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)
    assert "model.proj.final" in result


def test_unknown_dialect_falls_back_gracefully(tmp_path: Path) -> None:
    """Unknown adapter type falls back to sqlglot default without crashing."""
    data = {
        "nodes": {
            "model.proj.stg": _node(
                "model.proj.stg",
                compiled_sql="SELECT id FROM raw_t",
                columns={"id": {}},
            ),
            "model.proj.final": _node(
                "model.proj.final",
                compiled_sql="SELECT id FROM stg",
                columns={"id": {}},
            ),
        },
        "sources": {},
        "parent_map": {"model.proj.final": ["model.proj.stg"]},
        "metadata": {"adapter_type": "my_custom_adapter"},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)
    # Should not raise; lineage may or may not be found depending on SQL compatibility
    assert isinstance(result, dict)


def test_case_normalizing_dialect_resolves_with_canonical_casing(tmp_path: Path) -> None:
    """
    Regression test: dialects like Snowflake normalize unquoted identifiers to
    uppercase internally in sqlglot. sg_lineage() then returns source_name /
    column names in that normalized case (e.g. 'STG_ORDERS', 'ORDERID'), which
    must NOT be compared case-sensitively against the manifest's original
    (lowercase, mixed-case) model/column names — that comparison silently
    failing broke 100% of lineage on Snowflake projects. The match must
    succeed case-insensitively, and the resulting ColumnRef.column must come
    back in the parent's own canonical casing ('orderId'), not sqlglot's
    dialect-normalized spelling ('ORDERID').
    """
    data = {
        "nodes": {
            "model.proj.stg_orders": _node(
                "model.proj.stg_orders",
                # No yml columns — column list is SQL-derived, giving 'orderId'
                # (mixed case) as the canonical spelling for this parent.
                compiled_sql="SELECT id AS orderId FROM raw.orders",
                columns={},
            ),
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT orderId FROM stg_orders",
                columns={},
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {"adapter_type": "snowflake"},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)

    assert "model.proj.orders" in result
    refs = result["model.proj.orders"].get("orderId", [])
    assert len(refs) == 1
    assert refs[0].node == "model.proj.stg_orders"
    # Canonical casing from the parent's own column list, not sqlglot's
    # dialect-uppercased 'ORDERID'.
    assert refs[0].column == "orderId"


def test_unpivot_does_not_block_non_pivoted_columns(tmp_path: Path) -> None:
    """
    Regression test: an UNPIVOT in the FROM clause made sqlglot treat the
    whole table as an opaque leaf, blocking lineage for *every* projected
    column in that outer select — not just the genuinely-pivoted ones. Only
    the pivoted output columns (which fan in from multiple source columns and
    have no single upstream) should be excluded; every other column must
    still resolve through to the base CTE.
    """
    data = {
        "nodes": {
            "model.proj.stg_metrics": _node(
                "model.proj.stg_metrics",
                compiled_sql=(
                    "SELECT region, unique_visitors, visits FROM raw.metrics"
                ),
                columns={},
            ),
            "model.proj.unpivoted": _node(
                "model.proj.unpivoted",
                compiled_sql=(
                    "SELECT region, lower(metric) AS metric, metric_value "
                    "FROM stg_metrics "
                    "UNPIVOT (metric_value FOR metric IN (unique_visitors, visits))"
                ),
                columns={},
            ),
        },
        "sources": {},
        "parent_map": {
            "model.proj.unpivoted": ["model.proj.stg_metrics"],
        },
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)

    assert "model.proj.unpivoted" in result
    col_lineage = result["model.proj.unpivoted"]

    # The non-pivoted column resolves through the UNPIVOT to the base CTE.
    assert "region" in col_lineage
    refs = col_lineage["region"]
    assert len(refs) == 1
    assert refs[0].node == "model.proj.stg_metrics"
    assert refs[0].column == "region"

    # The genuinely-pivoted output columns have no single upstream column —
    # correctly absent, not crashed and not wrongly resolved.
    assert "metric" not in col_lineage
    assert "metric_value" not in col_lineage


# ---------------------------------------------------------------------------
# Integration test: /api/projects/{id}/models includes column metadata
#
# (The /api/projects/{id}/column-lineage endpoint tests live in
# test_api_column_lineage.py, alongside the /column-lineage/start endpoint.)
# ---------------------------------------------------------------------------

from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from app.db.models import Base, Project
from app.db.engine import get_session
from app.main import app


@pytest.fixture
async def db_session(tmp_path):
    """Provides a fresh in-memory DB session and overrides the FastAPI DI."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _get_session():
        async with SessionLocal() as s:
            yield s

    app.dependency_overrides[get_session] = _get_session
    async with SessionLocal() as session:
        yield session
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


async def _seed_project(session: AsyncSession, path: str) -> int:
    """Insert a project row and return its id."""
    proj = Project(name="test_proj", path=path, platform="local")
    session.add(proj)
    await session.commit()
    await session.refresh(proj)
    return proj.id


async def test_graph_endpoint_includes_columns(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """The /models graph endpoint should now include column metadata."""
    manifest_data = {
        "nodes": {
            "model.proj.orders": {
                "unique_id": "model.proj.orders",
                "name": "orders",
                "resource_type": "model",
                "schema": "analytics",
                "database": "wh",
                "config": {"materialized": "table"},
                "tags": [],
                "description": "",
                "original_file_path": "models/orders.sql",
                "compiled_code": "SELECT order_id FROM raw.orders",
                "columns": {
                    "order_id": {"description": "The order PK", "data_type": "bigint"},
                    "status": {"description": "", "data_type": "varchar"},
                },
            },
        },
        "sources": {},
        "parent_map": {},
        "metadata": {},
    }
    proj_dir = tmp_path / "proj2"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    (target / "manifest.json").write_text(json.dumps(manifest_data))
    pid = await _seed_project(db_session, str(proj_dir))

    r = await client.get(f"/api/projects/{pid}/models")
    assert r.status_code == 200
    nodes = r.json()["nodes"]
    assert len(nodes) == 1
    columns = nodes[0]["columns"]
    assert len(columns) == 2
    col_names = {c["name"] for c in columns}
    assert col_names == {"order_id", "status"}
    order_id_col = next(c for c in columns if c["name"] == "order_id")
    assert order_id_col["description"] == "The order PK"
    assert order_id_col["data_type"] == "bigint"
