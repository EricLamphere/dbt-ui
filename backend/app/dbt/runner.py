import asyncio
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from app.events.bus import Event, bus
from app.logging_setup import get_logger
from app.logs.project_logger import append_project_log

log = get_logger(__name__)


@dataclass
class RunRequest:
    project_id: int
    project_path: Path
    command: str  # run, build, test, deps, ls
    select: str | None = None
    extra: tuple[str, ...] = ()
    env: dict[str, str] | None = None  # if None, inherits process environment


class DbtRunner:
    """Serializes dbt invocations per project (dbt is not parallel-safe in-process)."""

    def __init__(self) -> None:
        self._locks: dict[int, asyncio.Lock] = {}

    def _lock_for(self, project_id: int) -> asyncio.Lock:
        lock = self._locks.get(project_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[project_id] = lock
        return lock

    def build_args(self, req: RunRequest) -> list[str]:
        args = ["dbt", req.command]
        if (req.project_path / "profiles.yml").exists():
            args += ["--profiles-dir", str(req.project_path)]
        if req.select:
            args += ["--select", req.select]
        args += list(req.extra)
        return args

    async def stream(self, req: RunRequest) -> AsyncIterator[tuple[str, str]]:
        lock = self._lock_for(req.project_id)
        async with lock:
            args = self.build_args(req)
            topic = f"project:{req.project_id}"
            started_at = datetime.now(timezone.utc).isoformat()
            await bus.publish(
                Event(
                    topic=topic,
                    type="run_started",
                    data={
                        "command": req.command,
                        "select": req.select,
                        "started_at": started_at,
                    },
                )
            )
            log.info("dbt_invoke", project=req.project_id, args=args, cwd=str(req.project_path))
            selector_part = f" --select {req.select}" if req.select else ""
            append_project_log(str(req.project_path), f">>> dbt {req.command}{selector_part}")
            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    cwd=str(req.project_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.STDOUT,
                    env=req.env,
                )
            except FileNotFoundError:
                await bus.publish(
                    Event(
                        topic=topic,
                        type="run_error",
                        data={"message": "dbt executable not found on PATH"},
                    )
                )
                append_project_log(str(req.project_path), "ERROR: dbt executable not found on PATH")
                yield ("stderr", "dbt executable not found on PATH\n")
                return

            assert proc.stdout is not None
            while True:
                raw = await proc.stdout.readline()
                if not raw:
                    break
                line = raw.decode(errors="replace").rstrip("\n")
                await bus.publish(
                    Event(topic=topic, type="run_log", data={"line": line})
                )
                append_project_log(str(req.project_path), line)
                yield ("stdout", line)
            return_code = await proc.wait()
            finished_at = datetime.now(timezone.utc).isoformat()
            await bus.publish(
                Event(
                    topic=topic,
                    type="run_finished",
                    data={
                        "command": req.command,
                        "select": req.select,
                        "return_code": return_code,
                        "finished_at": finished_at,
                    },
                )
            )
            status = "OK" if return_code == 0 else f"FAILED (rc={return_code})"
            append_project_log(str(req.project_path), f"<<< dbt {req.command} {status}")


runner = DbtRunner()
