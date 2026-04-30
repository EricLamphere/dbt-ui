import json
import textwrap
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport

from app.config import settings
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _make_project_with_manifest(root: Path, name: str = "test_project") -> tuple[Path, int]:
    """Returns (project_dir, project_id) after seeding DB."""
    d = root / name
    d.mkdir(parents=True)
    (d / "dbt_project.yml").write_text(
        textwrap.dedent(f"name: {name}\nprofile: p\nversion: '1.0'\n")
    )
    target = d / "target"
    target.mkdir()
    manifest = {
        "nodes": {
            "model.proj.orders": {
                "unique_id": "model.proj.orders",
                "name": "orders",
                "resource_type": "model",
                "schema": "analytics",
                "database": "warehouse",
                "config": {"materialized": "table"},
                "tags": [],
                "description": "Orders table",
                "original_file_path": "models/orders.sql",
            },
            "model.proj.customers": {
                "unique_id": "model.proj.customers",
                "name": "customers",
                "resource_type": "model",
                "schema": "analytics",
                "database": "warehouse",
                "config": {"materialized": "view"},
                "tags": ["pii"],
                "description": "",
                "original_file_path": "models/customers.sql",
            },
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.customers"],
        },
    }
    (target / "manifest.json").write_text(json.dumps(manifest))
    return d, 0  # ID assigned after rescan


async def test_models_no_manifest(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dbt_projects_path", tmp_path)
    (tmp_path / "proj").mkdir()
    (tmp_path / "proj" / "dbt_project.yml").write_text("name: empty\nprofile: p\n")
    list_resp = await client.post("/api/projects/rescan")
    pid = list_resp.json()[0]["id"]
    resp = await client.get(f"/api/projects/{pid}/models")
    assert resp.status_code == 200
    assert resp.json() == {"nodes": [], "edges": []}


async def test_models_endpoint_returns_graph(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dbt_projects_path", tmp_path)
    _make_project_with_manifest(tmp_path)
    list_resp = await client.post("/api/projects/rescan")
    pid = list_resp.json()[0]["id"]
    resp = await client.get(f"/api/projects/{pid}/models")
    assert resp.status_code == 200
    data = resp.json()
    names = {n["name"] for n in data["nodes"]}
    assert "orders" in names
    assert "customers" in names
    edges = data["edges"]
    assert len(edges) == 1
    assert edges[0]["source"] == "model.proj.customers"
    assert edges[0]["target"] == "model.proj.orders"


async def test_models_project_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/projects/99999/models")
    assert resp.status_code == 404
