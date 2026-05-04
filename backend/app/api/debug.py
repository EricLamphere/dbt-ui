import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import AppSetting, Project
from app.dbt.debug_parser import parse_debug_output
from app.dbt.runner import RunRequest, runner

router = APIRouter(prefix="/api/projects", tags=["debug"])


class DebugCheckDto(BaseModel):
    key: str
    label: str
    status: str  # ok | fail | warn | info
    detail: str


class DebugResultDto(BaseModel):
    overall_ok: bool
    dbt_version: str | None
    python_version: str | None
    adapter_name: str | None
    adapter_version: str | None
    profiles_dir: str | None
    profile_name: str | None
    target_name: str | None
    checks: list[DebugCheckDto]
    raw_log: str
    started_at: str
    finished_at: str


@router.post("/{project_id}/debug", response_model=DebugResultDto)
async def run_debug(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> DebugResultDto:
    from app.api.init import load_project_env
    from app.events.bus import Event, bus

    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    env = await load_project_env(project_id)
    target_val = env.get("DBT_TARGET")
    target_args: tuple[str, ...] = ("--target", target_val) if target_val else ()

    started_at = datetime.now(timezone.utc).isoformat()
    await bus.publish(
        Event(topic=f"project:{project_id}", type="health_check_started", data={})
    )

    req = RunRequest(
        project_id=project_id,
        project_path=__import__("pathlib").Path(project.path),
        command="debug",
        extra=target_args,
        env=env,
    )

    output_lines: list[str] = []
    async for _kind, line in runner.stream(req):
        output_lines.append(line)

    raw_log = "\n".join(output_lines)
    result = parse_debug_output(raw_log)
    finished_at = datetime.now(timezone.utc).isoformat()

    dto = DebugResultDto(
        overall_ok=result.overall_ok,
        dbt_version=result.dbt_version,
        python_version=result.python_version,
        adapter_name=result.adapter_name,
        adapter_version=result.adapter_version,
        profiles_dir=result.profiles_dir,
        profile_name=result.profile_name,
        target_name=result.target_name,
        checks=[
            DebugCheckDto(key=c.key, label=c.label, status=c.status, detail=c.detail)
            for c in result.checks
        ],
        raw_log=raw_log,
        started_at=started_at,
        finished_at=finished_at,
    )

    # Persist to app_settings for "last run" retrieval
    key = f"health_check:{project_id}"
    existing = await session.get(AppSetting, key)
    if existing is None:
        session.add(AppSetting(key=key, value=dto.model_dump_json()))
    else:
        existing.value = dto.model_dump_json()
    await session.commit()

    await bus.publish(
        Event(
            topic=f"project:{project_id}",
            type="health_check_finished",
            data={"overall_ok": result.overall_ok},
        )
    )

    return dto


@router.get("/{project_id}/debug/last", response_model=DebugResultDto | None)
async def get_last_debug(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> DebugResultDto | None:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    key = f"health_check:{project_id}"
    row = await session.get(AppSetting, key)
    if row is None:
        return None

    try:
        return DebugResultDto.model_validate_json(row.value)
    except Exception:
        return None
