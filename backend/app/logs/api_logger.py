"""
Append API request/response log lines to {data_dir}/logs/dbt-ui/api_logs.log.
Also used for structured app-level log events.
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


def append_api_log(line: str) -> None:
    if _api_log_path is None:
        return
    try:
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        with _api_log_path.open("a", encoding="utf-8") as f:
            f.write(f"{ts}  {line}\n")
    except OSError as exc:
        log.warning("api_log_write_failed", error=str(exc))


async def append_api_log_async(line: str) -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, append_api_log, line)


def read_api_log_tail(lines: int = 500) -> list[str]:
    if _api_log_path is None or not _api_log_path.exists():
        return []
    try:
        text = _api_log_path.read_text(encoding="utf-8", errors="replace")
        return text.splitlines()[-lines:]
    except OSError:
        return []
