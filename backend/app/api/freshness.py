import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import FreshnessSnapshot, Project
from app.dbt.freshness_parser import SourceFreshnessResult, load_freshness_results
from app.dbt.runner import RunRequest, runner
from app.events.bus import Event, bus

router = APIRouter(prefix="/api/projects", tags=["freshness"])

_running: dict[int, asyncio.Task] = {}


class SourceFreshnessResultDto(BaseModel):
    unique_id: str
    source_name: str
    table_name: str
    status: str  # pass | warn | error | runtime error
    max_loaded_at: str | None
    snapshotted_at: str | None
    age_seconds: float | None
    warn_after_count: int | None
    warn_after_period: str | None
    error_after_count: int | None
    error_after_period: str | None
    error: str | None


class FreshnessSnapshotDto(BaseModel):
    id: int
    project_id: int
    started_at: str
    finished_at: str | None
    status: str  # running | done | error
    target: str | None
    results: list[SourceFreshnessResultDto]
    error_message: str | None


def _to_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _result_to_dto(r: SourceFreshnessResult) -> SourceFreshnessResultDto:
    return SourceFreshnessResultDto(
        unique_id=r.unique_id,
        source_name=r.source_name,
        table_name=r.table_name,
        status=r.status,
        max_loaded_at=r.max_loaded_at,
        snapshotted_at=r.snapshotted_at,
        age_seconds=r.age_seconds,
        warn_after_count=r.warn_after_count,
        warn_after_period=r.warn_after_period,
        error_after_count=r.error_after_count,
        error_after_period=r.error_after_period,
        error=r.error,
    )


def _snapshot_to_dto(snap: FreshnessSnapshot) -> FreshnessSnapshotDto:
    try:
        raw: list[dict] = json.loads(snap.results_json)
    except Exception:
        raw = []

    results = [
        SourceFreshnessResultDto(
            unique_id=r.get("unique_id", ""),
            source_name=r.get("source_name", ""),
            table_name=r.get("table_name", ""),
            status=r.get("status", "error"),
            max_loaded_at=r.get("max_loaded_at"),
            snapshotted_at=r.get("snapshotted_at"),
            age_seconds=r.get("age_seconds"),
            warn_after_count=r.get("warn_after_count"),
            warn_after_period=r.get("warn_after_period"),
            error_after_count=r.get("error_after_count"),
            error_after_period=r.get("error_after_period"),
            error=r.get("error"),
        )
        for r in raw
    ]
    return FreshnessSnapshotDto(
        id=snap.id,
        project_id=snap.project_id,
        started_at=_to_utc_iso(snap.started_at) if snap.started_at else "",
        finished_at=_to_utc_iso(snap.finished_at) if snap.finished_at else None,
        status=snap.status,
        target=snap.target,
        results=results,
        error_message=snap.error_message,
    )


@router.post("/{project_id}/freshness", status_code=202, response_model=FreshnessSnapshotDto)
async def start_freshness(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> FreshnessSnapshotDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    existing_task = _running.get(project_id)
    if existing_task is not None and not existing_task.done():
        raise HTTPException(status_code=409, detail="freshness check already running for this project")

    from app.api.init import load_project_env
    env = await load_project_env(project_id)
    target_val = env.get("DBT_TARGET")

    snap = FreshnessSnapshot(
        project_id=project_id,
        status="running",
        target=target_val,
        results_json="[]",
    )
    session.add(snap)
    await session.commit()
    await session.refresh(snap)
    snap_id = snap.id

    task = asyncio.create_task(
        _run_freshness(project_id, snap_id, project.path, env, target_val)
    )
    _running[project_id] = task

    return _snapshot_to_dto(snap)


@router.get("/{project_id}/freshness", response_model=FreshnessSnapshotDto | None)
async def get_latest_freshness(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> FreshnessSnapshotDto | None:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    result = await session.execute(
        select(FreshnessSnapshot)
        .where(FreshnessSnapshot.project_id == project_id)
        .order_by(FreshnessSnapshot.id.desc())
        .limit(1)
    )
    snap = result.scalar_one_or_none()
    return _snapshot_to_dto(snap) if snap else None


async def _run_freshness(
    project_id: int,
    snap_id: int,
    project_path: str,
    env: dict[str, str],
    target_val: str | None,
) -> None:
    from app.db.engine import SessionLocal

    topic = f"project:{project_id}"
    target_args: tuple[str, ...] = ("--target", target_val) if target_val else ()

    await bus.publish(Event(
        topic=topic,
        type="freshness_started",
        data={"snapshot_id": snap_id},
    ))

    # `dbt source freshness` is a subcommand: "freshness" must come immediately
    # after "source", before any flags. build_args() normally inserts --profiles-dir
    # between the command and extra, which would break the subcommand routing.
    # inject_profiles_dir=False suppresses that; we add --profiles-dir ourselves
    # in extra so it appears after "freshness".
    pp = Path(project_path)
    profiles_dir_args: tuple[str, ...] = (
        ("--profiles-dir", str(pp))
        if (pp / "profiles.yml").exists()
        else ()
    )
    req = RunRequest(
        project_id=project_id,
        project_path=pp,
        command="source",
        extra=("freshness",) + profiles_dir_args + target_args,
        env=env,
        inject_profiles_dir=False,
    )

    error_message: str | None = None
    try:
        async for _kind, _line in runner.stream(req):
            pass  # bus already publishes run_log events; freshness output goes to project log
    except Exception as exc:
        error_message = str(exc)

    sources_path = Path(project_path) / "target" / "sources.json"
    results: list[SourceFreshnessResult] = []
    if not error_message:
        results = load_freshness_results(sources_path)

    results_raw = [
        {
            "unique_id": r.unique_id,
            "source_name": r.source_name,
            "table_name": r.table_name,
            "status": r.status,
            "max_loaded_at": r.max_loaded_at,
            "snapshotted_at": r.snapshotted_at,
            "age_seconds": r.age_seconds,
            "warn_after_count": r.warn_after_count,
            "warn_after_period": r.warn_after_period,
            "error_after_count": r.error_after_count,
            "error_after_period": r.error_after_period,
            "error": r.error,
        }
        for r in results
    ]

    final_status = "error" if error_message else "done"

    async with SessionLocal() as session:
        snap = await session.get(FreshnessSnapshot, snap_id)
        if snap is not None:
            snap.status = final_status
            snap.finished_at = datetime.now(timezone.utc)
            snap.results_json = json.dumps(results_raw)
            snap.error_message = error_message
            await session.commit()

    await bus.publish(Event(
        topic=topic,
        type="freshness_finished",
        data={
            "snapshot_id": snap_id,
            "ok": error_message is None,
            "pass_count": sum(1 for r in results if r.status == "pass"),
            "warn_count": sum(1 for r in results if r.status == "warn"),
            "error_count": sum(1 for r in results if r.status in ("error", "runtime error")),
        },
    ))
