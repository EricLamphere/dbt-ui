import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.logging_setup import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class ColumnInfo:
    name: str
    description: str
    data_type: str


@dataclass(frozen=True)
class ModelNode:
    unique_id: str
    name: str
    resource_type: str  # model, seed, source, snapshot, test
    schema_: str | None
    database: str | None
    materialized: str | None
    tags: tuple[str, ...]
    description: str
    original_file_path: str | None
    raw_sql: str | None
    compiled_sql: str | None = None
    source_name: str | None = None  # set for resource_type == "source"
    columns: tuple[ColumnInfo, ...] = field(default_factory=tuple)

    def to_dict(self) -> dict[str, Any]:
        return {
            "unique_id": self.unique_id,
            "name": self.name,
            "resource_type": self.resource_type,
            "schema": self.schema_,
            "database": self.database,
            "materialized": self.materialized,
            "tags": list(self.tags),
            "description": self.description,
            "original_file_path": self.original_file_path,
            "source_name": self.source_name,
            "columns": [
                {"name": c.name, "description": c.description, "data_type": c.data_type}
                for c in self.columns
            ],
        }


@dataclass(frozen=True)
class Manifest:
    nodes: tuple[ModelNode, ...]
    parents: dict[str, tuple[str, ...]]  # unique_id -> parent unique_ids

    def edges(self) -> list[tuple[str, str]]:
        pairs: list[tuple[str, str]] = []
        node_ids = {n.unique_id for n in self.nodes}
        for child, parents in self.parents.items():
            if child not in node_ids:
                continue
            for parent in parents:
                if parent in node_ids:
                    pairs.append((parent, child))
        return pairs


def _extract_node(unique_id: str, raw: dict[str, Any]) -> ModelNode | None:
    resource_type = raw.get("resource_type")
    if resource_type not in {"model", "seed", "snapshot", "test", "source"}:
        return None
    config = raw.get("config") or {}
    raw_columns: dict[str, Any] = raw.get("columns") or {}
    columns = tuple(
        ColumnInfo(
            name=k,
            description=v.get("description") or "" if isinstance(v, dict) else "",
            data_type=v.get("data_type") or "" if isinstance(v, dict) else "",
        )
        for k, v in raw_columns.items()
    )
    return ModelNode(
        unique_id=unique_id,
        name=raw.get("name") or unique_id.split(".")[-1],
        resource_type=resource_type,
        schema_=raw.get("schema"),
        database=raw.get("database"),
        materialized=config.get("materialized") if isinstance(config, dict) else None,
        tags=tuple(raw.get("tags") or ()),
        description=raw.get("description") or "",
        original_file_path=raw.get("original_file_path"),
        raw_sql=raw.get("raw_code") or raw.get("raw_sql"),
        compiled_sql=raw.get("compiled_code") or raw.get("compiled_sql"),
        source_name=raw.get("source_name") if resource_type == "source" else None,
        columns=columns,
    )


def load_manifest(manifest_path: Path) -> Manifest | None:
    if not manifest_path.exists():
        return None
    try:
        data = json.loads(manifest_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("manifest_read_failed", path=str(manifest_path), error=str(exc))
        return None

    nodes: list[ModelNode] = []
    parents: dict[str, tuple[str, ...]] = {}

    raw_nodes: dict[str, Any] = data.get("nodes") or {}
    for unique_id, raw in raw_nodes.items():
        node = _extract_node(unique_id, raw)
        if node is not None:
            nodes.append(node)

    raw_sources: dict[str, Any] = data.get("sources") or {}
    for unique_id, raw in raw_sources.items():
        node = _extract_node(unique_id, {**raw, "resource_type": "source"})
        if node is not None:
            nodes.append(node)

    # parent_map in manifest.json: { unique_id: [parent_ids] }
    parent_map = data.get("parent_map") or {}
    if isinstance(parent_map, dict):
        for child, parent_list in parent_map.items():
            if isinstance(parent_list, list):
                parents[child] = tuple(p for p in parent_list if isinstance(p, str))

    return Manifest(nodes=tuple(nodes), parents=parents)
