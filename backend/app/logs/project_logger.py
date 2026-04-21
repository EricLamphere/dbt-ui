"""
Append log lines to {project_path}/logs/dbt-ui/project_logs.log.

The logs/ directory is gitignored automatically when first created.
"""

import asyncio
from datetime import datetime, timezone
from pathlib import Path

from app.logging_setup import get_logger

log = get_logger(__name__)

_GITIGNORE_CONTENT = "*\n"


def _ensure_log_dir(project_path: str) -> Path:
    log_dir = Path(project_path) / "logs" / "dbt-ui"
    log_dir.mkdir(parents=True, exist_ok=True)

    # Write a .gitignore inside logs/ so the whole directory is ignored
    gitignore = Path(project_path) / "logs" / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text(_GITIGNORE_CONTENT, encoding="utf-8")

    return log_dir


def append_project_log(project_path: str, line: str) -> None:
    """Synchronously append a timestamped line to the project log file."""
    try:
        log_dir = _ensure_log_dir(project_path)
        log_file = log_dir / "project_logs.log"
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        with log_file.open("a", encoding="utf-8") as f:
            f.write(f"{ts}  {line}\n")
    except OSError as exc:
        log.warning("project_log_write_failed", error=str(exc))


async def append_project_log_async(project_path: str, line: str) -> None:
    """Async wrapper — runs the blocking write in a thread so it doesn't block the event loop."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, append_project_log, project_path, line)


def read_project_log_tail(project_path: str, lines: int = 500) -> list[str]:
    """Return the last N lines of the project log file."""
    log_file = Path(project_path) / "logs" / "dbt-ui" / "project_logs.log"
    if not log_file.exists():
        return []
    try:
        text = log_file.read_text(encoding="utf-8", errors="replace")
        return text.splitlines()[-lines:]
    except OSError:
        return []
