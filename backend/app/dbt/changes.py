"""Map changed files (from git) to the dbt nodes they change.

Pure functions over the raw ``manifest.json`` dict — no git or I/O here. Used
by the impact API to turn a working-tree / branch diff into the "seed" nodes
whose downstream impact the frontend then computes from the graph.

A file maps to nodes three ways:
- ``original_file_path`` — a model's .sql, a seed's .csv, or the YAML that
  defines sources / exposures
- ``patch_path`` — the schema YAML documenting a model/seed/snapshot (so every
  node patched by a changed YAML counts as changed; this over-approximates)
- macros — a changed root-project macro changes every node that calls it,
  directly or through other macros
"""
from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any, Literal

import yaml

ChangeKind = Literal["added", "modified", "deleted", "renamed"]
ReasonKind = Literal["file", "yaml", "macro"]

# Nodes whose downstream impact is worth showing. Tests, analyses, unit tests
# etc. are still "matched" (so their files aren't reported as unmapped).
IMPACT_RESOURCE_TYPES = frozenset({"model", "seed", "snapshot", "source", "exposure"})

# Files whose change can affect every node (configs, vars, packages).
PROJECT_WIDE_FILES = frozenset({
    "dbt_project.yml", "packages.yml", "dependencies.yml", "selectors.yml", "profiles.yml",
})

# Only these extensions are reported as unmapped; anything else (README, scripts) is ignored.
DBT_FILE_SUFFIXES = frozenset({".sql", ".yml", ".yaml", ".csv", ".py"})

# dbt_project.yml path keys, in order, with dbt's defaults. Unmapped files are
# only reported under these dirs, so e.g. SQL Workspace scratch files don't count.
_RESOURCE_PATH_KEYS = (
    ("model-paths", "models"),
    ("seed-paths", "seeds"),
    ("macro-paths", "macros"),
    ("snapshot-paths", "snapshots"),
    ("test-paths", "tests"),
    ("analysis-paths", "analyses"),
)
DEFAULT_RESOURCE_DIRS = tuple(default for _, default in _RESOURCE_PATH_KEYS)

# Build output and installed packages — never part of the user's change set.
IGNORED_DIRS = frozenset({"target", "dbt_packages", "dbt_modules", "logs"})

_YAML_SUFFIXES = frozenset({".yml", ".yaml"})
_SECTIONS_WITH_FILES = ("nodes", "sources", "exposures", "unit_tests", "semantic_models", "metrics", "saved_queries")


@dataclass(frozen=True)
class ChangedFile:
    path: str  # relative to the dbt project root, POSIX separators
    change: ChangeKind


@dataclass(frozen=True)
class ChangeReason:
    kind: ReasonKind
    path: str
    change: ChangeKind
    macro: str | None = None  # the changed macro's name, for kind == "macro"


@dataclass(frozen=True)
class ChangeMapping:
    nodes: dict[str, tuple[ChangeReason, ...]]  # unique_id -> why it counts as changed
    unmapped: tuple[ChangedFile, ...]           # files in resource dirs not in the manifest (new, deleted, or unparsed)
    project_wide: tuple[ChangedFile, ...]       # dbt_project.yml, packages.yml, …
    relevant_files: int = 0                     # files that matched, are project-wide, or are unmapped


@dataclass(frozen=True)
class _Index:
    resource_type: dict[str, str]
    by_file: dict[str, list[str]]
    by_patch: dict[str, list[str]]
    macro_by_file: dict[str, str]
    macro_name: dict[str, str]
    macro_callers: dict[str, set[str]]      # macro -> macros that call it
    nodes_by_macro: dict[str, list[str]]    # macro -> nodes that call it directly


def _section(manifest: dict[str, Any], key: str) -> dict[str, Any]:
    value = manifest.get(key)
    return value if isinstance(value, dict) else {}


def _depends_on_macros(raw: dict[str, Any]) -> list[str]:
    depends = raw.get("depends_on")
    macros = depends.get("macros") if isinstance(depends, dict) else None
    return [m for m in macros if isinstance(m, str)] if isinstance(macros, list) else []


def _strip_patch_prefix(patch_path: str) -> str:
    """``shop://models/schema.yml`` -> ``models/schema.yml``."""
    _, sep, rest = patch_path.partition("://")
    return rest if sep else patch_path


def _index_nodes(manifest: dict[str, Any]) -> tuple[dict[str, str], dict[str, list[str]], dict[str, list[str]]]:
    resource_type: dict[str, str] = {}
    by_file: dict[str, list[str]] = defaultdict(list)
    by_patch: dict[str, list[str]] = defaultdict(list)
    for section in _SECTIONS_WITH_FILES:
        for uid, raw in _section(manifest, section).items():
            if not isinstance(raw, dict):
                continue
            resource_type[uid] = raw.get("resource_type") or section.rstrip("s")
            if isinstance(raw.get("original_file_path"), str):
                by_file[raw["original_file_path"]].append(uid)
            if isinstance(raw.get("patch_path"), str):
                by_patch[_strip_patch_prefix(raw["patch_path"])].append(uid)
    return resource_type, by_file, by_patch


def _index(manifest: dict[str, Any]) -> _Index:
    resource_type, by_file, by_patch = _index_nodes(manifest)
    project_name = _section(manifest, "metadata").get("project_name")

    macro_by_file: dict[str, str] = {}
    macro_name: dict[str, str] = {}
    macro_callers: dict[str, set[str]] = defaultdict(set)
    for uid, raw in _section(manifest, "macros").items():
        if not isinstance(raw, dict):
            continue
        macro_name[uid] = raw.get("name") or uid.rsplit(".", 1)[-1]
        for callee in _depends_on_macros(raw):
            macro_callers[callee].add(uid)
        # Package macros share relative paths (macros/…) with the root project; only root ones are the user's.
        if raw.get("package_name") == project_name and isinstance(raw.get("original_file_path"), str):
            macro_by_file[raw["original_file_path"]] = uid

    nodes_by_macro: dict[str, list[str]] = defaultdict(list)
    for uid, raw in _section(manifest, "nodes").items():
        if isinstance(raw, dict):
            for macro in _depends_on_macros(raw):
                nodes_by_macro[macro].append(uid)

    return _Index(resource_type, by_file, by_patch, macro_by_file, macro_name, macro_callers, nodes_by_macro)


def _macro_dependents(index: _Index, macro_uid: str) -> list[str]:
    """Nodes calling ``macro_uid`` directly or via any chain of other macros."""
    seen = {macro_uid}
    queue = [macro_uid]
    while queue:
        for caller in index.macro_callers.get(queue.pop(), ()):
            if caller not in seen:
                seen.add(caller)
                queue.append(caller)
    return sorted({n for m in seen for n in index.nodes_by_macro.get(m, ())})


def resource_dirs_from_project_yml(text: str | None) -> tuple[str, ...]:
    """Resource directories configured in dbt_project.yml (dbt defaults for anything unset or invalid)."""
    try:
        data = yaml.safe_load(text) if text else None
    except yaml.YAMLError:
        data = None
    config = data if isinstance(data, dict) else {}
    dirs: list[str] = []
    for key, default in _RESOURCE_PATH_KEYS:
        value = config.get(key)
        paths = [p for p in value if isinstance(p, str)] if isinstance(value, list) else [default]
        dirs += [p.strip("/") for p in paths if p.strip("/")]
    return tuple(dict.fromkeys(dirs))


def _under_any(path: str, dirs: Iterable[str]) -> bool:
    return any(path == d or path.startswith(f"{d}/") for d in dirs)


def _is_ignored(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return bool(parts) and parts[0] in IGNORED_DIRS


def _reasons_for(index: _Index, f: ChangedFile) -> tuple[bool, list[tuple[str, ChangeReason]]]:
    """(matched anything in the manifest, [(node uid, reason)])."""
    suffix = PurePosixPath(f.path).suffix
    direct_kind: ReasonKind = "yaml" if suffix in _YAML_SUFFIXES else "file"
    hits: list[tuple[str, ChangeReason]] = []

    direct = index.by_file.get(f.path, [])
    patched = index.by_patch.get(f.path, [])
    hits += [(uid, ChangeReason(direct_kind, f.path, f.change)) for uid in direct]
    hits += [(uid, ChangeReason("yaml", f.path, f.change)) for uid in patched]

    macro_uid = index.macro_by_file.get(f.path)
    if macro_uid:
        name = index.macro_name.get(macro_uid)
        hits += [(uid, ChangeReason("macro", f.path, f.change, name)) for uid in _macro_dependents(index, macro_uid)]

    matched = bool(direct or patched or macro_uid)
    return matched, [(uid, r) for uid, r in hits if index.resource_type.get(uid) in IMPACT_RESOURCE_TYPES]


def map_changed_files(
    manifest: dict[str, Any],
    files: Iterable[ChangedFile],
    resource_dirs: Iterable[str] = DEFAULT_RESOURCE_DIRS,
) -> ChangeMapping:
    index = _index(manifest)
    dirs = tuple(resource_dirs)
    nodes: dict[str, list[ChangeReason]] = {}
    unmapped: list[ChangedFile] = []
    project_wide: list[ChangedFile] = []
    relevant = 0

    for f in files:
        if _is_ignored(f.path):
            continue
        if f.path in PROJECT_WIDE_FILES:
            project_wide.append(f)
            relevant += 1
            continue
        matched, hits = _reasons_for(index, f)
        for uid, reason in hits:
            existing = nodes.setdefault(uid, [])
            if reason not in existing:
                existing.append(reason)
        if matched:
            relevant += 1
        elif PurePosixPath(f.path).suffix in DBT_FILE_SUFFIXES and _under_any(f.path, dirs):
            unmapped.append(f)
            relevant += 1

    return ChangeMapping(
        nodes={uid: tuple(reasons) for uid, reasons in nodes.items()},
        unmapped=tuple(unmapped),
        project_wide=tuple(project_wide),
        relevant_files=relevant,
    )
