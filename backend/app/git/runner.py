import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from app.events.bus import Event, bus
from app.logging_setup import get_logger

log = get_logger(__name__)


@dataclass
class GitRequest:
    project_id: int
    repo_root: Path
    args: tuple[str, ...]           # full git argument list (everything after "git")
    env: dict[str, str] | None = field(default=None)  # None → inherit process env


class GitRunner:
    """Serializes git invocations per project, same pattern as DbtRunner."""

    def __init__(self) -> None:
        self._locks: dict[int, asyncio.Lock] = {}

    def _lock_for(self, project_id: int) -> asyncio.Lock:
        lock = self._locks.get(project_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[project_id] = lock
        return lock

    async def run(self, req: GitRequest) -> tuple[int, str]:
        """Run a git command and return (return_code, combined_output).

        Does NOT publish bus events — callers that need SSE streaming use stream() instead.
        Use this for short, non-user-visible ops (stage, unstage, commit, branch, checkout).
        """
        lock = self._lock_for(req.project_id)
        async with lock:
            try:
                proc = await asyncio.create_subprocess_exec(
                    "git",
                    *req.args,
                    cwd=str(req.repo_root),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=req.env,
                )
            except FileNotFoundError:
                return (127, "git executable not found on PATH")
            stdout, _ = await proc.communicate()
            return (proc.returncode or 0, stdout.decode(errors="replace"))

    async def stream(self, req: GitRequest) -> AsyncIterator[tuple[str, str]]:
        """Stream a long-running git command (push/pull), publishing bus events.

        Yields (kind, line) tuples exactly like DbtRunner.stream.
        Publishes git_started / git_log / git_finished to topic project:{id}.
        """
        lock = self._lock_for(req.project_id)
        async with lock:
            topic = f"project:{req.project_id}"
            started_at = datetime.now(timezone.utc).isoformat()
            cmd_str = "git " + " ".join(req.args)
            await bus.publish(Event(
                topic=topic,
                type="git_started",
                data={"command": cmd_str, "started_at": started_at},
            ))
            log.info("git_invoke", project=req.project_id, args=req.args, cwd=str(req.repo_root))
            try:
                proc = await asyncio.create_subprocess_exec(
                    "git",
                    *req.args,
                    cwd=str(req.repo_root),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=req.env,
                )
            except FileNotFoundError:
                await bus.publish(Event(
                    topic=topic,
                    type="git_error",
                    data={"message": "git executable not found on PATH"},
                ))
                yield ("stderr", "git executable not found on PATH\n")
                return

            assert proc.stdout is not None
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip("\n")
                await bus.publish(Event(topic=topic, type="git_log", data={"line": line}))
                yield ("stdout", line)

            return_code = await proc.wait()
            finished_at = datetime.now(timezone.utc).isoformat()
            await bus.publish(Event(
                topic=topic,
                type="git_finished",
                data={
                    "command": cmd_str,
                    "return_code": return_code,
                    "finished_at": finished_at,
                },
            ))


git_runner = GitRunner()
