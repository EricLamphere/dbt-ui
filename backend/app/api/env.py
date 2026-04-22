from pathlib import Path

import yaml
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.engine import get_session
from app.db.models import EnvProfile, ProfileEnvVar, Project, ProjectEnvVar
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["env"])


# ---- DTOs ----

class ProfileVarDto(BaseModel):
    key: str
    value: str


class ProfileDto(BaseModel):
    id: int
    name: str
    is_default: bool
    is_active: bool
    vars: list[ProfileVarDto]


class CreateProfileDto(BaseModel):
    name: str


class RenameProfileDto(BaseModel):
    name: str | None = None


# ---- helpers ----

async def _ensure_default_profile(session: AsyncSession, project_id: int) -> None:
    """Auto-create 'dev' default profile if none exist."""
    result = await session.execute(
        select(EnvProfile).where(EnvProfile.project_id == project_id)
    )
    if result.scalars().first() is None:
        dev = EnvProfile(project_id=project_id, name="dev", is_default=True, is_active=True)
        session.add(dev)
        await session.commit()


def _profile_to_dto(profile: EnvProfile) -> ProfileDto:
    return ProfileDto(
        id=profile.id,
        name=profile.name,
        is_default=profile.is_default,
        is_active=profile.is_active,
        vars=[ProfileVarDto(key=v.key, value=v.value) for v in profile.vars],
    )


async def _get_profile_with_vars(session: AsyncSession, profile_id: int) -> EnvProfile | None:
    result = await session.execute(
        select(EnvProfile)
        .where(EnvProfile.id == profile_id)
        .options(selectinload(EnvProfile.vars))
    )
    return result.scalar_one_or_none()


# ---- endpoints ----

@router.get("/{project_id}/profiles", response_model=list[ProfileDto])
async def get_profiles(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> list[ProfileDto]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    await _ensure_default_profile(session, project_id)
    result = await session.execute(
        select(EnvProfile)
        .where(EnvProfile.project_id == project_id)
        .order_by(EnvProfile.id)
        .options(selectinload(EnvProfile.vars))
    )
    profiles = result.scalars().unique().all()
    return [_profile_to_dto(p) for p in profiles]


@router.post("/{project_id}/profiles", response_model=ProfileDto, status_code=201)
async def create_profile(
    project_id: int,
    dto: CreateProfileDto,
    session: AsyncSession = Depends(get_session),
) -> ProfileDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    name = dto.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name cannot be empty")
    # Check uniqueness
    result = await session.execute(
        select(EnvProfile).where(EnvProfile.project_id == project_id, EnvProfile.name == name)
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"profile '{name}' already exists")
    profile = EnvProfile(project_id=project_id, name=name, is_default=False, is_active=False)
    session.add(profile)
    await session.commit()
    loaded = await _get_profile_with_vars(session, profile.id)
    return _profile_to_dto(loaded)  # type: ignore[arg-type]


@router.patch("/{project_id}/profiles/{profile_id}", response_model=ProfileDto)
async def update_profile(
    project_id: int,
    profile_id: int,
    dto: RenameProfileDto,
    session: AsyncSession = Depends(get_session),
) -> ProfileDto:
    profile = await session.get(EnvProfile, profile_id)
    if profile is None or profile.project_id != project_id:
        raise HTTPException(status_code=404, detail="profile not found")
    if dto.name is not None:
        name = dto.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="name cannot be empty")
        profile.name = name
    await session.commit()
    loaded = await _get_profile_with_vars(session, profile.id)
    return _profile_to_dto(loaded)  # type: ignore[arg-type]


@router.delete("/{project_id}/profiles/{profile_id}", status_code=204)
async def delete_profile(
    project_id: int,
    profile_id: int,
    session: AsyncSession = Depends(get_session),
) -> None:
    profile = await session.get(EnvProfile, profile_id)
    if profile is None or profile.project_id != project_id:
        raise HTTPException(status_code=404, detail="profile not found")
    if profile.is_default:
        raise HTTPException(status_code=400, detail="cannot delete the default profile")
    await session.delete(profile)
    await session.commit()


@router.put("/{project_id}/profiles/{profile_id}/vars/{key}", response_model=ProfileVarDto)
async def put_profile_var(
    project_id: int,
    profile_id: int,
    key: str,
    dto: ProfileVarDto,
    session: AsyncSession = Depends(get_session),
) -> ProfileVarDto:
    profile = await session.get(EnvProfile, profile_id)
    if profile is None or profile.project_id != project_id:
        raise HTTPException(status_code=404, detail="profile not found")
    result = await session.execute(
        select(ProfileEnvVar).where(
            ProfileEnvVar.profile_id == profile_id, ProfileEnvVar.key == key
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = ProfileEnvVar(profile_id=profile_id, key=dto.key, value=dto.value)
        session.add(row)
    else:
        row.key = dto.key
        row.value = dto.value
    await session.commit()
    await session.refresh(row)
    return ProfileVarDto(key=row.key, value=row.value)


@router.delete("/{project_id}/profiles/{profile_id}/vars/{key}", status_code=204)
async def delete_profile_var(
    project_id: int,
    profile_id: int,
    key: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    profile = await session.get(EnvProfile, profile_id)
    if profile is None or profile.project_id != project_id:
        raise HTTPException(status_code=404, detail="profile not found")
    result = await session.execute(
        select(ProfileEnvVar).where(
            ProfileEnvVar.profile_id == profile_id, ProfileEnvVar.key == key
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.commit()


@router.post("/{project_id}/profiles/{profile_id}/activate", response_model=ProfileDto)
async def activate_profile(
    project_id: int,
    profile_id: int,
    session: AsyncSession = Depends(get_session),
) -> ProfileDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    profile = await session.get(EnvProfile, profile_id)
    if profile is None or profile.project_id != project_id:
        raise HTTPException(status_code=404, detail="profile not found")

    # Deactivate all, activate this one
    result = await session.execute(
        select(EnvProfile).where(EnvProfile.project_id == project_id)
    )
    for p in result.scalars().all():
        p.is_active = p.id == profile_id
    await session.commit()
    loaded = await _get_profile_with_vars(session, profile_id)
    return _profile_to_dto(loaded)  # type: ignore[arg-type]


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
