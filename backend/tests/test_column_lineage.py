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


def test_no_columns_documented_returns_empty(tmp_path: Path) -> None:
    data = {
        "nodes": {
            "model.proj.orders": _node(
                "model.proj.orders",
                compiled_sql="SELECT id FROM stg_orders",
                columns={},
            ),
        },
        "sources": {},
        "parent_map": {},
        "metadata": {},
    }
    path = _write_manifest(tmp_path, data)
    result = build_column_lineage(path)
    # No documented columns → no lineage
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


# ---------------------------------------------------------------------------
# Integration tests: /api/projects/{id}/column-lineage endpoint
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


async def test_column_lineage_endpoint_no_manifest(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    proj_dir = tmp_path / "empty_proj"
    proj_dir.mkdir()
    pid = await _seed_project(db_session, str(proj_dir))

    r = await client.get(f"/api/projects/{pid}/column-lineage")
    assert r.status_code == 200
    assert r.json() == {"lineage": {}}


async def test_column_lineage_endpoint_returns_lineage(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    manifest_data = {
        "nodes": {
            "model.proj.stg_orders": {
                "unique_id": "model.proj.stg_orders",
                "name": "stg_orders",
                "resource_type": "model",
                "schema": "staging",
                "database": "wh",
                "config": {"materialized": "view"},
                "tags": [],
                "description": "",
                "original_file_path": "models/stg_orders.sql",
                "compiled_code": "SELECT id AS order_id FROM raw.orders",
                "columns": {"order_id": {"description": "", "data_type": "bigint"}},
            },
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
                "compiled_code": "SELECT order_id FROM stg_orders",
                "columns": {"order_id": {"description": "", "data_type": "bigint"}},
            },
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {},
    }
    proj_dir = tmp_path / "proj"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    (target / "manifest.json").write_text(json.dumps(manifest_data))
    pid = await _seed_project(db_session, str(proj_dir))

    r = await client.get(f"/api/projects/{pid}/column-lineage")
    assert r.status_code == 200
    body = r.json()
    lineage = body["lineage"]

    assert "model.proj.orders" in lineage
    assert "order_id" in lineage["model.proj.orders"]
    refs = lineage["model.proj.orders"]["order_id"]
    assert len(refs) == 1
    assert refs[0]["node"] == "model.proj.stg_orders"
    assert refs[0]["column"] == "order_id"


async def test_column_lineage_endpoint_404(client: AsyncClient) -> None:
    r = await client.get("/api/projects/999999/column-lineage")
    assert r.status_code == 404


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
