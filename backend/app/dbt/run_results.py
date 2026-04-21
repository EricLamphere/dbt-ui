import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.logging_setup import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class NodeResult:
    unique_id: str
    status: str  # success | error | fail | pass | skipped | warn | runtime error
    message: str | None
    execution_time: float | None


def _normalize_status(raw: str | None) -> str:
    if not raw:
        return "idle"
    lower = raw.lower().strip()
    mapping = {
        "success": "success",
        "pass": "success",
        "error": "error",
        "fail": "error",
        "runtime error": "error",
        "skipped": "idle",
        "warn": "warn",
    }
    return mapping.get(lower, lower)


def load_run_results(run_results_path: Path) -> list[NodeResult]:
    if not run_results_path.exists():
        return []
    try:
        data = json.loads(run_results_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("run_results_read_failed", path=str(run_results_path), error=str(exc))
        return []

    results: list[NodeResult] = []
    raw_results: list[dict[str, Any]] = data.get("results") or []
    for entry in raw_results:
        unique_id = entry.get("unique_id")
        if not isinstance(unique_id, str):
            continue
        results.append(
            NodeResult(
                unique_id=unique_id,
                status=_normalize_status(entry.get("status")),
                message=entry.get("message"),
                execution_time=entry.get("execution_time"),
            )
        )
    return results
