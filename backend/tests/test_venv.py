import stat
import sys
from pathlib import Path

import pytest

from app.config import settings
from app.dbt import venv


def _fake_python(tmp_path: Path, name: str, version: str) -> str:
    """A stand-in interpreter that reports `version` ("3 12") to _python_version()."""
    p = tmp_path / name
    p.write_text(f"#!/bin/sh\necho '{version}'\n")
    p.chmod(p.stat().st_mode | stat.S_IXUSR)
    return str(p)


def _fake_create(calls: list[str]):
    """Replace real `python -m venv` with a stub that lays out bin/python3 + the marker."""

    def create(python: str, venv_dir: Path) -> None:
        calls.append(python)
        (venv_dir / "bin").mkdir(parents=True, exist_ok=True)
        (venv_dir / "bin" / "python3").symlink_to(sys.executable)
        (venv_dir / venv.MARKER_NAME).write_text(python)

    return create


@pytest.fixture
def venv_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "dbt-venv"
    monkeypatch.setattr(settings, "dbt_venv_dir", d)
    monkeypatch.setattr(venv, "_configured_python", None)
    return d


# ---- validate_python ----


def test_validate_python_accepts_supported_interpreter(tmp_path: Path) -> None:
    py = _fake_python(tmp_path, "python3.12", "3 12 6")
    assert venv.validate_python(py) == py


def test_validate_python_expands_user(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    py = _fake_python(tmp_path, "python3.12", "3 12")
    assert venv.validate_python("~/python3.12") == py


def test_validate_python_rejects_missing_path(tmp_path: Path) -> None:
    with pytest.raises(venv.InvalidPythonError, match="does not exist"):
        venv.validate_python(str(tmp_path / "nope"))


def test_validate_python_rejects_non_executable(tmp_path: Path) -> None:
    p = tmp_path / "python3"
    p.write_text("")
    with pytest.raises(venv.InvalidPythonError, match="not executable"):
        venv.validate_python(str(p))


def test_validate_python_rejects_old_version(tmp_path: Path) -> None:
    py = _fake_python(tmp_path, "python3.9", "3 9")
    with pytest.raises(venv.InvalidPythonError, match="3.9.*3.11"):
        venv.validate_python(py)


def test_validate_python_rejects_non_python(tmp_path: Path) -> None:
    py = _fake_python(tmp_path, "notpython", "hello")
    with pytest.raises(venv.InvalidPythonError, match="Could not run"):
        venv.validate_python(py)


def test_validate_python_rejects_empty() -> None:
    with pytest.raises(venv.InvalidPythonError):
        venv.validate_python("   ")


# ---- venv_built_from ----


def test_built_from_reads_marker(venv_dir: Path) -> None:
    venv_dir.mkdir()
    (venv_dir / venv.MARKER_NAME).write_text("/opt/homebrew/bin/python3.13\n")
    assert venv.venv_built_from() == "/opt/homebrew/bin/python3.13"


def test_built_from_falls_back_to_pyvenv_cfg(venv_dir: Path, tmp_path: Path) -> None:
    home = tmp_path / "pyhome"
    home.mkdir()
    py = _fake_python(home, "python3.12", "3 12")
    venv_dir.mkdir()
    (venv_dir / "pyvenv.cfg").write_text(
        f"home = {home}\ninclude-system-site-packages = false\nversion = 3.12.6\n"
    )
    assert venv.venv_built_from() == py


def test_built_from_none_without_venv(venv_dir: Path) -> None:
    assert venv.venv_built_from() is None


# ---- ensure_venv ----


def test_ensure_venv_uses_configured_python(
    venv_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(venv, "_create_venv", _fake_create(calls))
    py = _fake_python(tmp_path, "python3.13", "3 13")
    venv.set_configured_python(py)

    venv.ensure_venv()

    assert calls == [py]


def test_ensure_venv_reuses_matching_venv(
    venv_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(venv, "_create_venv", _fake_create(calls))
    py = _fake_python(tmp_path, "python3.13", "3 13")
    venv.set_configured_python(py)

    venv.ensure_venv()
    venv.ensure_venv()

    assert calls == [py]


def test_ensure_venv_rebuilds_when_configured_python_changes(
    venv_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(venv, "_create_venv", _fake_create(calls))
    old = _fake_python(tmp_path, "python3.12", "3 12")
    new = _fake_python(tmp_path, "python3.13", "3 13")
    venv.set_configured_python(old)
    venv.ensure_venv()
    (venv_dir / "leftover.txt").write_text("from the old env")

    venv.set_configured_python(new)
    venv.ensure_venv()

    assert calls == [old, new]
    assert not (venv_dir / "leftover.txt").exists()


def test_ensure_venv_never_rebuilds_own_venv(
    venv_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(venv, "_create_venv", _fake_create(calls))
    venv.set_configured_python(_fake_python(tmp_path, "python3.12", "3 12"))
    venv.ensure_venv()
    monkeypatch.setattr(venv, "is_own_venv", lambda: True)
    venv.set_configured_python(_fake_python(tmp_path, "python3.13", "3 13"))

    venv.ensure_venv()

    assert len(calls) == 1


def test_ensure_venv_falls_back_to_detection(
    venv_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(venv, "_create_venv", _fake_create(calls))
    detected = _fake_python(tmp_path, "python3.12", "3 12")
    monkeypatch.setattr(venv, "find_system_python", lambda: detected)

    venv.ensure_venv()

    assert calls == [detected]


# ---- rebuild_venv / detect_python ----


def test_rebuild_venv_replaces_existing(
    venv_dir: Path, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[str] = []
    monkeypatch.setattr(venv, "_create_venv", _fake_create(calls))
    venv_dir.mkdir()
    (venv_dir / "stale").write_text("x")
    py = _fake_python(tmp_path, "python3.13", "3 13")

    venv.rebuild_venv(py)

    assert calls == [py]
    assert not (venv_dir / "stale").exists()
    assert venv.venv_built_from() == py


def test_detect_python_prefers_existing_venv(venv_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    venv_dir.mkdir()
    (venv_dir / venv.MARKER_NAME).write_text("/usr/local/bin/python3.11")
    monkeypatch.setattr(venv, "find_system_python", lambda: "/opt/homebrew/bin/python3.13")
    assert venv.detect_python() == "/usr/local/bin/python3.11"


def test_detect_python_none_when_nothing_found(venv_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise() -> str:
        raise RuntimeError("no python")

    monkeypatch.setattr(venv, "find_system_python", _raise)
    assert venv.detect_python() is None


def test_is_own_venv(venv_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    assert venv.is_own_venv() is False
    monkeypatch.setattr(settings, "dbt_venv_dir", Path(sys.prefix))
    assert venv.is_own_venv() is True


def test_venv_activate_script(venv_dir: Path) -> None:
    assert venv.venv_activate_script() is None
    (venv_dir / "bin").mkdir(parents=True)
    (venv_dir / "bin" / "activate").write_text("")
    assert venv.venv_activate_script() == venv_dir / "bin" / "activate"


# ---- list_pythons ----


@pytest.fixture
def search_dirs(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> tuple[Path, Path]:
    a, b = tmp_path / "brew", tmp_path / "local"
    a.mkdir()
    b.mkdir()
    monkeypatch.setattr(venv, "_interpreter_search_dirs", lambda: [a, b])
    return a, b


def test_list_pythons_newest_first_and_skips_old(search_dirs: tuple[Path, Path]) -> None:
    a, b = search_dirs
    py12 = _fake_python(a, "python3.12", "3 12 6")
    py13 = _fake_python(b, "python3.13", "3 13 1")
    _fake_python(b, "python3", "3 9 6")

    found = venv.list_pythons()

    assert [(p.path, p.version) for p in found] == [(py13, "3.13.1"), (py12, "3.12.6")]


def test_list_pythons_dedups_symlinks(search_dirs: tuple[Path, Path]) -> None:
    a, _ = search_dirs
    real = _fake_python(a, "python3.12", "3 12 6")
    (a / "python3").symlink_to(real)

    found = venv.list_pythons()

    assert [p.path for p in found] == [real]


def test_list_pythons_shows_preferred_alias(search_dirs: tuple[Path, Path], tmp_path: Path) -> None:
    a, _ = search_dirs
    real = _fake_python(a, "python3.12", "3 12 6")
    alias = tmp_path / "opt-python3.12"
    alias.symlink_to(real)

    found = venv.list_pythons(preferred=str(alias))

    assert [p.path for p in found] == [str(alias)]


def test_list_pythons_includes_preferred_outside_search(
    search_dirs: tuple[Path, Path], tmp_path: Path
) -> None:
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    custom = _fake_python(elsewhere, "python3.11", "3 11 9")

    found = venv.list_pythons(preferred=custom)

    assert [(p.path, p.version) for p in found] == [(custom, "3.11.9")]


def test_same_interpreter_follows_symlinks(tmp_path: Path) -> None:
    real = _fake_python(tmp_path, "python3.12", "3 12")
    alias = tmp_path / "alias"
    alias.symlink_to(real)
    assert venv.same_interpreter(str(alias), real)
    assert not venv.same_interpreter(real, str(tmp_path / "other"))
    assert not venv.same_interpreter(None, real)


def test_list_pythons_skips_virtualenvs(search_dirs: tuple[Path, Path], tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    a, _ = search_dirs
    some_venv = tmp_path / "proj-venv"
    (some_venv / "bin").mkdir(parents=True)
    (some_venv / "pyvenv.cfg").write_text("home = /x\n")
    _fake_python(some_venv / "bin", "python3", "3 12 6")
    monkeypatch.setattr(venv, "_interpreter_search_dirs", lambda: [some_venv / "bin", a])

    assert venv.list_pythons() == []


def test_validate_python_rejects_virtualenv_interpreter(tmp_path: Path) -> None:
    some_venv = tmp_path / "proj-venv"
    (some_venv / "bin").mkdir(parents=True)
    (some_venv / "pyvenv.cfg").write_text("home = /x\n")
    py = _fake_python(some_venv / "bin", "python3", "3 12 6")

    with pytest.raises(venv.InvalidPythonError, match="virtual environment"):
        venv.validate_python(py)


def test_dev_dbt_venv_is_separate_from_backend_venv() -> None:
    from app.config import _default_dbt_venv_dir

    d = _default_dbt_venv_dir()
    assert d.is_absolute()
    assert d.resolve() != Path(sys.prefix).resolve()
    assert d.name == "dbt-venv"
