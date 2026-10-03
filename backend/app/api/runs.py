import asyncio
import json
import shlex
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select as sa_select

from app.db.engine import SessionLocal, get_session
from app.db.models import GlobalProfile, InvocationModelResult, ModelStatus, Project, ProjectEnvVar, RunInvocation
from app.dbt.manifest import load_manifest
from app.dbt.run_results import load_run_results
from app.api.init import load_project_env
from app.api.env import _read_profiles_yml
from app.dbt.custom_command import CustomCommandError, ParsedCommand, parse_custom_command
from app.dbt.runner import RunRequest, runner
from app.dbt.select import SelectMode, build_selector
from app.events.bus import Event, bus
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["runs"])

_MAX_HISTORY_PER_NODE = 20  # rows kept in invocation_model_results per (project, unique_id)
_MAX_CUSTOM_COMMAND_LENGTH = 4096


class RunRequestDto(BaseModel):
    model: str | None = None
    mode: SelectMode = "only"
    select: str | None = None  # explicit pass-through if provided
    full_refresh: bool = False
    threads: int | None = None
    debug: bool = False
    empty: bool = False
    vars: dict[str, str] | None = None


class CustomCommandDto(BaseModel):
    command: str = Field(max_length=_MAX_CUSTOM_COMMAND_LENGTH)


class RunResponseDto(BaseModel):
    accepted: bool
    command: str
    select: str | None


class RunInvocationDto(BaseModel):
    id: int
    command: str
    selector: str | None
    cli_command: str | None
    profile: str | None
    target: str | None
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


async def _load_active_profile_name(project_id: int) -> str | None:
    async with SessionLocal() as session:
        id_row = await session.execute(
            sa_select(ProjectEnvVar).where(
                ProjectEnvVar.project_id == project_id,
                ProjectEnvVar.key == "active_global_profile_id",
            )
        )
        id_var = id_row.scalar_one_or_none()
        if id_var is None:
            return None
        try:
            gp = await session.get(GlobalProfile, int(id_var.value))
            return gp.name if gp else None
        except (ValueError, TypeError):
            return None


@dataclass(frozen=True)
class _InvocationSpec:
    """Everything needed to execute one dbt invocation and record it in run history."""
    command: str
    select: str | None
    extra: tuple[str, ...]
    cli_command: str
    target: str | None
    profile_name: str | None
    inject_profiles_dir: bool = True
    custom_args: tuple[str, ...] | None = None


def _profiles_default_target(project: Project) -> str | None:
    profiles = _read_profiles_yml(Path(project.path))
    profile_data = profiles.get(project.profile or project.name, {})
    return profile_data.get("target") or None


def _run_results_mtime(project_path: Path) -> float | None:
    try:
        return (project_path / "target" / "run_results.json").stat().st_mtime
    except OSError:
        return None


async def _create_invocation(project: Project, spec: _InvocationSpec) -> tuple[int, Path]:
    async with SessionLocal() as session:
        inv = RunInvocation(
            project_id=project.id,
            command=spec.command,
            selector=spec.select,
            cli_command=spec.cli_command,
            profile=spec.profile_name,
            target=spec.target,
            status="running",
            started_at=datetime.now(timezone.utc),
            custom_args=json.dumps(list(spec.custom_args)) if spec.custom_args is not None else None,
        )
        session.add(inv)
        await session.commit()
        await session.refresh(inv)
        log_path = _invocation_log_path(Path(project.path), inv.id)
        inv.log_path = str(log_path)
        await session.commit()
        return inv.id, log_path


def _invocation_status(
    cancelled: bool, run_error: bool, results_fresh: bool, return_code: int | None, project_path: Path
) -> str:
    if cancelled:
        return "cancelled"
    if run_error:
        return "error"
    if results_fresh:
        results = load_run_results(project_path / "target" / "run_results.json")
        return "error" if any(r.status == "error" for r in results) else "success"
    # Commands like ls/parse/debug don't write run_results.json — trust the exit code.
    return "success" if return_code == 0 else "error"


async def _finalize_invocation(project: Project, invocation_id: int, status: str) -> None:
    try:
        async with SessionLocal() as session:
            inv_row = await session.get(RunInvocation, invocation_id)
            if inv_row is not None:
                inv_row.status = status
                inv_row.finished_at = datetime.now(timezone.utc)
                await session.commit()
    except Exception:
        log.exception("invocation_status_update_failed", project_id=project.id, invocation_id=invocation_id)
    await bus.publish(Event(
        topic=f"project:{project.id}",
        type="run_history_changed",
        data={"invocation_id": invocation_id},
    ))


async def _run_invocation(project: Project, spec: _InvocationSpec, env: dict[str, str]) -> None:
    """Record a RunInvocation, stream dbt through the runner, then persist results and status."""
    project_path = Path(project.path)
    invocation_id, log_path = await _create_invocation(project, spec)
    req = RunRequest(
        project_id=project.id,
        project_path=project_path,
        command=spec.command,
        select=spec.select if spec.custom_args is None else None,
        extra=spec.extra,
        env=env,
        inject_profiles_dir=spec.inject_profiles_dir,
    )
    results_mtime_before = _run_results_mtime(project_path)
    run_error = False
    try:
        with log_path.open("a", encoding="utf-8") as lf:
            async for _kind, line in runner.stream(req):
                lf.write(line + "\n")
    except Exception:
        log.exception("dbt_invocation_failed", project_id=project.id, invocation_id=invocation_id)
        run_error = True
    finally:
        return_code = runner.pop_return_code(project.id)
        cancelled = runner.pop_cancel_flag(project.id)
        results_mtime_after = _run_results_mtime(project_path)
        # Only persist run_results.json if this invocation rewrote it; otherwise
        # we would re-record a previous run's results as this one's.
        results_fresh = results_mtime_after is not None and results_mtime_after != results_mtime_before
        if results_fresh:
            try:
                await _persist_results_after_run(project, invocation_id)
            except Exception:
                log.exception("persist_results_failed", project_id=project.id, invocation_id=invocation_id)
        status = _invocation_status(cancelled, run_error, results_fresh, return_code, project_path)
        await _finalize_invocation(project, invocation_id, status)


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
    env = await load_project_env(project.id)
    active_target = await _load_active_target(project.id)
    profile_name = await _load_active_profile_name(project.id)
    extra: tuple[str, ...] = ("--target", active_target) if active_target else ()
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

    selector_part = f" --select {select}" if select else ""
    extra_part = (" " + " ".join(extra)) if extra else ""
    spec = _InvocationSpec(
        command=command,
        select=select,
        extra=extra,
        cli_command=f"dbt {command}{selector_part}{extra_part}",
        target=active_target or _profiles_default_target(project),
        profile_name=profile_name,
    )
    await _run_invocation(project, spec, env)


async def _run_custom_and_persist(project: Project, parsed: ParsedCommand) -> None:
    """Run a user-entered dbt command, injecting the active target unless the user passed one."""
    env = await load_project_env(project.id)
    profile_name = await _load_active_profile_name(project.id)
    extra = parsed.rest
    if parsed.has_target:
        target = parsed.target
    else:
        active_target = await _load_active_target(project.id)
        if active_target:
            extra += ("--target", active_target)
        target = active_target or _profiles_default_target(project)
    spec = _InvocationSpec(
        command=parsed.subcommand,
        select=parsed.selector,
        extra=extra,
        cli_command="dbt " + shlex.join((parsed.subcommand, *extra)),
        target=target,
        profile_name=profile_name,
        inject_profiles_dir=not parsed.has_profiles_dir,
        custom_args=parsed.args,
    )
    await _run_invocation(project, spec, env)


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


def _launch_custom(project: Project, parsed: ParsedCommand) -> RunResponseDto:
    asyncio.create_task(_run_custom_and_persist(project, parsed))
    return RunResponseDto(accepted=True, command=parsed.subcommand, select=parsed.selector)


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


@router.post("/{project_id}/command", response_model=RunResponseDto)
async def post_custom_command(
    project_id: int,
    dto: CustomCommandDto,
    session: AsyncSession = Depends(get_session),
) -> RunResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    try:
        parsed = parse_custom_command(dto.command)
    except CustomCommandError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _launch_custom(project, parsed)


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
        cli_command=inv.cli_command,
        profile=inv.profile,
        target=inv.target,
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
    if inv.custom_args is not None:
        try:
            parsed = ParsedCommand.from_args(json.loads(inv.custom_args))
        except (CustomCommandError, json.JSONDecodeError, TypeError) as exc:
            raise HTTPException(status_code=400, detail=f"cannot rerun this command: {exc}") from exc
        return _launch_custom(project, parsed)
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
