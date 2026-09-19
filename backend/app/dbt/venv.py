import shutil
import subprocess
import sys
from pathlib import Path

from app.config import settings
from app.logging_setup import get_logger

log = get_logger(__name__)

_SYSTEM_PYTHON_CANDIDATES = ("python3.13", "python3.12", "python3.11", "python3")


def _venv_dir() -> Path:
    return settings.dbt_venv_dir


def _venv_bin(name: str) -> Path:
    return _venv_dir() / "bin" / name


def _find_system_python() -> str:
    for candidate in _SYSTEM_PYTHON_CANDIDATES:
        found = shutil.which(candidate)
        if found:
            return found
    raise RuntimeError(
        "No Python 3.11+ interpreter found on PATH. dbt-ui needs one to create the "
        "isolated environment where dbt gets installed — install Python "
        "(e.g. https://www.python.org/downloads/) and restart dbt-ui."
    )


def ensure_venv() -> Path:
    """Create the dbt venv via the system Python if it doesn't exist yet.

    In dev mode this venv is backend/.venv, already created once by
    `task install:backend`. In the packaged app there is no equivalent
    install step, so the first thing that needs the venv creates it here —
    using the *system's* python3, not this (possibly frozen) interpreter:
    venv.create(with_pip=True) run from inside a PyInstaller one-file binary
    fork-bombs, because ensurepip's bootstrap re-execs "python", which
    resolves to the whole frozen app rather than a real interpreter.
    """
    venv_dir = _venv_dir()
    marker = venv_dir / "bin" / "python3"
    if marker.exists():
        return venv_dir

    python = _find_system_python()
    venv_dir.parent.mkdir(parents=True, exist_ok=True)
    log.info("dbt_venv_creating", python=python, venv_dir=str(venv_dir))
    result = subprocess.run(
        [python, "-m", "venv", str(venv_dir)],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        shutil.rmtree(venv_dir, ignore_errors=True)
        raise RuntimeError(
            f"Failed to create Python venv at {venv_dir} using {python}: "
            f"{result.stderr.strip() or result.stdout.strip()}"
        )
    log.info("dbt_venv_created", venv_dir=str(venv_dir))
    return venv_dir


def venv_dbt() -> Path:
    ensure_venv()
    p = _venv_bin("dbt")
    if not p.exists():
        raise RuntimeError(f"dbt not found in backend venv: {p}")
    return p


def venv_pip() -> Path:
    ensure_venv()
    p = _venv_bin("pip")
    if not p.exists():
        raise RuntimeError(f"pip not found in backend venv: {p}")
    return p


def venv_python() -> Path:
    ensure_venv()
    p = _venv_bin("python")
    if not p.exists():
        raise RuntimeError(f"python not found in backend venv: {p}")
    return p
