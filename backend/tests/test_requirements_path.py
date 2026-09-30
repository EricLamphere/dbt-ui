from pathlib import Path

import pytest

from app.api.init import _resolve_requirements_path


def test_relative_path_resolves_against_project(tmp_path: Path) -> None:
    (tmp_path / "requirements.txt").write_text("dbt-duckdb\n")
    assert _resolve_requirements_path("requirements.txt", tmp_path) == tmp_path / "requirements.txt"


def test_relative_subdir_path(tmp_path: Path) -> None:
    assert _resolve_requirements_path("deps/req.txt", tmp_path) == tmp_path / "deps" / "req.txt"


def test_absolute_path_unchanged(tmp_path: Path) -> None:
    abs_path = tmp_path / "elsewhere" / "requirements.txt"
    assert _resolve_requirements_path(str(abs_path), Path("/some/project")) == abs_path


def test_home_relative_path_expanded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    assert _resolve_requirements_path("~/requirements.txt", Path("/p")) == tmp_path / "requirements.txt"


def test_whitespace_stripped(tmp_path: Path) -> None:
    assert _resolve_requirements_path("  requirements.txt \n", tmp_path) == tmp_path / "requirements.txt"


def test_accepts_str_project_path(tmp_path: Path) -> None:
    # _run_init_steps passes project_path through as a str.
    assert _resolve_requirements_path("requirements.txt", str(tmp_path)) == tmp_path / "requirements.txt"
