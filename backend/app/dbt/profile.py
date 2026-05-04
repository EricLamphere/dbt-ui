from dataclasses import dataclass


_NUMERIC_TYPES = {
    "int", "integer", "int2", "int4", "int8", "int16", "int32", "int64",
    "bigint", "smallint", "tinyint", "byteint",
    "float", "float4", "float8", "float16", "float32", "float64",
    "double", "real", "numeric", "decimal", "number", "bignumeric",
    "date", "datetime", "timestamp", "timestamptz", "timestamp_tz",
    "timestamp_ntz", "timestamp_ltz", "time", "timetz",
}


@dataclass(frozen=True)
class ProfileColumnSpec:
    name: str
    data_type: str  # "" if unknown
    profile_min_max: bool  # False for text/json/array/unknown types


def numeric_or_temporal(data_type: str) -> bool:
    """Return True for types where MIN/MAX is meaningful and cheap."""
    normalized = data_type.lower().split("(")[0].strip()
    return normalized in _NUMERIC_TYPES


def build_profile_sql(ref_expr: str, cols: tuple[ProfileColumnSpec, ...]) -> str:
    """Build a single-row profiling SELECT using Jinja-safe constructs.

    Uses {{ adapter.quote('col') }} so dbt resolves quoting per warehouse.
    Returns COUNT(*) plus per-column null count, distinct count, and min/max
    for all columns (min/max works on text types too and gives useful range info).
    """
    if not cols:
        return f"select count(*) as total_rows from {ref_expr}"

    select_parts = ["count(*) as total_rows"]
    for col in cols:
        q = "{{{{ adapter.quote('{name}') }}}}".format(name=col.name.replace("'", "\\'"))
        alias_base = col.name.replace('"', "").replace(" ", "_")
        select_parts.append(
            f"sum(case when {q} is null then 1 else 0 end) as \"{alias_base}__nulls\""
        )
        select_parts.append(
            f"count(distinct {q}) as \"{alias_base}__distinct\""
        )
        select_parts.append(f"min({q}) as \"{alias_base}__min\"")
        select_parts.append(f"max({q}) as \"{alias_base}__max\"")

    parts_sql = ",\n    ".join(select_parts)
    return f"select\n    {parts_sql}\nfrom {ref_expr}"
