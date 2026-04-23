from pathlib import Path


def _backend_root() -> Path:
    # this file is backend/app/dbt/venv.py → parents[2] is backend/
    return Path(__file__).resolve().parents[2]


def venv_dbt() -> Path:
    p = _backend_root() / ".venv" / "bin" / "dbt"
    if not p.exists():
        raise RuntimeError(f"dbt not found in backend venv: {p}")
    return p


def venv_pip() -> Path:
    p = _backend_root() / ".venv" / "bin" / "pip"
    if not p.exists():
        raise RuntimeError(f"pip not found in backend venv: {p}")
    return p


def venv_python() -> Path:
    p = _backend_root() / ".venv" / "bin" / "python"
    if not p.exists():
        raise RuntimeError(f"python not found in backend venv: {p}")
    return p
