"""Integration tests for the git API endpoints."""
import subprocess
import textwrap
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def _make_git_repo(workspace: Path) -> Path:
    """Create a git repo at workspace/proj/ with one commit and a dbt_project.yml."""
    repo = workspace / "proj"
    repo.mkdir(parents=True)
    subprocess.run(["git", "init", "-b", "main"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "t@t.com"], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "T"], cwd=repo, check=True, capture_output=True)
    (repo / "dbt_project.yml").write_text(
        textwrap.dedent("name: proj\nprofile: p\nversion: '1.0'\n")
    )
    (repo / "models").mkdir()
    (repo / "models" / "base.sql").write_text("select 1")
    subprocess.run(["git", "add", "."], cwd=repo, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=repo, check=True, capture_output=True)
    return repo


async def _rescan(client: AsyncClient, workspace: Path, monkeypatch: pytest.MonkeyPatch) -> int:
    """Point workspace at the tmp dir, rescan, return project id."""
    monkeypatch.setattr(settings, "dbt_projects_path", workspace)
    resp = await client.post("/api/projects/rescan")
    assert resp.status_code == 200, resp.text
    projects = resp.json()
    assert projects, "no projects found after rescan"
    return projects[0]["id"]


# ---------------------------------------------------------------------------
# /git/status
# ---------------------------------------------------------------------------


async def test_git_status_clean(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(f"/api/projects/{pid}/git/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["branch"]["name"] == "main"
    assert data["changes"] == []
    assert data["repo_root"] == str(repo)


async def test_git_status_with_modified_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    (repo / "models" / "base.sql").write_text("select 2")
    resp = await client.get(f"/api/projects/{pid}/git/status")
    assert resp.status_code == 200
    paths = [c["path"] for c in resp.json()["changes"]]
    assert "models/base.sql" in paths


async def test_git_status_with_untracked_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    (repo / "models" / "new.sql").write_text("select 3")
    resp = await client.get(f"/api/projects/{pid}/git/status")
    assert resp.status_code == 200
    untracked = [c for c in resp.json()["changes"] if c["is_untracked"]]
    assert any("new.sql" in c["path"] for c in untracked)


async def test_git_status_not_a_repo(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Create a project dir without .git
    no_repo = tmp_path / "no_repo"
    no_repo.mkdir()
    (no_repo / "dbt_project.yml").write_text("name: no_repo\nprofile: p\nversion: '1.0'\n")
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(f"/api/projects/{pid}/git/status")
    assert resp.status_code == 422


async def test_git_status_project_not_found(client: AsyncClient) -> None:
    resp = await client.get("/api/projects/9999/git/status")
    assert resp.status_code == 404


# ---------------------------------------------------------------------------
# /git/diff
# ---------------------------------------------------------------------------


async def test_git_diff_modified_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    (repo / "models" / "base.sql").write_text("select 99")
    resp = await client.get(f"/api/projects/{pid}/git/diff", params={"path": "models/base.sql"})
    assert resp.status_code == 200
    diff = resp.json()["diff"]
    assert "-select 1" in diff
    assert "+select 99" in diff


async def test_git_diff_clean_file_is_empty(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(f"/api/projects/{pid}/git/diff", params={"path": "models/base.sql"})
    assert resp.status_code == 200
    assert resp.json()["diff"] == ""


async def test_git_diff_staged(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    (repo / "models" / "base.sql").write_text("select staged")
    subprocess.run(["git", "add", "models/base.sql"], cwd=repo, check=True, capture_output=True)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(
        f"/api/projects/{pid}/git/diff",
        params={"path": "models/base.sql", "staged": "true"},
    )
    assert resp.status_code == 200
    assert "+select staged" in resp.json()["diff"]


# ---------------------------------------------------------------------------
# /git/file-at-head
# ---------------------------------------------------------------------------


async def test_file_at_head_existing(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(
        f"/api/projects/{pid}/git/file-at-head",
        params={"path": "models/base.sql"},
    )
    assert resp.status_code == 200
    assert resp.json()["content"] == "select 1"


async def test_file_at_head_new_file_returns_empty(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    (repo / "models" / "brand_new.sql").write_text("select 5")
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(
        f"/api/projects/{pid}/git/file-at-head",
        params={"path": "models/brand_new.sql"},
    )
    assert resp.status_code == 200
    assert resp.json()["content"] == ""


# ---------------------------------------------------------------------------
# /git/stage and /git/unstage
# ---------------------------------------------------------------------------


async def test_stage_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    (repo / "models" / "base.sql").write_text("select staged")
    resp = await client.post(
        f"/api/projects/{pid}/git/stage",
        json={"paths": ["models/base.sql"]},
    )
    assert resp.status_code == 200
    status_resp = await client.get(f"/api/projects/{pid}/git/status")
    changes = status_resp.json()["changes"]
    staged = [c for c in changes if c["staged"] and "base.sql" in c["path"]]
    assert staged


async def test_unstage_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    (repo / "models" / "base.sql").write_text("select unstaged")
    subprocess.run(["git", "add", "models/base.sql"], cwd=repo, check=True, capture_output=True)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.post(
        f"/api/projects/{pid}/git/unstage",
        json={"paths": ["models/base.sql"]},
    )
    assert resp.status_code == 200
    status_resp = await client.get(f"/api/projects/{pid}/git/status")
    changes = status_resp.json()["changes"]
    staged = [c for c in changes if c["staged"] and "base.sql" in c["path"]]
    assert not staged


async def test_stage_empty_paths_noop(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.post(f"/api/projects/{pid}/git/stage", json={"paths": []})
    assert resp.status_code == 200


# ---------------------------------------------------------------------------
# /git/discard
# ---------------------------------------------------------------------------


async def test_discard_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    (repo / "models" / "base.sql").write_text("select changed")
    resp = await client.post(
        f"/api/projects/{pid}/git/discard",
        json={"paths": ["models/base.sql"]},
    )
    assert resp.status_code == 200
    assert (repo / "models" / "base.sql").read_text() == "select 1"


# ---------------------------------------------------------------------------
# /git/commit
# ---------------------------------------------------------------------------


async def test_commit(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    (repo / "models" / "base.sql").write_text("select committed")
    subprocess.run(["git", "add", "."], cwd=repo, check=True, capture_output=True)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.post(
        f"/api/projects/{pid}/git/commit",
        json={"message": "test commit"},
    )
    assert resp.status_code == 200
    log_out = subprocess.run(
        ["git", "log", "--oneline"], cwd=repo, capture_output=True, text=True
    ).stdout
    assert "test commit" in log_out


async def test_commit_nothing_staged_fails(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.post(
        f"/api/projects/{pid}/git/commit",
        json={"message": "empty commit"},
    )
    assert resp.status_code == 500


# ---------------------------------------------------------------------------
# /git/branches
# ---------------------------------------------------------------------------


async def test_list_branches(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    subprocess.run(["git", "branch", "feature/x"], cwd=repo, check=True, capture_output=True)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(f"/api/projects/{pid}/git/branches")
    assert resp.status_code == 200
    names = [b["name"] for b in resp.json()["branches"]]
    assert "main" in names
    assert "feature/x" in names


async def test_current_branch_marked(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(f"/api/projects/{pid}/git/branches")
    branches = resp.json()["branches"]
    current = [b for b in branches if b["current"]]
    assert len(current) == 1
    assert current[0]["name"] == "main"


async def test_create_branch(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.post(
        f"/api/projects/{pid}/git/branches",
        json={"name": "new-branch"},
    )
    assert resp.status_code == 200
    out = subprocess.run(["git", "branch"], cwd=repo, capture_output=True, text=True).stdout
    assert "new-branch" in out


# ---------------------------------------------------------------------------
# /git/checkout
# ---------------------------------------------------------------------------


async def test_checkout_branch(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    subprocess.run(["git", "branch", "other"], cwd=repo, check=True, capture_output=True)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.post(f"/api/projects/{pid}/git/checkout", json={"name": "other"})
    assert resp.status_code == 200
    out = subprocess.run(
        ["git", "branch", "--show-current"], cwd=repo, capture_output=True, text=True
    ).stdout.strip()
    assert out == "other"


async def test_checkout_nonexistent_branch_fails(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.post(f"/api/projects/{pid}/git/checkout", json={"name": "does-not-exist"})
    assert resp.status_code == 500


# ---------------------------------------------------------------------------
# /git/log
# ---------------------------------------------------------------------------


async def test_git_log(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(f"/api/projects/{pid}/git/log")
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    assert len(entries) >= 1
    assert entries[0]["message"] == "init"


async def test_git_log_limit(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    repo = _make_git_repo(tmp_path)
    for i in range(3):
        (repo / "models" / "base.sql").write_text(f"select {i}")
        subprocess.run(["git", "add", "."], cwd=repo, check=True, capture_output=True)
        subprocess.run(
            ["git", "commit", "-m", f"commit {i}"], cwd=repo, check=True, capture_output=True
        )
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(f"/api/projects/{pid}/git/log", params={"limit": 2})
    assert resp.status_code == 200
    assert len(resp.json()["entries"]) == 2


async def test_git_log_for_file(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    pid = await _rescan(client, tmp_path, monkeypatch)
    resp = await client.get(
        f"/api/projects/{pid}/git/log",
        params={"path": "models/base.sql"},
    )
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    assert len(entries) >= 1
