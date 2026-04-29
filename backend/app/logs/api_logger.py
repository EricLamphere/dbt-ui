"""
Append API request/response log lines to {data_dir}/logs/dbt-ui/api_logs.log
and publish them as `api_log` SSE events on the relevant project bus topic.
"""

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from app.logging_setup import get_logger

log = get_logger(__name__)

_api_log_path: Path | None = None


def configure_api_log(data_dir: Path) -> Path:
    """Call once at startup to set the log path. Returns the path."""
    global _api_log_path
    log_dir = data_dir / "logs" / "dbt-ui"
    log_dir.mkdir(parents=True, exist_ok=True)
    _api_log_path = log_dir / "api_logs.log"
    return _api_log_path


def get_api_log_path() -> Path | None:
    return _api_log_path


def append_api_log(line: str, project_id: int | None = None) -> None:
    """Append a timestamped line to the API log file.

    Pass project_id to also publish an `api_log` SSE event so the frontend
    updates the API log panel in real time without polling.
    """
    if _api_log_path is None:
        return
    try:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        formatted = f"{ts}  {line}"
        with _api_log_path.open("a", encoding="utf-8") as f:
            f.write(formatted + "\n")

        if project_id is not None:
            from app.events.bus import Event, bus
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(
                    bus.publish(Event(
                        topic=f"project:{project_id}",
                        type="api_log",
                        data={"line": formatted},
                    ))
                )
            except RuntimeError:
                pass  # No running loop — skip publish

    except OSError as exc:
        log.warning("api_log_write_failed", error=str(exc))


async def append_api_log_async(line: str, project_id: int | None = None) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, append_api_log, line, project_id)


def read_api_log_tail(lines: int = 500) -> list[str]:
    if _api_log_path is None or not _api_log_path.exists():
        return []
    try:
        text = _api_log_path.read_text(encoding="utf-8", errors="replace")
        return text.splitlines()[-lines:]
    except OSError:
        return []
