"""
Integration test: /api/projects/{id}/models includes column metadata.

This is separate from the column-lineage TRACING algorithm's own tests
(moved to the private dbt-ui-pro repo — see the open-core split discussed
when the Pro licensing feature was added) because it tests yml-documented
column metadata surfaced by the /models graph endpoint, not sqlglot-based
cross-model lineage tracing — it never touches app.dbt.column_lineage at
all, so it doesn't need dbt_ui_pro installed to run.

The /api/projects/{id}/column-lineage endpoint's own tests (including
entitlement gating) live in test_api_column_lineage.py.

Uses the autouse `override_db` fixture from conftest.py for the DB — no
need to declare it or build a second engine/session here.
"""

import json
from pathlib import Path

from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project
from app.main import app


async def test_graph_endpoint_includes_columns(tmp_path: Path) -> None:
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

    session_gen = app.dependency_overrides[get_session]()
    session: AsyncSession = await session_gen.__anext__()
    proj = Project(name="test_proj", path=str(proj_dir), platform="local")
    session.add(proj)
    await session.commit()
    await session.refresh(proj)
    pid = proj.id

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
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
