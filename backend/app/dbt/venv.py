import os
import shutil
import subprocess
import sys
import threading
from collections.abc import Iterator
from dataclasses import dataclass
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


# Written into the venv after creation, holding the exact interpreter path it
# was built from — so a changed `python_path` setting can be detected and the
# venv rebuilt against the new interpreter.
MARKER_NAME = ".dbt-ui-python"

# The user's `python_path` global setting, mirrored here from app_settings by
# app.dbt.python_env (at startup and on every change). venv resolution is sync
# and called from threads, so it can't read the async DB itself.
_configured_python: str | None = None

# ensure_venv() is reached from the event loop's executor and from the global
# setup thread — serialize so two callers can't rmtree/create the venv at once.
_venv_lock = threading.Lock()


class InvalidPythonError(ValueError):
    """The given interpreter path can't be used to build the dbt venv."""


def set_configured_python(path: str | None) -> None:
    global _configured_python
    _configured_python = path or None


def configured_python() -> str | None:
    return _configured_python


def _venv_dir() -> Path:
    return settings.dbt_venv_dir


def is_own_venv() -> bool:
    """True when the dbt venv is the one this backend is running from (dev mode's
    backend/.venv). It also holds FastAPI etc., so it must never be rebuilt."""
    return _venv_dir().resolve() == Path(sys.prefix).resolve()


def venv_activate_script() -> Path | None:
    p = _venv_dir() / "bin" / "activate"
    return p if p.is_file() else None


def _venv_bin(name: str) -> Path:
    return _venv_dir() / "bin" / name


def existing_bin(name: str) -> Path | None:
    """A venv binary if the venv already has it — never creates or rebuilds the
    venv. For cheap status checks; use venv_dbt()/venv_pip()/venv_python() to run."""
    p = _venv_bin(name)
    return p if p.exists() else None


def _python_version_info(executable: str) -> tuple[int, ...] | None:
    """(major, minor, micro) as reported by running `executable`, or None."""
    try:
        result = subprocess.run(
            [executable, "-c", "import sys; print(*sys.version_info[:3])"],
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    if result.returncode != 0:
        return None
    try:
        parts = tuple(int(x) for x in result.stdout.split())
    except ValueError:
        return None
    return parts if 2 <= len(parts) <= 3 else None


def _python_version(executable: str) -> tuple[int, int] | None:
    info = _python_version_info(executable)
    return (info[0], info[1]) if info else None


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


def find_system_python() -> str:
    for candidate in _candidate_pythons():
        version = _python_version(candidate)
        if version is not None and version >= _MIN_PYTHON:
            return candidate
    raise RuntimeError(
        f"No Python {_MIN_PYTHON[0]}.{_MIN_PYTHON[1]}+ interpreter found. dbt-ui needs "
        "one to create the isolated environment where dbt gets installed — install "
        "Python (e.g. https://www.python.org/downloads/) and restart dbt-ui."
    )


# Names offered in the interpreter picker. Broader than _VERSIONED_NAMES (which
# only drives auto-detection): the user may deliberately pick a newer Python.
_LISTED_NAMES = ("python3.14", "python3.13", "python3.12", "python3.11", "python3")


@dataclass(frozen=True)
class PythonInterpreter:
    path: str
    version: str  # e.g. "3.12.6"


def _interpreter_search_dirs() -> list[Path]:
    """Where to look for interpreters to offer: PATH, the fixed dirs a GUI app's
    PATH misses, and per-version install dirs. pyenv *shims* are skipped — which
    version a shim runs depends on the cwd — in favour of ~/.pyenv/versions."""
    dirs = [Path(p) for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    dirs += [d for d in _FIXED_SEARCH_DIRS if d.name != "shims"]
    dirs += sorted((Path.home() / ".pyenv" / "versions").glob("*/bin"))
    dirs += sorted(Path("/Library/Frameworks/Python.framework/Versions").glob("*/bin"))
    return dirs


def _in_virtualenv(path: Path) -> bool:
    """True for an interpreter inside a venv (bin/ sits beside pyvenv.cfg). The
    dbt venv must be built from a base interpreter — building it from its own
    python would rmtree the interpreter mid-rebuild."""
    return (path.parent.parent / "pyvenv.cfg").is_file()


def _real(path: str) -> str:
    return os.path.realpath(path)


def same_interpreter(a: str | None, b: str | None) -> bool:
    """True when both paths are the same interpreter binary (symlinks followed)."""
    return a is not None and b is not None and _real(a) == _real(b)


def _listed_candidates(preferred: str | None) -> Iterator[str]:
    if preferred:
        yield preferred
    for d in _interpreter_search_dirs():
        if (d.parent / "pyvenv.cfg").is_file():
            continue
        for name in _LISTED_NAMES:
            p = d / name
            if p.is_file() and os.access(p, os.X_OK):
                yield str(p)


def list_pythons(preferred: str | None = None) -> list[PythonInterpreter]:
    """Every distinct Python >= _MIN_PYTHON found, newest first.

    Symlinks to the same binary (Homebrew's bin/ vs opt/ paths, bare python3)
    collapse into one entry. `preferred` (the current setting) is listed under
    its own spelling so it matches the stored value, and is included even when
    it lives outside the search dirs.
    """
    found: dict[str, tuple[tuple[int, ...], PythonInterpreter]] = {}
    for path in _listed_candidates(preferred):
        real = _real(path)
        if real in found:
            continue
        info = _python_version_info(path)
        if info is None or info[:2] < _MIN_PYTHON:
            continue
        found[real] = (info, PythonInterpreter(path=path, version=".".join(map(str, info))))
    ranked = sorted(found.values(), key=lambda item: item[0], reverse=True)
    return [interpreter for _, interpreter in ranked]


def validate_python(path: str) -> str:
    """Check `path` is a usable Python >= _MIN_PYTHON; return it with ~ expanded."""
    raw = path.strip()
    if not raw:
        raise InvalidPythonError("Python interpreter path is empty.")
    p = Path(raw).expanduser()
    if not p.is_file():
        raise InvalidPythonError(f"Python interpreter does not exist: {p}")
    if not os.access(p, os.X_OK):
        raise InvalidPythonError(f"Python interpreter is not executable: {p}")
    if _in_virtualenv(p):
        raise InvalidPythonError(
            f"{p} is inside a virtual environment — choose a base Python install instead."
        )
    version = _python_version(str(p))
    if version is None:
        raise InvalidPythonError(f"Could not run {p} as a Python interpreter.")
    if version < _MIN_PYTHON:
        raise InvalidPythonError(
            f"{p} is Python {version[0]}.{version[1]}; dbt-ui needs "
            f"Python {_MIN_PYTHON[0]}.{_MIN_PYTHON[1]} or newer."
        )
    return str(p)


def _base_python_from_cfg(venv_dir: Path) -> str | None:
    """Recover the interpreter a venv was built from via its pyvenv.cfg — for
    venvs created before MARKER_NAME existed."""
    cfg = venv_dir / "pyvenv.cfg"
    if not cfg.is_file():
        return None
    values: dict[str, str] = {}
    for line in cfg.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep:
            values[key.strip()] = value.strip()
    home = values.get("home")
    if not home:
        return None
    major_minor = ".".join(values.get("version", "").split(".")[:2])
    names = (f"python{major_minor}", "python3") if major_minor else ("python3",)
    for name in names:
        candidate = Path(home) / name
        if candidate.is_file():
            return str(candidate)
    return None


def venv_built_from() -> str | None:
    """The interpreter path the current dbt venv was created with, if known."""
    venv_dir = _venv_dir()
    marker = venv_dir / MARKER_NAME
    if marker.is_file():
        return marker.read_text().strip() or None
    return _base_python_from_cfg(venv_dir)


def detect_python() -> str | None:
    """Initial value for the `python_path` setting: whatever the existing venv
    was built from, else the first suitable system interpreter."""
    existing = venv_built_from()
    if existing:
        return existing
    try:
        return find_system_python()
    except RuntimeError:
        return None


def _create_venv(python: str, venv_dir: Path) -> None:
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
    (venv_dir / MARKER_NAME).write_text(python)
    log.info("dbt_venv_created", venv_dir=str(venv_dir))


def rebuild_venv(python: str) -> Path:
    """Delete the dbt venv and recreate it from `python`. Everything installed in
    it (dbt-core, adapters) is gone afterwards — re-run global setup."""
    if is_own_venv():
        raise RuntimeError("Refusing to rebuild the venv dbt-ui itself is running from.")
    venv_dir = _venv_dir()
    with _venv_lock:
        shutil.rmtree(venv_dir, ignore_errors=True)
        _create_venv(python, venv_dir)
    return venv_dir


def _venv_is_current(venv_dir: Path) -> bool:
    marker = venv_dir / "bin" / "python3"
    if not marker.exists():
        return False
    version = _python_version(str(marker))
    if version is None or version < _MIN_PYTHON:
        # Existing venv is too old (e.g. built from a stale search that
        # picked up /usr/bin/python3) — recreate it rather than getting
        # stuck reusing something broken forever.
        log.warning("dbt_venv_too_old", venv_dir=str(venv_dir), found_version=version)
        return False
    if is_own_venv() or _configured_python is None:
        return True
    built_from = venv_built_from()
    if built_from != _configured_python:
        log.info("dbt_venv_python_changed", built_from=built_from, configured=_configured_python)
        return False
    return True


def ensure_venv() -> Path:
    """Create the dbt venv if it doesn't exist yet, or rebuild it if the
    `python_path` setting now names a different interpreter than it was built
    from. Uses the configured interpreter, else the first suitable system one.

    In dev mode this venv is backend/.venv, already created once by
    `task install:backend`. In the packaged app there is no equivalent
    install step, so the first thing that needs the venv creates it here —
    using the *system's* python3, not this (possibly frozen) interpreter:
    venv.create(with_pip=True) run from inside a PyInstaller one-file binary
    fork-bombs, because ensurepip's bootstrap re-execs "python", which
    resolves to the whole frozen app rather than a real interpreter.
    """
    venv_dir = _venv_dir()
    with _venv_lock:
        if _venv_is_current(venv_dir):
            return venv_dir
        if is_own_venv():
            raise RuntimeError(f"Backend venv is missing or unusable: {venv_dir}")
        shutil.rmtree(venv_dir, ignore_errors=True)
        _create_venv(_configured_python or find_system_python(), venv_dir)
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
