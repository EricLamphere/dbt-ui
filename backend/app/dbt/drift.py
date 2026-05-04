from dataclasses import dataclass

from app.dbt.manifest import ColumnInfo, ModelNode


@dataclass(frozen=True)
class ColumnDrift:
    name: str
    in_manifest: bool
    in_warehouse: bool
    manifest_type: str
    warehouse_type: str  # always "" — dbt show --limit 0 doesn't expose types
    type_mismatch: bool  # True only when both types are known and differ


@dataclass(frozen=True)
class ModelDriftResult:
    unique_id: str
    name: str
    materialized: str | None
    error: str | None  # non-empty when the probe failed
    columns: tuple[ColumnDrift, ...]
    has_drift: bool


def diff_columns(
    manifest_cols: tuple[ColumnInfo, ...],
    warehouse_cols: tuple[str, ...],
) -> tuple[ColumnDrift, ...]:
    manifest_names = {c.name.lower(): c for c in manifest_cols}
    warehouse_names = {c.lower(): c for c in warehouse_cols}
    all_names = sorted(set(manifest_names) | set(warehouse_names))

    result: list[ColumnDrift] = []
    for name_lower in all_names:
        m_col = manifest_names.get(name_lower)
        w_name = warehouse_names.get(name_lower)
        in_manifest = m_col is not None
        in_warehouse = w_name is not None
        manifest_type = m_col.data_type if m_col else ""
        warehouse_type = ""
        type_mismatch = (
            bool(manifest_type and warehouse_type)
            and manifest_type.lower() != warehouse_type.lower()
        )
        display_name = m_col.name if m_col else (w_name or name_lower)
        result.append(
            ColumnDrift(
                name=display_name,
                in_manifest=in_manifest,
                in_warehouse=in_warehouse,
                manifest_type=manifest_type,
                warehouse_type=warehouse_type,
                type_mismatch=type_mismatch,
            )
        )
    return tuple(result)


def is_eligible_for_drift_check(node: ModelNode) -> bool:
    return (
        node.resource_type in ("model", "snapshot", "seed")
        and node.materialized in ("table", "incremental", "snapshot", "seed")
    )
