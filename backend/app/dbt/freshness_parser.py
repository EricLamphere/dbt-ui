import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.logging_setup import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class SourceFreshnessResult:
    unique_id: str
    source_name: str
    table_name: str
    status: str  # pass | warn | error | runtime error
    max_loaded_at: str | None       # ISO datetime string
    snapshotted_at: str | None      # ISO datetime string
    age_seconds: float | None
    warn_after_count: int | None
    warn_after_period: str | None   # minute | hour | day
    error_after_count: int | None
    error_after_period: str | None
    error: str | None


def _parse_threshold(raw: Any) -> tuple[int | None, str | None]:
    if not isinstance(raw, dict):
        return None, None
    count = raw.get("count")
    period = raw.get("period")
    return (int(count) if count is not None else None), (str(period) if period else None)


def _dt_str(val: Any) -> str | None:
    if not val:
        return None
    return str(val)


def load_freshness_results(sources_path: Path) -> list[SourceFreshnessResult]:
    """Parse target/sources.json written by `dbt source freshness`."""
    if not sources_path.exists():
        return []
    try:
        data = json.loads(sources_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("sources_json_read_failed", path=str(sources_path), error=str(exc))
        return []

    raw_results: list[dict[str, Any]] = data.get("results") or []
    out: list[SourceFreshnessResult] = []

    for entry in raw_results:
        unique_id = entry.get("unique_id", "")
        # unique_id format: source.<project>.<source_name>.<table_name>
        parts = unique_id.split(".")
        source_name = parts[2] if len(parts) >= 3 else ""
        table_name = parts[3] if len(parts) >= 4 else entry.get("unique_id", "")

        status = str(entry.get("status") or "error").lower()

        timing = entry.get("timing") or []
        snapshotted_at: str | None = None
        for t in timing:
            if isinstance(t, dict) and t.get("name") == "execute":
                snapshotted_at = _dt_str(t.get("completed_at"))
                break

        # Freshness-specific fields live under the top-level result or in a nested dict
        max_loaded_at = _dt_str(entry.get("max_loaded_at"))
        age_seconds_raw = entry.get("max_loaded_at_time_ago_in_s")
        age_seconds = float(age_seconds_raw) if age_seconds_raw is not None else None

        # Thresholds come from the criteria block (dbt ≥1.5) or top-level keys
        criteria = entry.get("criteria") or {}
        warn_count, warn_period = _parse_threshold(criteria.get("warn_after"))
        error_count, error_period = _parse_threshold(criteria.get("error_after"))

        error_msg: str | None = None
        if status in ("runtime error", "error") and not max_loaded_at:
            error_msg = entry.get("message")

        out.append(SourceFreshnessResult(
            unique_id=unique_id,
            source_name=source_name,
            table_name=table_name,
            status=status,
            max_loaded_at=max_loaded_at,
            snapshotted_at=snapshotted_at,
            age_seconds=age_seconds,
            warn_after_count=warn_count,
            warn_after_period=warn_period,
            error_after_count=error_count,
            error_after_period=error_period,
            error=error_msg,
        ))

    return out
