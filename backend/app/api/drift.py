import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import DriftSnapshot, Project
from app.dbt.drift import ModelDriftResult, diff_columns, is_eligible_for_drift_check
from app.dbt.manifest import load_manifest
from app.dbt.runner import RunRequest, runner
from app.dbt.show_parser import parse_show_json
from app.events.bus import Event, bus

router = APIRouter(prefix="/api/projects", tags=["drift"])

# In-memory map of project_id → running asyncio.Task (prevents concurrent runs)
_running: dict[int, asyncio.Task] = {}


class ColumnDriftDto(BaseModel):
    name: str
    in_manifest: bool
    in_warehouse: bool
    manifest_type: str
    warehouse_type: str
    type_mismatch: bool


class ModelDriftResultDto(BaseModel):
    unique_id: str
    name: str
    materialized: str | None
    error: str | None
    columns: list[ColumnDriftDto]
    has_drift: bool


class DriftSnapshotDto(BaseModel):
    id: int
    project_id: int
    started_at: str
    finished_at: str | None
    status: str  # running | done | error
    target: str | None
    total_models: int
    checked_models: int
    results: list[ModelDriftResultDto]
    error_message: str | None


class StartDriftDto(BaseModel):
    select: list[str] | None = None  # optional: limit to subset of unique_ids


def _to_utc_iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _snapshot_to_dto(snap: DriftSnapshot) -> DriftSnapshotDto:
    try:
        raw_results: list[dict] = json.loads(snap.results_json)
    except Exception:
        raw_results = []

    results = [
        ModelDriftResultDto(
            unique_id=r.get("unique_id", ""),
            name=r.get("name", ""),
            materialized=r.get("materialized"),
            error=r.get("error"),
            columns=[ColumnDriftDto(**c) for c in r.get("columns", [])],
            has_drift=r.get("has_drift", False),
        )
        for r in raw_results
    ]
    return DriftSnapshotDto(
        id=snap.id,
        project_id=snap.project_id,
        started_at=_to_utc_iso(snap.started_at) if snap.started_at else "",
        finished_at=_to_utc_iso(snap.finished_at) if snap.finished_at else None,
        status=snap.status,
        target=snap.target,
        total_models=snap.total_models,
        checked_models=snap.checked_models,
        results=results,
        error_message=snap.error_message,
    )


@router.post("/{project_id}/drift", status_code=202, response_model=DriftSnapshotDto)
async def start_drift(
    project_id: int,
    dto: StartDriftDto,
    session: AsyncSession = Depends(get_session),
) -> DriftSnapshotDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    existing_task = _running.get(project_id)
    if existing_task is not None and not existing_task.done():
        raise HTTPException(status_code=409, detail="drift check already running for this project")

    manifest_path = Path(project.path) / "target" / "manifest.json"
    loop = asyncio.get_event_loop()
    manifest = await loop.run_in_executor(None, load_manifest, manifest_path)
    if manifest is None:
        raise HTTPException(status_code=422, detail="manifest not found — run dbt compile first")

    eligible = [n for n in manifest.nodes if is_eligible_for_drift_check(n)]
    if dto.select:
        uid_set = set(dto.select)
        eligible = [n for n in eligible if n.unique_id in uid_set]

    from app.api.init import load_project_env
    env = await load_project_env(project_id)
    target_val = env.get("DBT_TARGET")

    snap = DriftSnapshot(
        project_id=project_id,
        status="running",
        target=target_val,
        total_models=len(eligible),
        checked_models=0,
        results_json="[]",
    )
    session.add(snap)
    await session.commit()
    await session.refresh(snap)
    snap_id = snap.id

    task = asyncio.create_task(
        _run_drift_check(project_id, snap_id, project.path, eligible, env, target_val)
    )
    _running[project_id] = task

    return _snapshot_to_dto(snap)


@router.get("/{project_id}/drift", response_model=DriftSnapshotDto | None)
async def get_latest_drift(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> DriftSnapshotDto | None:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    result = await session.execute(
        select(DriftSnapshot)
        .where(DriftSnapshot.project_id == project_id)
        .order_by(DriftSnapshot.id.desc())
        .limit(1)
    )
    snap = result.scalar_one_or_none()
    return _snapshot_to_dto(snap) if snap else None


@router.get("/{project_id}/drift/{snapshot_id}", response_model=DriftSnapshotDto)
async def get_drift_snapshot(
    project_id: int,
    snapshot_id: int,
    session: AsyncSession = Depends(get_session),
) -> DriftSnapshotDto:
    snap = await session.get(DriftSnapshot, snapshot_id)
    if snap is None or snap.project_id != project_id:
        raise HTTPException(status_code=404, detail="snapshot not found")
    return _snapshot_to_dto(snap)


async def _run_drift_check(
    project_id: int,
    snap_id: int,
    project_path: str,
    eligible,
    env: dict[str, str],
    target_val: str | None,
) -> None:
    from app.db.engine import SessionLocal

    topic = f"project:{project_id}"
    total = len(eligible)
    target_args: tuple[str, ...] = ("--target", target_val) if target_val else ()

    await bus.publish(Event(
        topic=topic,
        type="drift_started",
        data={"snapshot_id": snap_id, "total": total},
    ))

    results: list[dict] = []
    checked = 0

    for node in eligible:
        model_result: ModelDriftResult | None = None
        error_msg: str | None = None
        probe_columns: tuple[str, ...] = ()

        inline_sql = f"select * from {{{{ ref('{node.name}') }}}}"
        req = RunRequest(
            project_id=project_id,
            project_path=Path(project_path),
            command="show",
            extra=("--inline", inline_sql, "--limit", "1", "--output", "json") + target_args,
            env=env,
        )

        try:
            async with asyncio.timeout(30):
                _, stdout_bytes, stderr_bytes = await runner.run(req)
            stdout_str = stdout_bytes.decode(errors="replace")
            stderr_str = stderr_bytes.decode(errors="replace")
            cols, _ = parse_show_json(stdout_str)
            if not cols:
                # Some dbt versions write JSON output to stderr
                cols, _ = parse_show_json(stderr_str)
            if not cols:
                error_msg = "no columns returned — table may be empty or schema not materialized"
            else:
                probe_columns = tuple(cols)
        except TimeoutError:
            error_msg = "probe timed out after 30s"
        except Exception as exc:
            error_msg = str(exc)

        if error_msg is None:
            drifted_cols = diff_columns(node.columns, probe_columns)
            has_drift = any(
                not c.in_manifest or not c.in_warehouse or c.type_mismatch
                for c in drifted_cols
            )
            model_result = ModelDriftResult(
                unique_id=node.unique_id,
                name=node.name,
                materialized=node.materialized,
                error=None,
                columns=drifted_cols,
                has_drift=has_drift,
            )
        else:
            model_result = ModelDriftResult(
                unique_id=node.unique_id,
                name=node.name,
                materialized=node.materialized,
                error=error_msg,
                columns=(),
                has_drift=False,
            )

        results.append({
            "unique_id": model_result.unique_id,
            "name": model_result.name,
            "materialized": model_result.materialized,
            "error": model_result.error,
            "columns": [
                {
                    "name": c.name,
                    "in_manifest": c.in_manifest,
                    "in_warehouse": c.in_warehouse,
                    "manifest_type": c.manifest_type,
                    "warehouse_type": c.warehouse_type,
                    "type_mismatch": c.type_mismatch,
                }
                for c in model_result.columns
            ],
            "has_drift": model_result.has_drift,
        })
        checked += 1

        async with SessionLocal() as session:
            snap = await session.get(DriftSnapshot, snap_id)
            if snap is not None:
                snap.checked_models = checked
                snap.results_json = json.dumps(results)
                await session.commit()

        await bus.publish(Event(
            topic=topic,
            type="drift_progress",
            data={
                "snapshot_id": snap_id,
                "checked": checked,
                "total": total,
                "current": node.name,
            },
        ))

    drifted_count = sum(1 for r in results if r.get("has_drift"))

    async with SessionLocal() as session:
        snap = await session.get(DriftSnapshot, snap_id)
        if snap is not None:
            snap.status = "done"
            snap.finished_at = datetime.now(timezone.utc)
            snap.checked_models = checked
            snap.results_json = json.dumps(results)
            await session.commit()

    await bus.publish(Event(
        topic=topic,
        type="drift_finished",
        data={"snapshot_id": snap_id, "ok": True, "drifted_count": drifted_count},
    ))
