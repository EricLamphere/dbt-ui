"""Add stub documentation entries (`- name: <x>`) to a dbt schema YAML file.

These are hand-maintained files, so existing text is never re-serialised:
ruamel.yaml only parses the file to locate line positions, and the new lines
are spliced into the original text in the file's own indentation style. The
result is re-parsed and checked against the expected structure before
anything is written.
"""

import copy
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq
from ruamel.yaml.error import YAMLError
from ruamel.yaml.util import load_yaml_guess_indent

# dbt resource_type → top-level key in a properties YAML file
RESOURCE_KEYS: dict[str, str] = {"model": "models", "seed": "seeds", "snapshot": "snapshots"}

DEFAULT_SCHEMA_FILE = "schema.yml"
YAML_SUFFIXES = (".yml", ".yaml")
DEFAULT_SEQ_OFFSET = 2  # `models:\n  - name:` — dbt's conventional style

_PLAIN_SCALAR = re.compile(r"[A-Za-z_][A-Za-z0-9_$.\-]*")
_RESERVED_SCALARS = {"y", "n", "yes", "no", "on", "off", "true", "false", "null", "~"}


class SchemaYamlError(Exception):
    """The schema file can't be located, parsed or safely edited."""


@dataclass(frozen=True)
class DocumentTarget:
    name: str
    resource_type: str
    original_file_path: str  # relative to the project root
    patch_path: str | None  # "package://relative/path.yml" when already documented


@dataclass(frozen=True)
class DocumentResult:
    path: str  # schema file, relative to the project root (posix)
    created_file: bool
    added_entry: bool
    added_columns: tuple[str, ...]


@dataclass(frozen=True)
class _Edit:
    text: str
    added_entry: bool
    added_columns: tuple[str, ...]


def document_node(
    project_path: Path, target: DocumentTarget, columns: Iterable[str]
) -> DocumentResult:
    resource_key = RESOURCE_KEYS.get(target.resource_type)
    if resource_key is None:
        raise SchemaYamlError(f"documenting a {target.resource_type!r} is not supported")

    root = project_path.resolve()
    schema_file = _resolve_schema_file(root, target, resource_key)
    cols = _clean_columns(columns)
    rel_path = schema_file.relative_to(root).as_posix()

    if not schema_file.exists():
        _write(schema_file, _render_new_file(resource_key, target.name, cols))
        return DocumentResult(rel_path, created_file=True, added_entry=True, added_columns=cols)

    original = _read(schema_file)
    edit = _plan_edit(original, schema_file.name, resource_key, target.name, cols)
    if edit.added_entry or edit.added_columns:
        _verify(original, edit, schema_file.name, resource_key, target.name)
        _write(schema_file, edit.text)
    return DocumentResult(
        rel_path,
        created_file=False,
        added_entry=edit.added_entry,
        added_columns=edit.added_columns,
    )


# ── Locating the file ────────────────────────────────────────────────────────


def _resolve_schema_file(root: Path, target: DocumentTarget, resource_key: str) -> Path:
    if target.patch_path:
        return _inside(root, target.patch_path.split("://", 1)[-1])

    folder = _inside(root, target.original_file_path).parent
    candidates = (
        sorted(p for p in folder.iterdir() if p.is_file() and p.suffix in YAML_SUFFIXES)
        if folder.is_dir()
        else []
    )

    with_key: list[Path] = []
    for path in candidates:
        try:
            data = _parse(_read(path), path.name)
        except SchemaYamlError:
            continue  # a broken sibling shouldn't block documenting this node
        entries = data.get(resource_key)
        if not isinstance(entries, list):
            continue
        if _find_entry(entries, target.name) is not None:
            return path
        with_key.append(path)

    return with_key[0] if with_key else folder / DEFAULT_SCHEMA_FILE


def _inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise SchemaYamlError(f"{relative!r} resolves outside the project")
    return path


# ── Parsing ──────────────────────────────────────────────────────────────────


def _read(path: Path) -> str:
    try:
        with path.open(encoding="utf-8", newline="") as f:  # keep \r\n as-is
            return f.read()
    except (OSError, UnicodeDecodeError) as exc:
        raise SchemaYamlError(f"could not read {path.name}: {exc}") from exc


def _parse(text: str, filename: str) -> CommentedMap:
    try:
        data = YAML().load(text)  # round-trip mode keeps line/column info
    except YAMLError as exc:
        raise SchemaYamlError(f"could not parse {filename}: {exc}") from exc
    if data is None:
        return CommentedMap()
    if not isinstance(data, CommentedMap):
        raise SchemaYamlError(f"{filename} is not a YAML mapping")
    return data


def _seq_offset(text: str) -> int:
    """How far a block sequence's dash sits past its parent key (0 or 2, usually)."""
    try:
        _, _, offset = load_yaml_guess_indent(text)
    except YAMLError:
        return DEFAULT_SEQ_OFFSET
    return DEFAULT_SEQ_OFFSET if offset is None else offset


def _find_entry(entries: list, name: str) -> dict | None:
    return next((e for e in entries if isinstance(e, dict) and e.get("name") == name), None)


def _clean_columns(columns: Iterable[str]) -> tuple[str, ...]:
    seen: set[str] = set()
    cleaned: list[str] = []
    for raw in columns:
        name = raw.strip()
        if name and name.lower() not in seen:
            seen.add(name.lower())
            cleaned.append(name)
    return tuple(cleaned)


# ── Rendering new lines ──────────────────────────────────────────────────────


def _scalar(value: str) -> str:
    if _PLAIN_SCALAR.fullmatch(value) and value.lower() not in _RESERVED_SCALARS:
        return value
    return json.dumps(value)  # a JSON string is a valid double-quoted YAML scalar


def _column_lines(dash_col: int, columns: tuple[str, ...]) -> list[str]:
    return [f"{' ' * dash_col}- name: {_scalar(c)}\n" for c in columns]


def _entry_lines(dash_col: int, offset: int, name: str, columns: tuple[str, ...]) -> list[str]:
    key_col = dash_col + 2
    lines = [f"{' ' * dash_col}- name: {_scalar(name)}\n"]
    if columns:
        lines.append(f"{' ' * key_col}columns:\n")
        lines.extend(_column_lines(key_col + offset, columns))
    return lines


def _render_new_file(resource_key: str, name: str, columns: tuple[str, ...]) -> str:
    body = _entry_lines(DEFAULT_SEQ_OFFSET, DEFAULT_SEQ_OFFSET, name, columns)
    return f"version: 2\n\n{resource_key}:\n" + "".join(body)


# ── Planning the splice ──────────────────────────────────────────────────────


def _plan_edit(
    text: str, filename: str, resource_key: str, name: str, columns: tuple[str, ...]
) -> _Edit:
    data = _parse(text, filename)
    lines = text.splitlines(keepends=True)
    offset = _seq_offset(text)
    file_end = len(lines)

    if resource_key not in data:
        block = [f"{resource_key}:\n", *_entry_lines(offset, offset, name, columns)]
        lead = ["\n"] if text.strip() else ["version: 2\n", "\n"]
        return _splice(lines, file_end, lead + block, True, columns)

    key_line, key_col = data.lc.key(resource_key)
    key_end = _key_bound(data, resource_key, file_end)
    entries = data[resource_key]

    if entries is None:
        new = _entry_lines(key_col + offset, offset, name, columns)
        return _splice(lines, _after_content(lines, key_line, key_end), new, True, columns)
    if not isinstance(entries, list):
        raise SchemaYamlError(f"`{resource_key}` in {filename} is not a list")
    _require_block(lines, key_line, f"`{resource_key}` in {filename}")

    index = next(
        (i for i, e in enumerate(entries) if isinstance(e, dict) and e.get("name") == name), None
    )
    if index is None:
        dash_col = _dash_col(lines, entries, key_col + offset)
        new = _entry_lines(dash_col, offset, name, columns)
        return _splice(lines, _after_content(lines, key_line, key_end), new, True, columns)

    entry_end = entries.lc.item(index + 1)[0] if index + 1 < len(entries) else key_end
    return _plan_columns(
        lines, entries[index], entries.lc.item(index)[0], entry_end, offset, columns
    )


def _plan_columns(
    lines: list[str],
    entry: CommentedMap,
    entry_line: int,
    entry_end: int,
    offset: int,
    columns: tuple[str, ...],
) -> _Edit:
    existing_cols = entry.get("columns")
    if existing_cols is not None and not isinstance(existing_cols, list):
        raise SchemaYamlError(f"`columns` for {entry.get('name')!r} is not a list")

    existing = {
        str(c.get("name", "")).lower() for c in existing_cols or [] if isinstance(c, dict)
    }
    to_add = tuple(c for c in columns if c.lower() not in existing)
    if not to_add:
        return _Edit(text="".join(lines), added_entry=False, added_columns=())

    if "columns" not in entry:
        key_col = entry.lc.key(next(iter(entry)))[1]
        new = [f"{' ' * key_col}columns:\n", *_column_lines(key_col + offset, to_add)]
        return _splice(lines, _after_content(lines, entry_line, entry_end), new, False, to_add)

    cols_line, cols_col = entry.lc.key("columns")
    cols_end = _key_bound(entry, "columns", entry_end)
    _require_block(lines, cols_line, f"`columns` for {entry.get('name')!r}")
    dash_col = _dash_col(lines, existing_cols, cols_col + offset)
    new = _column_lines(dash_col, to_add)
    return _splice(lines, _after_content(lines, cols_line, cols_end), new, False, to_add)


def _key_bound(mapping: CommentedMap, key: str, parent_end: int) -> int:
    """First line after `key`'s value: the next sibling key's line, or the parent's end."""
    keys = list(mapping)
    position = keys.index(key)
    return mapping.lc.key(keys[position + 1])[0] if position + 1 < len(keys) else parent_end


def _after_content(lines: list[str], start: int, end: int) -> int:
    """Index just past the last non-blank, non-comment line in [start, end)."""
    for i in range(min(end, len(lines)) - 1, start - 1, -1):
        stripped = lines[i].strip()
        if stripped and not stripped.startswith("#"):
            return i + 1
    return start + 1


def _dash_col(lines: list[str], seq: CommentedSeq | None, fallback: int) -> int:
    if not seq:
        return fallback
    line = lines[seq.lc.item(0)[0]]
    dash = line.find("-")
    return dash if dash >= 0 else fallback


def _require_block(lines: list[str], key_line: int, label: str) -> None:
    """Reject `key: [...]` — new block-style lines can't be appended to an inline list."""
    value = lines[key_line].split(":", 1)[-1].strip()
    if value.startswith("["):
        raise SchemaYamlError(
            f"{label} uses inline [...] syntax — convert it to a block list to add entries"
        )


def _splice(
    lines: list[str], at: int, new: list[str], added_entry: bool, added_columns: tuple[str, ...]
) -> _Edit:
    newline = "\r\n" if lines and lines[0].endswith("\r\n") else "\n"
    before = list(lines[:at])
    if before and not before[-1].endswith(("\n", "\r")):
        before[-1] += newline
    inserted = [ln.replace("\n", newline) for ln in new]
    return _Edit(
        text="".join(before + inserted + lines[at:]),
        added_entry=added_entry,
        added_columns=added_columns,
    )


# ── Safety net + IO ──────────────────────────────────────────────────────────


def _plain(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))


def _verify(original: str, edit: _Edit, filename: str, resource_key: str, name: str) -> None:
    """Re-parse the spliced text and require it to equal the original plus our additions."""
    expected = copy.deepcopy(_plain(_parse(original, filename)))
    entries = expected.get(resource_key) or []
    expected[resource_key] = entries
    entry = _find_entry(entries, name)
    if entry is None:
        entry = {"name": name}
        entries.append(entry)
    if edit.added_columns:
        entry["columns"] = (entry.get("columns") or []) + [
            {"name": c} for c in edit.added_columns
        ]

    try:
        actual = _plain(_parse(edit.text, filename))
    except SchemaYamlError as exc:
        raise SchemaYamlError(f"could not safely edit {filename}: {exc}") from exc
    if actual != expected:
        raise SchemaYamlError(
            f"could not safely edit {filename} — its layout is unusual; add the entries by hand"
        )


def _write(path: Path, text: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as f:
            f.write(text)
    except OSError as exc:
        raise SchemaYamlError(f"could not write {path.name}: {exc}") from exc
