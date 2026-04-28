"""Unit tests for app.git.repo helpers."""
import subprocess
from pathlib import Path

import pytest

from app.git.repo import find_repo_root, parse_porcelain_v2


# ---------------------------------------------------------------------------
# find_repo_root
# ---------------------------------------------------------------------------


def test_find_repo_root_at_root(tmp_path: Path) -> None:
    (tmp_path / ".git").mkdir()
    assert find_repo_root(tmp_path) == tmp_path


def test_find_repo_root_nested(tmp_path: Path) -> None:
    (tmp_path / ".git").mkdir()
    deep = tmp_path / "a" / "b" / "c"
    deep.mkdir(parents=True)
    assert find_repo_root(deep) == tmp_path


def test_find_repo_root_no_repo(tmp_path: Path) -> None:
    assert find_repo_root(tmp_path) is None


def test_find_repo_root_git_file(tmp_path: Path) -> None:
    # git worktrees use a .git file (not dir) — should still detect the repo
    (tmp_path / ".git").write_text("gitdir: /somewhere/real/.git")
    assert find_repo_root(tmp_path) == tmp_path


# ---------------------------------------------------------------------------
# parse_porcelain_v2 — branch headers
# ---------------------------------------------------------------------------


def test_parse_branch_no_upstream() -> None:
    output = "# branch.oid abc123\0# branch.head main\0"
    branch, changes = parse_porcelain_v2(output)
    assert branch.name == "main"
    assert branch.oid == "abc123"
    assert branch.upstream is None
    assert branch.ahead == 0
    assert branch.behind == 0
    assert changes == []


def test_parse_branch_with_upstream() -> None:
    output = (
        "# branch.oid abc123\0"
        "# branch.head main\0"
        "# branch.upstream origin/main\0"
        "# branch.ab +2 -1\0"
    )
    branch, changes = parse_porcelain_v2(output)
    assert branch.upstream == "origin/main"
    assert branch.ahead == 2
    assert branch.behind == 1


def test_parse_branch_detached() -> None:
    output = "# branch.oid abc123\0# branch.head (detached)\0"
    branch, _ = parse_porcelain_v2(output)
    assert branch.name is None


def test_parse_branch_initial_commit() -> None:
    output = "# branch.oid (initial)\0# branch.head main\0"
    branch, _ = parse_porcelain_v2(output)
    assert branch.oid is None


# ---------------------------------------------------------------------------
# parse_porcelain_v2 — file changes
# ---------------------------------------------------------------------------


def test_parse_modified_unstaged() -> None:
    # XY=".M" means worktree modified, not staged
    output = "# branch.oid abc\0# branch.head main\0" + "1 .M N... 100644 100644 100644 h h models/my_model.sql\0"
    _, changes = parse_porcelain_v2(output)
    assert len(changes) == 1
    c = changes[0]
    assert c.path == "models/my_model.sql"
    assert c.index_status == "."
    assert c.worktree_status == "M"
    assert not c.staged
    assert not c.is_conflict


def test_parse_modified_staged() -> None:
    output = "# branch.oid abc\0# branch.head main\0" + "1 M. N... 100644 100644 100644 h h models/stg.sql\0"
    _, changes = parse_porcelain_v2(output)
    c = changes[0]
    assert c.index_status == "M"
    assert c.worktree_status == "."
    assert c.staged


def test_parse_added_staged() -> None:
    output = "# branch.oid abc\0# branch.head main\0" + "1 A. N... 0 100644 100644 h h models/new.sql\0"
    _, changes = parse_porcelain_v2(output)
    c = changes[0]
    assert c.index_status == "A"
    assert c.staged


def test_parse_deleted_worktree() -> None:
    output = "# branch.oid abc\0# branch.head main\0" + "1 .D N... 100644 100644 0 h h models/gone.sql\0"
    _, changes = parse_porcelain_v2(output)
    c = changes[0]
    assert c.index_status == "."
    assert c.worktree_status == "D"


def test_parse_untracked() -> None:
    output = "# branch.oid abc\0# branch.head main\0" + "? models/new_file.sql\0"
    _, changes = parse_porcelain_v2(output)
    c = changes[0]
    assert c.is_untracked
    assert c.index_status == "?"


def test_parse_rename() -> None:
    output = (
        "# branch.oid abc\0# branch.head main\0"
        "2 R. N... 100644 100644 100644 h h R100 models/new_name.sql\0models/old_name.sql\0"
    )
    _, changes = parse_porcelain_v2(output)
    c = changes[0]
    assert c.path == "models/new_name.sql"
    assert c.renamed_from == "models/old_name.sql"
    assert c.index_status == "R"


def test_parse_conflict() -> None:
    # Unmerged entry with UU
    output = (
        "# branch.oid abc\0# branch.head main\0"
        "u UU N... 100644 100644 100644 100644 h1 h2 h3 models/conflict.sql\0"
    )
    _, changes = parse_porcelain_v2(output)
    c = changes[0]
    assert c.is_conflict


def test_parse_multiple_changes() -> None:
    output = (
        "# branch.oid abc\0# branch.head main\0"
        "1 M. N... 100644 100644 100644 h h models/a.sql\0"
        "1 .M N... 100644 100644 100644 h h models/b.sql\0"
        "? models/c.sql\0"
    )
    _, changes = parse_porcelain_v2(output)
    assert len(changes) == 3
    assert changes[0].staged
    assert not changes[1].staged
    assert changes[2].is_untracked


def test_parse_empty_repo() -> None:
    output = "# branch.oid (initial)\0# branch.head main\0"
    branch, changes = parse_porcelain_v2(output)
    assert branch.name == "main"
    assert changes == []


# ---------------------------------------------------------------------------
# Integration — run actual git commands in a temp repo
# ---------------------------------------------------------------------------


@pytest.fixture
def git_repo(tmp_path: Path) -> Path:
    """Create a minimal git repo with one commit."""
    subprocess.run(["git", "init", "-b", "main"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=tmp_path, check=True, capture_output=True)
    (tmp_path / "models").mkdir()
    (tmp_path / "models" / "base.sql").write_text("select 1")
    subprocess.run(["git", "add", "."], cwd=tmp_path, check=True, capture_output=True)
    subprocess.run(["git", "commit", "-m", "init"], cwd=tmp_path, check=True, capture_output=True)
    return tmp_path


def test_find_repo_root_real_git(git_repo: Path) -> None:
    nested = git_repo / "models"
    assert find_repo_root(nested) == git_repo


def test_parse_porcelain_v2_clean_repo(git_repo: Path) -> None:
    result = subprocess.run(
        ["git", "status", "--porcelain=v2", "--branch", "-z"],
        cwd=git_repo, capture_output=True, text=True
    )
    branch, changes = parse_porcelain_v2(result.stdout)
    assert branch.name == "main"
    assert changes == []


def test_parse_porcelain_v2_with_changes(git_repo: Path) -> None:
    # Modify tracked file + add untracked
    (git_repo / "models" / "base.sql").write_text("select 2")
    (git_repo / "models" / "new.sql").write_text("select 3")
    result = subprocess.run(
        ["git", "status", "--porcelain=v2", "--branch", "-z"],
        cwd=git_repo, capture_output=True, text=True
    )
    branch, changes = parse_porcelain_v2(result.stdout)
    paths = {c.path for c in changes}
    assert "models/base.sql" in paths
    assert "models/new.sql" in paths


def test_parse_porcelain_v2_staged(git_repo: Path) -> None:
    (git_repo / "models" / "base.sql").write_text("select 99")
    subprocess.run(["git", "add", "models/base.sql"], cwd=git_repo, check=True, capture_output=True)
    result = subprocess.run(
        ["git", "status", "--porcelain=v2", "--branch", "-z"],
        cwd=git_repo, capture_output=True, text=True
    )
    _, changes = parse_porcelain_v2(result.stdout)
    staged = [c for c in changes if c.staged]
    assert any(c.path == "models/base.sql" for c in staged)
