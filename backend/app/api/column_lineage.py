import asyncio
import json
import os
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import ColumnLineageSnapshot, Project
from app.dbt.column_lineage import ColumnLineageUnavailable, LineageJob, prepare_lineage_jobs, trace_job
from app.events.bus import Event, bus
from app.licensing import entitlements
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["column-lineage"])

# In-memory map of project_id → running asyncio.Task (prevents concurrent runs)
_running: dict[int, asyncio.Task] = {}

# Column lineage tracing (sqlglot.lineage.lineage()) is CPU-bound. Fan work out
# across a small pool of worker processes so a large project doesn't take
# minutes on a single core and doesn't starve the event loop.
_POOL_SIZE = max(1, min(8, (os.cpu_count() or 2) - 1))
_pool = ProcessPoolExecutor(max_workers=_POOL_SIZE)


class ColumnLineageEntryDto(BaseModel):
    node: str
    column: str


class ColumnLineageSnapshotDto(BaseModel):
    id: int
    project_id: int
    started_at: str
    finished_at: str | None
    status: str  # running | done | error
    total_models: int
    checked_models: int
    results: dict[str, dict[str, list[ColumnLineageEntryDto]]]
    error_message: str | None


def _to_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


async def _require_pro(session: AsyncSession) -> None:
    """Column-level lineage is a dbt-ui Pro feature. Gates all three routes
    below (start + both read routes) — not just start — because an already-
    computed ColumnLineageSnapshot persists in the DB indefinitely, so a
    lapsed subscription could otherwise keep reading old results forever
    just by never re-triggering a scan."""
    entitlement = await entitlements.check_entitlement(session)
    if not entitlement.entitled:
        raise HTTPException(
            status_code=403,
            detail={"error": "pro_feature_required", "reason": entitlement.reason},
        )


def _snapshot_to_dto(snap: ColumnLineageSnapshot) -> ColumnLineageSnapshotDto:
    try:
        raw: dict = json.loads(snap.results_json)
    except Exception:
        raw = {}

    results = {
        uid: {
            col: [ColumnLineageEntryDto(**ref) for ref in refs]
            for col, refs in col_map.items()
        }
        for uid, col_map in raw.items()
    }
    return ColumnLineageSnapshotDto(
        id=snap.id,
        project_id=snap.project_id,
        started_at=_to_utc_iso(snap.started_at) if snap.started_at else "",
        finished_at=_to_utc_iso(snap.finished_at) if snap.finished_at else None,
        status=snap.status,
        total_models=snap.total_models,
        checked_models=snap.checked_models,
        results=results,
        error_message=snap.error_message,
    )


@router.post("/{project_id}/column-lineage/start", status_code=202, response_model=ColumnLineageSnapshotDto)
async def start_column_lineage(
    project_id: int,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> ColumnLineageSnapshotDto:
    await _require_pro(session)

    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    existing_task = _running.get(project_id)
    if existing_task is not None and not existing_task.done():
        raise HTTPException(status_code=409, detail="column lineage scan already running for this project")

    manifest_path = Path(project.path) / "target" / "manifest.json"
    try:
        manifest_mtime = manifest_path.stat().st_mtime
    except OSError:
        raise HTTPException(status_code=422, detail="manifest not found — run dbt compile first")

    # Short-circuit: if the latest snapshot is done and the manifest hasn't
    # changed since, there's nothing new to compute.
    result = await session.execute(
        select(ColumnLineageSnapshot)
        .where(ColumnLineageSnapshot.project_id == project_id)
        .order_by(ColumnLineageSnapshot.id.desc())
        .limit(1)
    )
    latest = result.scalar_one_or_none()
    if latest is not None and latest.status == "done" and latest.manifest_mtime == manifest_mtime:
        response.status_code = 200
        return _snapshot_to_dto(latest)

    loop = asyncio.get_event_loop()
    try:
        jobs: list[LineageJob] = await loop.run_in_executor(None, prepare_lineage_jobs, manifest_path)
    except ColumnLineageUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    snap = ColumnLineageSnapshot(
        project_id=project_id,
        status="running",
        total_models=len(jobs),
        checked_models=0,
        results_json="{}",
        manifest_mtime=manifest_mtime,
    )
    session.add(snap)
    await session.commit()
    await session.refresh(snap)
    snap_id = snap.id

    task = asyncio.create_task(_run_column_lineage(project_id, snap_id, jobs, manifest_mtime))
    _running[project_id] = task

    await bus.publish(Event(
        topic=f"project:{project_id}",
        type="column_lineage_started",
        data={"snapshot_id": snap_id, "total": len(jobs)},
    ))

    return _snapshot_to_dto(snap)


@router.get("/{project_id}/column-lineage", response_model=ColumnLineageSnapshotDto | None)
async def get_latest_column_lineage(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> ColumnLineageSnapshotDto | None:
    await _require_pro(session)

    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    result = await session.execute(
        select(ColumnLineageSnapshot)
        .where(ColumnLineageSnapshot.project_id == project_id)
        .order_by(ColumnLineageSnapshot.id.desc())
        .limit(1)
    )
    snap = result.scalar_one_or_none()
    return _snapshot_to_dto(snap) if snap else None


@router.get("/{project_id}/column-lineage/{snapshot_id}", response_model=ColumnLineageSnapshotDto)
async def get_column_lineage_snapshot(
    project_id: int,
    snapshot_id: int,
    session: AsyncSession = Depends(get_session),
) -> ColumnLineageSnapshotDto:
    await _require_pro(session)

    snap = await session.get(ColumnLineageSnapshot, snapshot_id)
    if snap is None or snap.project_id != project_id:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return _snapshot_to_dto(snap)


async def _run_column_lineage(
    project_id: int,
    snap_id: int,
    jobs: list[LineageJob],
    manifest_mtime: float,
) -> None:
    from app.db.engine import SessionLocal

    topic = f"project:{project_id}"
    total = len(jobs)
    loop = asyncio.get_event_loop()

    results: dict[str, dict] = {}
    checked = 0
    error_message: str | None = None

    try:
        future_to_job = {
            loop.run_in_executor(_pool, trace_job, job): job
            for job in jobs
        }

        # asyncio.as_completed()'s plain-iteration form yields a *new* coroutine
        # each time (not the original future), which breaks a future→job
        # lookup dict; its async-iteration form (which preserves identity) is
        # only available on 3.13+. asyncio.wait(..., FIRST_COMPLETED) is the
        # version-portable way to fan out work while still being able to map
        # each completed future back to the job it ran.
        pending = set(future_to_job.keys())
        while pending:
            done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
            for fut in done:
                job = future_to_job[fut]
                try:
                    uid, col_lineage = fut.result()
                    if col_lineage:
                        results[uid] = {
                            col: [{"node": ref.node, "column": ref.column} for ref in refs]
                            for col, refs in col_lineage.items()
                        }
                except Exception as exc:
                    log.warning("column_lineage_job_failed", uid=job.uid, error=str(exc))

                checked += 1

                async with SessionLocal() as session:
                    snap = await session.get(ColumnLineageSnapshot, snap_id)
                    if snap is not None:
                        snap.checked_models = checked
                        snap.results_json = json.dumps(results)
                        await session.commit()

                await bus.publish(Event(
                    topic=topic,
                    type="column_lineage_progress",
                    data={
                        "snapshot_id": snap_id,
                        "checked": checked,
                        "total": total,
                        "current": job.name,
                    },
                ))
    except Exception as exc:
        error_message = str(exc)

    final_status = "error" if error_message else "done"

    async with SessionLocal() as session:
        snap = await session.get(ColumnLineageSnapshot, snap_id)
        if snap is not None:
            snap.status = final_status
            snap.finished_at = datetime.now(timezone.utc)
            snap.checked_models = checked
            snap.results_json = json.dumps(results)
            snap.error_message = error_message
            snap.manifest_mtime = manifest_mtime
            await session.commit()

    await bus.publish(Event(
        topic=topic,
        type="column_lineage_finished",
        data={"snapshot_id": snap_id, "ok": error_message is None},
    ))
