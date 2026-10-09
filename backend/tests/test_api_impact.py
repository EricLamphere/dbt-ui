"""Integration tests for GET /api/projects/{id}/impact/changes (real git repos)."""
import json
import subprocess
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


MANIFEST = {
    "metadata": {"project_name": "proj"},
    "nodes": {
        "model.proj.base": {
            "resource_type": "model", "name": "base",
            "original_file_path": "models/base.sql", "patch_path": None,
            "depends_on": {"macros": ["macro.proj.helper"]},
        },
        "model.proj.child": {
            "resource_type": "model", "name": "child",
            "original_file_path": "models/child.sql", "patch_path": None,
            "depends_on": {"macros": []},
        },
    },
    "macros": {
        "macro.proj.helper": {
            "name": "helper", "package_name": "proj",
            "original_file_path": "macros/helper.sql", "depends_on": {"macros": []},
        },
    },
}


def _git(cwd: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True)


def _make_project(root: Path, *, branch: str = "main", manifest: bool = True) -> Path:
    """dbt project at ``root`` (created) with one commit; target/ is gitignored."""
    root.mkdir(parents=True)
    (root / "dbt_project.yml").write_text("name: proj\nprofile: p\nversion: '1.0'\n")
    (root / ".gitignore").write_text("target/\n")
    (root / "models").mkdir()
    (root / "models" / "base.sql").write_text("select 1")
    (root / "models" / "child.sql").write_text("select * from {{ ref('base') }}")
    (root / "macros").mkdir()
    (root / "macros" / "helper.sql").write_text("{% macro helper() %}1{% endmacro %}")
    if manifest:
        (root / "target").mkdir()
        (root / "target" / "manifest.json").write_text(json.dumps(MANIFEST))
    return root


def _init_repo(repo: Path, branch: str = "main") -> None:
    _git(repo, "init", "-b", branch)
    _git(repo, "config", "user.email", "t@t.com")
    _git(repo, "config", "user.name", "T")
    _git(repo, "add", ".")
    _git(repo, "commit", "-m", "init")


async def _rescan(client: AsyncClient, workspace: Path, monkeypatch: pytest.MonkeyPatch) -> int:
    monkeypatch.setattr(settings, "dbt_projects_path", workspace)
    resp = await client.post("/api/projects/rescan")
    assert resp.status_code == 200, resp.text
    return resp.json()[0]["id"]


async def _changes(client: AsyncClient, pid: int, **params: str):
    return await client.get(f"/api/projects/{pid}/impact/changes", params=params)


def _node_reasons(data: dict) -> dict[str, list[tuple[str, str, str]]]:
    return {n["unique_id"]: [(r["kind"], r["path"], r["change"]) for r in n["reasons"]] for n in data["nodes"]}


async def test_working_tree_changes(client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _make_project(tmp_path / "proj")
    _init_repo(repo)
    (repo / "models" / "base.sql").write_text("select 2")
    (repo / "models" / "staging").mkdir()
    (repo / "models" / "staging" / "new.sql").write_text("select 3")
    (repo / "dbt_project.yml").write_text("name: proj\nprofile: p\nversion: '2.0'\n")
    pid = await _rescan(client, tmp_path, monkeypatch)

    resp = await _changes(client, pid, scope="working")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["scope"] == "working"
    assert data["branch"] == "main"
    assert data["manifest_available"] is True
    assert data["changed_files"] == 3
    assert _node_reasons(data) == {"model.proj.base": [("file", "models/base.sql", "modified")]}
    assert data["unmapped"] == [{"path": "models/staging/new.sql", "change": "added"}]
    assert data["project_wide"] == [{"path": "dbt_project.yml", "change": "modified"}]


async def test_clean_working_tree(client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _init_repo(_make_project(tmp_path / "proj"))
    pid = await _rescan(client, tmp_path, monkeypatch)
    data = (await _changes(client, pid, scope="working")).json()
    assert data["changed_files"] == 0
    assert data["nodes"] == []


async def test_branch_scope_includes_commits_and_uncommitted(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_project(tmp_path / "proj")
    _init_repo(repo)
    _git(repo, "checkout", "-b", "feature")
    (repo / "models" / "child.sql").write_text("select 1 as changed")
    _git(repo, "commit", "-am", "change child")
    (repo / "macros" / "helper.sql").write_text("{% macro helper() %}2{% endmacro %}")
    pid = await _rescan(client, tmp_path, monkeypatch)

    data = (await _changes(client, pid, scope="branch")).json()
    assert data["scope"] == "branch"
    assert data["base"] == "main"
    assert data["branch"] == "feature"
    assert data["merge_base"]
    assert _node_reasons(data) == {
        "model.proj.child": [("file", "models/child.sql", "modified")],
        "model.proj.base": [("macro", "macros/helper.sql", "modified")],
    }
    base_node = next(n for n in data["nodes"] if n["unique_id"] == "model.proj.base")
    assert base_node["reasons"][0]["macro"] == "helper"

    working = (await _changes(client, pid, scope="working")).json()
    assert list(_node_reasons(working)) == ["model.proj.base"]


async def test_branch_scope_deleted_file(client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _make_project(tmp_path / "proj")
    _init_repo(repo)
    _git(repo, "checkout", "-b", "feature")
    _git(repo, "rm", "-q", "models/child.sql")
    _git(repo, "commit", "-m", "drop child")
    pid = await _rescan(client, tmp_path, monkeypatch)

    data = (await _changes(client, pid, scope="branch", base="main")).json()
    # the (stale) manifest still knows the model, so it maps
    assert _node_reasons(data) == {"model.proj.child": [("file", "models/child.sql", "deleted")]}


@pytest.mark.parametrize("base", ["nope", "--output=/tmp/x"])
async def test_branch_scope_rejects_bad_base(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, base: str
) -> None:
    _init_repo(_make_project(tmp_path / "proj"))
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await _changes(client, pid, scope="branch", base=base)
    assert resp.status_code == 400
    assert "base" in resp.json()["detail"]


async def test_branch_scope_without_default_base(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _init_repo(_make_project(tmp_path / "proj"), branch="trunk")
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await _changes(client, pid, scope="branch")
    assert resp.status_code == 400
    assert "base branch" in resp.json()["detail"]


async def test_project_in_repo_subdirectory(client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    mono = tmp_path / "mono"
    project = _make_project(mono / "analytics")
    (mono / "README.md").write_text("hi")
    _init_repo(mono)
    (project / "models" / "child.sql").write_text("select 9")
    (mono / "other.sql").write_text("select 0")
    pid = await _rescan(client, tmp_path, monkeypatch)

    data = (await _changes(client, pid, scope="working")).json()
    assert data["changed_files"] == 1
    assert list(_node_reasons(data)) == ["model.proj.child"]


async def test_missing_manifest(client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = _make_project(tmp_path / "proj", manifest=False)
    _init_repo(repo)
    (repo / "models" / "base.sql").write_text("select 2")
    pid = await _rescan(client, tmp_path, monkeypatch)

    data = (await _changes(client, pid, scope="working")).json()
    assert data["manifest_available"] is False
    assert data["nodes"] == []
    assert data["unmapped"] == [{"path": "models/base.sql", "change": "modified"}]


async def test_not_a_git_repo(client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _make_project(tmp_path / "proj")
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await _changes(client, pid, scope="working")
    assert resp.status_code == 422


async def test_invalid_scope(client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _init_repo(_make_project(tmp_path / "proj"))
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await _changes(client, pid, scope="everything")
    assert resp.status_code == 422
