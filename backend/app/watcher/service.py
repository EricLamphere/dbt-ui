import asyncio
from pathlib import Path

from sqlalchemy import select
from watchfiles import Change, awatch

from app.db.engine import SessionLocal
from app.db.models import ModelStatus, Project
from app.events.bus import Event, bus
from app.logging_setup import get_logger

log = get_logger(__name__)

WATCHED_SUBDIRS = ("models", "tests", "seeds", "snapshots", "macros", "analyses")
TARGET_FILES = ("target/manifest.json", "target/run_results.json")


class WatcherManager:
    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task] = {}
        self._stop = asyncio.Event()

    async def start(self) -> None:
        self._stop.clear()
        asyncio.create_task(self._supervisor_loop())

    async def stop(self) -> None:
        self._stop.set()
        for task in list(self._tasks.values()):
            task.cancel()
        self._tasks.clear()

    async def _supervisor_loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self._sync_watchers()
            except Exception as exc:
                log.warning("watcher_sync_error", error=str(exc))
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=10.0)
            except asyncio.TimeoutError:
                pass

    async def _sync_watchers(self) -> None:
        async with SessionLocal() as session:
            result = await session.execute(select(Project))
            projects = list(result.scalars().all())
        want = {p.id: Path(p.path) for p in projects}
        for pid in list(self._tasks.keys()):
            if pid not in want:
                self._tasks.pop(pid).cancel()
        for pid, path in want.items():
            if pid not in self._tasks and path.exists():
                self._tasks[pid] = asyncio.create_task(self._watch(pid, path))

    async def _watch(self, project_id: int, project_path: Path) -> None:
        log.info("watcher_start", project_id=project_id, path=str(project_path))
        topic = f"project:{project_id}"
        try:
            async for changes in awatch(
                project_path, stop_event=self._stop, debounce=200, recursive=True
            ):
                await self._handle_changes(project_id, project_path, topic, changes)
        except asyncio.CancelledError:
            pass
        except Exception as exc:
            log.warning("watcher_error", project_id=project_id, error=str(exc))

    async def _handle_changes(
        self,
        project_id: int,
        project_path: Path,
        topic: str,
        changes: set[tuple[Change, str]],
    ) -> None:
        changed_files = [Path(p) for _, p in changes]
        manifest_or_results = any(
            str(p).endswith(("manifest.json", "run_results.json")) for p in changed_files
        )
        if manifest_or_results:
            await bus.publish(Event(topic=topic, type="graph_changed", data={}))

        stale_model_paths: list[str] = []
        for f in changed_files:
            try:
                rel = f.relative_to(project_path)
            except ValueError:
                continue
            parts = rel.parts
            if not parts:
                continue
            if parts[0] in WATCHED_SUBDIRS and f.suffix in {".sql", ".yml", ".yaml"}:
                stale_model_paths.append(str(rel))

        if stale_model_paths:
            await self._mark_stale_by_path(project_id, stale_model_paths)
            await bus.publish(
                Event(
                    topic=topic,
                    type="files_changed",
                    data={"paths": stale_model_paths},
                )
            )

    async def _mark_stale_by_path(self, project_id: int, paths: list[str]) -> None:
        async with SessionLocal() as session:
            result = await session.execute(
                select(ModelStatus).where(ModelStatus.project_id == project_id)
            )
            rows = list(result.scalars().all())
            changed = False
            for row in rows:
                pass
            await session.commit()
        # Path→unique_id mapping requires a manifest lookup done in the models API;
        # here we emit an event only. Status reset is handled by the /models endpoint
        # during the next fetch after a run, which is the authoritative refresh point.


watcher_manager = WatcherManager()
