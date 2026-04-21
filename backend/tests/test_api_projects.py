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


def _make_project(root: Path, subdir: str, name: str) -> Path:
    d = root / subdir
    d.mkdir(parents=True)
    (d / "dbt_project.yml").write_text(
        textwrap.dedent(f"name: {name}\nprofile: p\nversion: '1.0'\n")
    )
    return d


async def test_projects_empty_workspace(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "workspace", tmp_path)
    resp = await client.get("/api/projects")
    assert resp.status_code == 200
    assert resp.json() == []


async def test_projects_discovers_on_first_call(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "workspace", tmp_path)
    _make_project(tmp_path, "proj_a", "my_project")
    resp = await client.get("/api/projects")
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "my_project"


async def test_rescan_endpoint(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "workspace", tmp_path)
    _make_project(tmp_path, "p1", "first_project")
    resp = await client.post("/api/projects/rescan")
    assert resp.status_code == 200
    names = {p["name"] for p in resp.json()}
    assert "first_project" in names


async def test_get_project_by_id_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/projects/99999")
    assert resp.status_code == 404


async def test_get_project_by_id(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "workspace", tmp_path)
    _make_project(tmp_path, "proj", "fetched_project")
    list_resp = await client.post("/api/projects/rescan")
    project_id = list_resp.json()[0]["id"]
    resp = await client.get(f"/api/projects/{project_id}")
    assert resp.status_code == 200
    assert resp.json()["name"] == "fetched_project"
