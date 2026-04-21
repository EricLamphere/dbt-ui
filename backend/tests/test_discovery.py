import textwrap
from pathlib import Path

import pytest

from app.projects.discovery import discover_projects


def _write_project(tmp_path: Path, subdir: str, name: str, profile: str = "default") -> Path:
    project_dir = tmp_path / subdir
    project_dir.mkdir(parents=True)
    (project_dir / "dbt_project.yml").write_text(
        textwrap.dedent(f"""
            name: {name}
            profile: {profile}
            version: "1.0"
        """)
    )
    return project_dir


def test_discover_finds_single_project(tmp_path: Path) -> None:
    _write_project(tmp_path, "proj_a", "project_a")
    results = discover_projects(tmp_path)
    assert len(results) == 1
    assert results[0].name == "project_a"


def test_discover_finds_multiple_projects(tmp_path: Path) -> None:
    _write_project(tmp_path, "a", "alpha")
    _write_project(tmp_path, "b", "beta")
    _write_project(tmp_path, "nested/c", "gamma")
    results = discover_projects(tmp_path)
    names = {r.name for r in results}
    assert names == {"alpha", "beta", "gamma"}


def test_discover_sorts_by_name(tmp_path: Path) -> None:
    _write_project(tmp_path, "z_dir", "zebra")
    _write_project(tmp_path, "a_dir", "apple")
    results = discover_projects(tmp_path)
    assert results[0].name == "apple"
    assert results[1].name == "zebra"


def test_discover_skips_target_dir(tmp_path: Path) -> None:
    """dbt_project.yml files inside target/ should be ignored."""
    _write_project(tmp_path, "myproject", "real_project")
    target = tmp_path / "myproject" / "target"
    target.mkdir()
    (target / "dbt_project.yml").write_text("name: ghost\nprofile: p\n")
    results = discover_projects(tmp_path)
    names = {r.name for r in results}
    assert "real_project" in names
    assert "ghost" not in names


def test_discover_skips_node_modules(tmp_path: Path) -> None:
    node = tmp_path / "node_modules" / "some_pkg"
    node.mkdir(parents=True)
    (node / "dbt_project.yml").write_text("name: fake\nprofile: p\n")
    results = discover_projects(tmp_path)
    assert not results


def test_discover_empty_workspace(tmp_path: Path) -> None:
    results = discover_projects(tmp_path)
    assert results == []


def test_discover_nonexistent_workspace(tmp_path: Path) -> None:
    results = discover_projects(tmp_path / "doesnt_exist")
    assert results == []


def test_platform_inferred_from_profiles(tmp_path: Path) -> None:
    project_dir = _write_project(tmp_path, "pg_proj", "pg_project", profile="pg_profile")
    (project_dir / "profiles.yml").write_text(
        textwrap.dedent("""
            pg_profile:
              target: dev
              outputs:
                dev:
                  type: postgres
                  host: localhost
        """)
    )
    results = discover_projects(tmp_path)
    assert len(results) == 1
    assert results[0].platform == "postgres"
