import stat
from dataclasses import dataclass
from pathlib import Path

INIT_DIR_NAME = "init"

BASE_STEPS: tuple[tuple[str, str], ...] = (
    ("base: pip install", "pip install -r requirements.txt"),
    ("base: dbt deps", "dbt deps"),
)


@dataclass(frozen=True)
class InitScript:
    name: str
    path: Path
    content: str


def init_dir(project_path: Path, subdir: str = INIT_DIR_NAME) -> Path:
    return project_path / subdir


def list_scripts(project_path: Path, subdir: str = INIT_DIR_NAME) -> list[InitScript]:
    d = init_dir(project_path, subdir)
    if not d.exists():
        return []
    scripts: list[InitScript] = []
    for entry in sorted(d.iterdir()):
        if entry.is_file() and entry.suffix == ".sh":
            try:
                content = entry.read_text()
            except OSError:
                content = ""
            scripts.append(InitScript(name=entry.stem, path=entry, content=content))
    return scripts


def save_script(project_path: Path, name: str, content: str, subdir: str = INIT_DIR_NAME) -> InitScript:
    if not name or "/" in name or name.startswith("."):
        raise ValueError("invalid script name")
    d = init_dir(project_path, subdir)
    d.mkdir(parents=True, exist_ok=True)
    file_path = d / f"{name}.sh"
    file_path.write_text(content)
    mode = file_path.stat().st_mode
    file_path.chmod(mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    return InitScript(name=name, path=file_path, content=content)


def delete_script(project_path: Path, name: str, subdir: str = INIT_DIR_NAME) -> bool:
    file_path = init_dir(project_path, subdir) / f"{name}.sh"
    if file_path.exists() and file_path.is_file():
        file_path.unlink()
        return True
    return False
