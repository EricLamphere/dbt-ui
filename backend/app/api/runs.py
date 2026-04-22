import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select as sa_select

from app.db.engine import SessionLocal, get_session
from app.db.models import ModelStatus, Project, ProjectEnvVar
from app.dbt.manifest import load_manifest
from app.dbt.run_results import load_run_results
from app.api.init import load_project_env
from app.dbt.runner import RunRequest, runner
from app.dbt.select import SelectMode, build_selector
from app.events.bus import Event, bus
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["runs"])


class RunRequestDto(BaseModel):
    model: str | None = None
    mode: SelectMode = "only"
    select: str | None = None  # explicit pass-through if provided


class RunResponseDto(BaseModel):
    accepted: bool
    command: str
    select: str | None


def _resolve_selector(dto: RunRequestDto) -> str | None:
    if dto.select:
        return dto.select
    if dto.model:
        return build_selector(dto.model, dto.mode)
    return None


async def _persist_results_after_run(project: Project) -> None:
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
            row.finished_at = now
        await session.commit()

    await bus.publish(
        Event(topic=f"project:{project.id}", type="statuses_changed", data={})
    )

    # Emit test_failed events for failed tests so the frontend can auto-show rows
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


async def _run_dbt_and_persist(project: Project, command: str, select: str | None) -> None:
    env = await load_project_env(project.id)
    target = await _load_active_target(project.id)
    extra: tuple[str, ...] = ("--target", target) if target else ()
    req = RunRequest(
        project_id=project.id,
        project_path=Path(project.path),
        command=command,
        select=select,
        extra=extra,
        env=env,
    )
    async for _ in runner.stream(req):
        pass
    await _persist_results_after_run(project)


async def _launch(
    project: Project, command: str, dto: RunRequestDto
) -> RunResponseDto:
    select = _resolve_selector(dto)
    asyncio.create_task(_run_dbt_and_persist(project, command, select))
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
