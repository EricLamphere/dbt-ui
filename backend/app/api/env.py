from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.engine import get_session
from app.db.models import GlobalProfile, Project, ProjectEnvVar
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["env"])


# ---- active global profile endpoints ----

_ACTIVE_GLOBAL_PROFILE_KEY = "active_global_profile_id"


class ActiveGlobalProfileDto(BaseModel):
    profile_id: int | None


class SetActiveGlobalProfileDto(BaseModel):
    profile_id: int


@router.get("/{project_id}/active-global-profile", response_model=ActiveGlobalProfileDto)
async def get_active_global_profile(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> ActiveGlobalProfileDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id,
            ProjectEnvVar.key == _ACTIVE_GLOBAL_PROFILE_KEY,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        return ActiveGlobalProfileDto(profile_id=None)
    try:
        return ActiveGlobalProfileDto(profile_id=int(row.value))
    except (ValueError, TypeError):
        return ActiveGlobalProfileDto(profile_id=None)


@router.put("/{project_id}/active-global-profile", response_model=ActiveGlobalProfileDto)
async def set_active_global_profile(
    project_id: int,
    dto: SetActiveGlobalProfileDto,
    session: AsyncSession = Depends(get_session),
) -> ActiveGlobalProfileDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    # Verify the global profile exists
    gp = await session.get(GlobalProfile, dto.profile_id)
    if gp is None:
        raise HTTPException(status_code=404, detail="global profile not found")
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id,
            ProjectEnvVar.key == _ACTIVE_GLOBAL_PROFILE_KEY,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = ProjectEnvVar(
            project_id=project_id,
            key=_ACTIVE_GLOBAL_PROFILE_KEY,
            value=str(dto.profile_id),
        )
        session.add(row)
    else:
        row.value = str(dto.profile_id)
    await session.commit()
    return ActiveGlobalProfileDto(profile_id=dto.profile_id)


@router.delete("/{project_id}/active-global-profile", status_code=204)
async def clear_active_global_profile(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> None:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id,
            ProjectEnvVar.key == _ACTIVE_GLOBAL_PROFILE_KEY,
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.commit()


# ---- dbt target endpoints ----

class DbtTargetsDto(BaseModel):
    targets: list[str]
    default_target: str | None


class DbtTargetDto(BaseModel):
    target: str | None


class SetDbtTargetDto(BaseModel):
    target: str


_DBT_TARGET_KEY = "dbt_target"


def _read_profiles_yml(project_path: Path) -> dict:
    """Read profiles.yml from project dir, fall back to ~/.dbt/profiles.yml."""
    local = project_path / "profiles.yml"
    if local.exists():
        with local.open() as f:
            return yaml.safe_load(f) or {}
    fallback = Path.home() / ".dbt" / "profiles.yml"
    if fallback.exists():
        with fallback.open() as f:
            return yaml.safe_load(f) or {}
    return {}


@router.get("/{project_id}/dbt-targets", response_model=DbtTargetsDto)
async def get_dbt_targets(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> DbtTargetsDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    profiles = _read_profiles_yml(Path(project.path))
    profile_name = project.profile
    if not profile_name or profile_name not in profiles:
        # Try to infer from project name
        profile_name = project.name if project.name in profiles else None

    if not profile_name or profile_name not in profiles:
        return DbtTargetsDto(targets=[], default_target=None)

    profile_data = profiles[profile_name]
    outputs = profile_data.get("outputs", {})
    default_target = profile_data.get("target")
    return DbtTargetsDto(targets=list(outputs.keys()), default_target=default_target)


@router.get("/{project_id}/dbt-target", response_model=DbtTargetDto)
async def get_dbt_target(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> DbtTargetDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id,
            ProjectEnvVar.key == _DBT_TARGET_KEY,
        )
    )
    row = result.scalar_one_or_none()
    return DbtTargetDto(target=row.value if row else None)


@router.put("/{project_id}/dbt-target", response_model=DbtTargetDto)
async def set_dbt_target(
    project_id: int,
    dto: SetDbtTargetDto,
    session: AsyncSession = Depends(get_session),
) -> DbtTargetDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id,
            ProjectEnvVar.key == _DBT_TARGET_KEY,
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = ProjectEnvVar(project_id=project_id, key=_DBT_TARGET_KEY, value=dto.target)
        session.add(row)
    else:
        row.value = dto.target
    await session.commit()
    return DbtTargetDto(target=row.value)
