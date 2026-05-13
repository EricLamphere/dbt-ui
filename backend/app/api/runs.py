import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select as sa_select

from app.db.engine import SessionLocal, get_session
from app.db.models import InvocationModelResult, ModelStatus, Project, ProjectEnvVar, RunInvocation
from app.dbt.manifest import load_manifest
from app.dbt.run_results import load_run_results
from app.api.init import load_project_env
from app.dbt.runner import RunRequest, runner
from app.dbt.select import SelectMode, build_selector
from app.events.bus import Event, bus
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["runs"])

_MAX_HISTORY_PER_NODE = 20  # rows kept in invocation_model_results per (project, unique_id)


class RunRequestDto(BaseModel):
    model: str | None = None
    mode: SelectMode = "only"
    select: str | None = None  # explicit pass-through if provided
    full_refresh: bool = False
    threads: int | None = None
    debug: bool = False
    empty: bool = False
    vars: dict[str, str] | None = None


class RunResponseDto(BaseModel):
    accepted: bool
    command: str
    select: str | None


class RunInvocationDto(BaseModel):
    id: int
    command: str
    selector: str | None
    status: str
    started_at: datetime | None
    finished_at: datetime | None
    duration_seconds: float | None
    model_count: int
    success_count: int
    error_count: int


class ModelTimingDto(BaseModel):
    unique_id: str
    name: str
    kind: str
    status: str
    execution_time: float | None
    message: str | None


class NodeTrendPoint(BaseModel):
    invocation_id: int
    started_at: datetime | None
    execution_time: float | None
    status: str


class RunInvocationDetailDto(RunInvocationDto):
    nodes: list[ModelTimingDto]


class RunHistoryPageDto(BaseModel):
    items: list[RunInvocationDto]
    total: int
    offset: int
    limit: int


def _resolve_selector(dto: RunRequestDto) -> str | None:
    if dto.select:
        return dto.select
    if dto.model:
        return build_selector(dto.model, dto.mode)
    return None


def _invocation_log_path(project_path: Path, invocation_id: int) -> Path:
    log_dir = project_path / "logs" / "dbt-ui" / "invocations"
    log_dir.mkdir(parents=True, exist_ok=True)
    gitignore = project_path / "logs" / ".gitignore"
    if not gitignore.exists():
        gitignore.write_text("*\n", encoding="utf-8")
    return log_dir / f"{invocation_id}.log"


async def _trim_node_history(session: AsyncSession, project_id: int, unique_id: str) -> None:
    """Keep only the most recent _MAX_HISTORY_PER_NODE rows for this node."""
    result = await session.execute(
        select(InvocationModelResult.id)
        .where(
            InvocationModelResult.project_id == project_id,
            InvocationModelResult.unique_id == unique_id,
        )
        .order_by(InvocationModelResult.id.desc())
        .offset(_MAX_HISTORY_PER_NODE)
    )
    old_ids = [row[0] for row in result.fetchall()]
    if old_ids:
        await session.execute(
            delete(InvocationModelResult).where(InvocationModelResult.id.in_(old_ids))
        )


async def _persist_results_after_run(project: Project, invocation_id: int | None = None) -> None:
    results = load_run_results(Path(project.path) / "target" / "run_results.json")
    if not results:
        return
    manifest = load_manifest(Path(project.path) / "target" / "manifest.json")
    parent_model_by_test: dict[str, str | None] = {}
    if manifest is not None:
        parent_map = {child: tuple(parents) for child, parents in manifest.parents.items()}
        for node in manifest.nodes:
            if node.resource_type == "test":
                parents = parent_map.get(node.unique_id, ())
                model_parent = next(
                    (p for p in parents if p.startswith(("model.", "snapshot.", "seed."))),
                    None,
                )
                parent_model_by_test[node.unique_id] = model_parent

    async with SessionLocal() as session:
        # Update model_statuses (current snapshot — unchanged behaviour)
        existing = await session.execute(
            select(ModelStatus).where(ModelStatus.project_id == project.id)
        )
        by_uid = {row.unique_id: row for row in existing.scalars().all()}
        now = datetime.now(timezone.utc)
        for r in results:
            row = by_uid.get(r.unique_id)
            kind = "test" if r.unique_id.startswith("test.") else "model"
            if row is None:
                row = ModelStatus(
                    project_id=project.id,
                    unique_id=r.unique_id,
                    kind=kind,
                    parent_model_id=parent_model_by_test.get(r.unique_id),
                )
                session.add(row)
            row.status = r.status
            row.message = r.message
            row.execution_time = r.execution_time
            row.invocation_id = invocation_id
            row.finished_at = now
        await session.commit()

        # Write to history table and trim to _MAX_HISTORY_PER_NODE per node
        if invocation_id is not None:
            for r in results:
                kind = "test" if r.unique_id.startswith("test.") else "model"
                parts = r.unique_id.split(".")
                # test unique IDs: test.<project>.<test_name>.<hash> — use index 2
                # model unique IDs: model.<project>.<name> — use last segment
                name = parts[2] if kind == "test" and len(parts) >= 4 else parts[-1]
                session.add(InvocationModelResult(
                    invocation_id=invocation_id,
                    project_id=project.id,
                    unique_id=r.unique_id,
                    name=name,
                    kind=kind,
                    status=r.status,
                    execution_time=r.execution_time,
                    message=r.message,
                ))
            await session.commit()
            unique_ids = {r.unique_id for r in results}
            for uid in unique_ids:
                await _trim_node_history(session, project.id, uid)
            await session.commit()

    await bus.publish(
        Event(topic=f"project:{project.id}", type="statuses_changed", data={})
    )

    for r in results:
        if r.unique_id.startswith("test.") and r.status in ("fail", "error"):
            model_uid = parent_model_by_test.get(r.unique_id)
            await bus.publish(
                Event(
                    topic=f"project:{project.id}",
                    type="test_failed",
                    data={
                        "test_uid": r.unique_id,
                        "model_uid": model_uid,
                        "message": r.message,
                    },
                )
            )


async def _load_active_target(project_id: int) -> str | None:
    async with SessionLocal() as session:
        result = await session.execute(
            sa_select(ProjectEnvVar).where(
                ProjectEnvVar.project_id == project_id,
                ProjectEnvVar.key == "dbt_target",
            )
        )
        row = result.scalar_one_or_none()
        return row.value if row else None


async def _run_dbt_and_persist(
    project: Project,
    command: str,
    select: str | None,
    full_refresh: bool = False,
    threads: int | None = None,
    debug: bool = False,
    empty: bool = False,
    vars: dict[str, str] | None = None,
) -> None:
    import json
    env = await load_project_env(project.id)
    target = await _load_active_target(project.id)
    extra: tuple[str, ...] = ("--target", target) if target else ()
    if full_refresh:
        extra += ("--full-refresh",)
    if threads is not None:
        extra += ("--threads", str(threads))
    if debug:
        extra += ("--debug",)
    if empty:
        extra += ("--empty",)
    if vars:
        extra += ("--vars", json.dumps(vars))

    invocation_id: int | None = None
    async with SessionLocal() as session:
        inv = RunInvocation(
            project_id=project.id,
            command=command,
            selector=select,
            status="running",
            started_at=datetime.now(timezone.utc),
        )
        session.add(inv)
        await session.commit()
        await session.refresh(inv)
        invocation_id = inv.id

    log_path = _invocation_log_path(Path(project.path), invocation_id)
    async with SessionLocal() as session:
        inv_row = await session.get(RunInvocation, invocation_id)
        if inv_row is not None:
            inv_row.log_path = str(log_path)
            await session.commit()

    req = RunRequest(
        project_id=project.id,
        project_path=Path(project.path),
        command=command,
        select=select,
        extra=extra,
        env=env,
    )
    run_error = False
    try:
        with log_path.open("a", encoding="utf-8") as lf:
            async for _kind, line in runner.stream(req):
                lf.write(line + "\n")
    except Exception:
        run_error = True
    finally:
        cancelled = runner.pop_cancel_flag(project.id)
        try:
            await _persist_results_after_run(project, invocation_id)
        except Exception:
            log.exception("persist_results_failed", project_id=project.id, invocation_id=invocation_id)
        try:
            async with SessionLocal() as session:
                inv_row = await session.get(RunInvocation, invocation_id)
                if inv_row is not None:
                    if cancelled:
                        inv_row.status = "cancelled"
                    else:
                        results = load_run_results(Path(project.path) / "target" / "run_results.json")
                        if results is None:
                            inv_row.status = "error"
                        else:
                            has_error = run_error or any(r.status == "error" for r in results)
                            inv_row.status = "error" if has_error else "success"
                    inv_row.finished_at = datetime.now(timezone.utc)
                    await session.commit()
        except Exception:
            log.exception("invocation_status_update_failed", project_id=project.id, invocation_id=invocation_id)
        await bus.publish(Event(
            topic=f"project:{project.id}",
            type="run_history_changed",
            data={"invocation_id": invocation_id},
        ))


async def _launch(
    project: Project, command: str, dto: RunRequestDto
) -> RunResponseDto:
    select = _resolve_selector(dto)
    asyncio.create_task(
        _run_dbt_and_persist(
            project, command, select,
            dto.full_refresh, dto.threads, dto.debug, dto.empty, dto.vars,
        )
    )
    return RunResponseDto(accepted=True, command=command, select=select)


@router.post("/{project_id}/run", response_model=RunResponseDto)
async def post_run(
    project_id: int,
    dto: RunRequestDto,
    session: AsyncSession = Depends(get_session),
) -> RunResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await _launch(project, "run", dto)


@router.post("/{project_id}/build", response_model=RunResponseDto)
async def post_build(
    project_id: int,
    dto: RunRequestDto,
    session: AsyncSession = Depends(get_session),
) -> RunResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await _launch(project, "build", dto)


@router.post("/{project_id}/seed", response_model=RunResponseDto)
async def post_seed(
    project_id: int,
    dto: RunRequestDto,
    session: AsyncSession = Depends(get_session),
) -> RunResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await _launch(project, "seed", dto)


@router.post("/{project_id}/test", response_model=RunResponseDto)
async def post_test(
    project_id: int,
    dto: RunRequestDto,
    session: AsyncSession = Depends(get_session),
) -> RunResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return await _launch(project, "test", dto)


def _invocation_to_dto(
    inv: RunInvocation,
    model_count: int,
    success_count: int = 0,
    error_count: int = 0,
) -> RunInvocationDto:
    duration: float | None = None
    if inv.started_at and inv.finished_at:
        duration = (inv.finished_at - inv.started_at).total_seconds()
    return RunInvocationDto(
        id=inv.id,
        command=inv.command,
        selector=inv.selector,
        status=inv.status,
        started_at=inv.started_at,
        finished_at=inv.finished_at,
        duration_seconds=duration,
        model_count=model_count,
        success_count=success_count,
        error_count=error_count,
    )


@router.get("/{project_id}/run-history", response_model=RunHistoryPageDto)
async def get_run_history(
    project_id: int,
    limit: int = Query(default=50, le=1000),
    offset: int = Query(default=0, ge=0),
    command: str | None = Query(default=None),
    status: str | None = Query(default=None),
    q: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
) -> RunHistoryPageDto:
    from sqlalchemy import func as sa_func
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    base_q = select(RunInvocation).where(RunInvocation.project_id == project_id)
    if command:
        base_q = base_q.where(RunInvocation.command == command)
    if status:
        base_q = base_q.where(RunInvocation.status == status)
    if q:
        base_q = base_q.where(RunInvocation.selector.contains(q))

    count_result = await session.execute(
        select(sa_func.count()).select_from(base_q.subquery())
    )
    total = count_result.scalar_one()

    invocations_result = await session.execute(
        base_q.order_by(RunInvocation.started_at.desc()).offset(offset).limit(limit)
    )
    invocations = invocations_result.scalars().all()
    if not invocations:
        return RunHistoryPageDto(items=[], total=total, offset=offset, limit=limit)

    inv_ids = [inv.id for inv in invocations]
    from sqlalchemy import case
    counts_result = await session.execute(
        select(
            InvocationModelResult.invocation_id,
            sa_func.count(InvocationModelResult.id),
            sa_func.sum(case((InvocationModelResult.status == "success", 1), else_=0)),
            sa_func.sum(case((InvocationModelResult.status == "error", 1), else_=0)),
        )
        .where(InvocationModelResult.invocation_id.in_(inv_ids))
        .group_by(InvocationModelResult.invocation_id)
    )
    count_by_id: dict[int, tuple[int, int, int]] = {
        row[0]: (row[1], int(row[2] or 0), int(row[3] or 0))
        for row in counts_result.fetchall()
    }

    items = [
        _invocation_to_dto(inv, *count_by_id.get(inv.id, (0, 0, 0)))
        for inv in invocations
    ]
    return RunHistoryPageDto(items=items, total=total, offset=offset, limit=limit)


@router.get("/{project_id}/run-history/{invocation_id}", response_model=RunInvocationDetailDto)
async def get_run_invocation_detail(
    project_id: int,
    invocation_id: int,
    session: AsyncSession = Depends(get_session),
) -> RunInvocationDetailDto:
    inv = await session.get(RunInvocation, invocation_id)
    if inv is None or inv.project_id != project_id:
        raise HTTPException(status_code=404, detail="invocation not found")

    results_q = await session.execute(
        select(InvocationModelResult)
        .where(InvocationModelResult.invocation_id == invocation_id)
        .order_by(
            InvocationModelResult.execution_time.desc().nulls_last(),
            InvocationModelResult.unique_id,
        )
    )
    results = results_q.scalars().all()

    nodes = [
        ModelTimingDto(
            unique_id=r.unique_id,
            name=r.name,
            kind=r.kind,
            status=r.status,
            execution_time=r.execution_time,
            message=r.message,
        )
        for r in results
    ]

    success_count = sum(1 for r in results if r.status == "success")
    error_count = sum(1 for r in results if r.status == "error")
    base = _invocation_to_dto(inv, len(nodes), success_count, error_count)
    return RunInvocationDetailDto(**base.model_dump(), nodes=nodes)


@router.get("/{project_id}/run-history/{invocation_id}/log", response_model=None)
async def get_invocation_log(
    project_id: int,
    invocation_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict:
    inv = await session.get(RunInvocation, invocation_id)
    if inv is None or inv.project_id != project_id:
        raise HTTPException(status_code=404, detail="invocation not found")
    if not inv.log_path:
        return {"lines": []}
    log_file = Path(inv.log_path)
    if not log_file.exists():
        return {"lines": []}
    try:
        text = log_file.read_text(encoding="utf-8", errors="replace")
        return {"lines": text.splitlines()}
    except OSError:
        return {"lines": []}


@router.post("/{project_id}/runs/cancel")
async def post_cancel_run(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    killed = runner.cancel(project_id)
    return {"cancelled": killed}


@router.post("/{project_id}/run-history/{invocation_id}/rerun", response_model=RunResponseDto)
async def post_rerun_invocation(
    project_id: int,
    invocation_id: int,
    session: AsyncSession = Depends(get_session),
) -> RunResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    inv = await session.get(RunInvocation, invocation_id)
    if inv is None or inv.project_id != project_id:
        raise HTTPException(status_code=404, detail="invocation not found")
    dto = RunRequestDto(select=inv.selector)
    return await _launch(project, inv.command, dto)


@router.get("/{project_id}/node-trend/{unique_id:path}", response_model=list[NodeTrendPoint])
async def get_node_trend(
    project_id: int,
    unique_id: str,
    session: AsyncSession = Depends(get_session),
) -> list[NodeTrendPoint]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    results_q = await session.execute(
        select(InvocationModelResult, RunInvocation.started_at)
        .join(RunInvocation, InvocationModelResult.invocation_id == RunInvocation.id)
        .where(
            InvocationModelResult.project_id == project_id,
            InvocationModelResult.unique_id == unique_id,
        )
        .order_by(RunInvocation.started_at.asc())
    )
    rows = results_q.fetchall()
    return [
        NodeTrendPoint(
            invocation_id=r.InvocationModelResult.invocation_id,
            started_at=r.started_at,
            execution_time=r.InvocationModelResult.execution_time,
            status=r.InvocationModelResult.status,
        )
        for r in rows
    ]
