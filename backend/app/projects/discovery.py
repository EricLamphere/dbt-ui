from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import yaml

from app.logging_setup import get_logger

log = get_logger(__name__)

EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "dbt_packages",
    "logs",
    ".dbt",
}


@dataclass(frozen=True)
class DiscoveredProject:
    name: str
    path: Path
    profile: str | None
    platform: str


def _iter_dbt_project_files(root: Path) -> Iterator[Path]:
    if not root.exists():
        return
    stack: list[Path] = [root]
    while stack:
        current = stack.pop()
        try:
            entries = list(current.iterdir())
        except (PermissionError, OSError) as exc:
            log.warning("discovery_skip_dir", path=str(current), error=str(exc))
            continue
        for entry in entries:
            if entry.is_dir():
                if entry.name in EXCLUDE_DIRS or entry.name.startswith("."):
                    continue
                stack.append(entry)
                continue
            if entry.name == "dbt_project.yml":
                yield entry


def _infer_platform(project_dir: Path, profile: str | None) -> str:
    """Best-effort platform inference from profiles.yml if present; fall back to 'unknown'."""
    candidates = [
        project_dir / "profiles.yml",
        project_dir.parent / "profiles.yml",
        Path.home() / ".dbt" / "profiles.yml",
    ]
    for profiles_path in candidates:
        if not profiles_path.exists():
            continue
        try:
            data = yaml.safe_load(profiles_path.read_text()) or {}
        except yaml.YAMLError:
            continue
        if profile and profile in data:
            outputs = (data[profile] or {}).get("outputs") or {}
            default_target = (data[profile] or {}).get("target")
            target_cfg = outputs.get(default_target) if default_target else None
            if not target_cfg and outputs:
                target_cfg = next(iter(outputs.values()))
            if isinstance(target_cfg, dict) and target_cfg.get("type"):
                return str(target_cfg["type"])
    return "unknown"


def discover_projects(root: Path) -> list[DiscoveredProject]:
    results: list[DiscoveredProject] = []
    for project_file in _iter_dbt_project_files(root):
        try:
            data = yaml.safe_load(project_file.read_text()) or {}
        except yaml.YAMLError as exc:
            log.warning("discovery_bad_yaml", path=str(project_file), error=str(exc))
            continue
        name = data.get("name")
        if not isinstance(name, str) or not name:
            continue
        profile = data.get("profile")
        profile_str = profile if isinstance(profile, str) else None
        project_dir = project_file.parent
        platform = _infer_platform(project_dir, profile_str)
        results.append(
            DiscoveredProject(
                name=name,
                path=project_dir.resolve(),
                profile=profile_str,
                platform=platform,
            )
        )
    results.sort(key=lambda p: p.name.lower())
    return results
