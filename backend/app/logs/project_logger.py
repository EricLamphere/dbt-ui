"""
Append log lines to {project_path}/logs/dbt-ui/project_logs.log and publish
them as `project_log` SSE events on the project bus topic.
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

    gitignore = Path(project_path) / "logs" / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text(_GITIGNORE_CONTENT, encoding="utf-8")

    return log_dir


def append_project_log(project_path: str, line: str, project_id: int | None = None) -> None:
    """Append a timestamped line to the project log file.

    Pass project_id to also publish a `project_log` SSE event so the frontend
    updates in real time without polling.
    """
    try:
        log_dir = _ensure_log_dir(project_path)
        log_file = log_dir / "project_logs.log"
        ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        formatted = f"{ts}  {line}"
        with log_file.open("a", encoding="utf-8") as f:
            f.write(formatted + "\n")

        if project_id is not None:
            # Fire-and-forget: publish to the bus without blocking the caller.
            # Import here to avoid a circular import at module load time.
            from app.events.bus import Event, bus
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(
                    bus.publish(Event(
                        topic=f"project:{project_id}",
                        type="project_log",
                        data={"line": formatted},
                    ))
                )
            except RuntimeError:
                pass  # No running loop (e.g. during tests) — skip publish

    except OSError as exc:
        log.warning("project_log_write_failed", error=str(exc))


async def append_project_log_async(project_path: str, line: str, project_id: int | None = None) -> None:
    """Async wrapper — runs the blocking file write in a thread."""
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, append_project_log, project_path, line, project_id)


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
