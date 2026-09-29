import shutil
import subprocess
import sys
from pathlib import Path

from app.config import settings
from app.logging_setup import get_logger

log = get_logger(__name__)

# dbt-core / most adapters require 3.9+ at a minimum, but pip's
# --keyring-provider flag (used by the pip-install thread) needs pip 22.3+,
# which isn't reliably bundled with anything older than 3.11 — so 3.11 is
# our real floor, not just dbt's.
_MIN_PYTHON = (3, 11)

_VERSIONED_NAMES = ("python3.13", "python3.12", "python3.11")

# GUI-launched macOS apps (Finder double-click, LaunchServices) get a
# minimal PATH — typically just /usr/bin:/bin:/usr/sbin:/sbin — that does
# NOT include /opt/homebrew/bin or /usr/local/bin, even though that's where
# most users' real Python installs live. shutil.which() alone would silently
# fall through to the ancient Apple-bundled /usr/bin/python3 (3.9.x) instead.
# Check these fixed locations directly, not just whatever's on PATH.
_FIXED_SEARCH_DIRS = (
    Path("/opt/homebrew/bin"),  # Homebrew, Apple Silicon
    Path("/usr/local/bin"),  # Homebrew, Intel
    Path.home() / ".pyenv" / "shims",
)


def _venv_dir() -> Path:
    return settings.dbt_venv_dir


def _venv_bin(name: str) -> Path:
    return _venv_dir() / "bin" / name


def _python_version(executable: str) -> tuple[int, int] | None:
    try:
        result = subprocess.run(
            [executable, "-c", "import sys; print(sys.version_info[0], sys.version_info[1])"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    try:
        major, minor = result.stdout.strip().split()
        return (int(major), int(minor))
    except ValueError:
        return None


def _candidate_pythons() -> list[str]:
    candidates: list[str] = []
    seen: set[str] = set()

    def add(path: str) -> None:
        if path and path not in seen:
            seen.add(path)
            candidates.append(path)

    # Prefer explicit versioned names first — most likely to already meet
    # _MIN_PYTHON without needing a subprocess call to check.
    for name in _VERSIONED_NAMES:
        found = shutil.which(name)
        if found:
            add(found)
        for d in _FIXED_SEARCH_DIRS:
            p = d / name
            if p.is_file():
                add(str(p))

    # Bare "python3" last — on a GUI-launched app this is often the old
    # Apple-bundled interpreter, so it's only useful after a version check.
    found = shutil.which("python3")
    if found:
        add(found)
    for d in _FIXED_SEARCH_DIRS:
        p = d / "python3"
        if p.is_file():
            add(str(p))

    return candidates


def _find_system_python() -> str:
    for candidate in _candidate_pythons():
        version = _python_version(candidate)
        if version is not None and version >= _MIN_PYTHON:
            return candidate
    raise RuntimeError(
        f"No Python {_MIN_PYTHON[0]}.{_MIN_PYTHON[1]}+ interpreter found. dbt-ui needs "
        "one to create the isolated environment where dbt gets installed — install "
        "Python (e.g. https://www.python.org/downloads/) and restart dbt-ui."
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
        version = _python_version(str(marker))
        if version is not None and version >= _MIN_PYTHON:
            return venv_dir
        # Existing venv is too old (e.g. built from a stale search that
        # picked up /usr/bin/python3) — recreate it rather than getting
        # stuck reusing something broken forever.
        log.warning("dbt_venv_too_old", venv_dir=str(venv_dir), found_version=version)
        shutil.rmtree(venv_dir, ignore_errors=True)

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
