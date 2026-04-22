"""Global profile templates — named env var sets that can be imported into any project."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.engine import get_session
from app.db.models import GlobalProfile, GlobalProfileVar

router = APIRouter(prefix="/api/global-profiles", tags=["global-profiles"])


# ---- DTOs ----

class GlobalProfileVarDto(BaseModel):
    key: str
    value: str


class GlobalProfileDto(BaseModel):
    id: int
    name: str
    vars: list[GlobalProfileVarDto]


class CreateGlobalProfileDto(BaseModel):
    name: str


class UpsertVarDto(BaseModel):
    value: str


# ---- helpers ----

def _to_dto(profile: GlobalProfile) -> GlobalProfileDto:
    return GlobalProfileDto(
        id=profile.id,
        name=profile.name,
        vars=[GlobalProfileVarDto(key=v.key, value=v.value) for v in profile.vars],
    )


async def _get_with_vars(session: AsyncSession, profile_id: int) -> GlobalProfile | None:
    result = await session.execute(
        select(GlobalProfile)
        .where(GlobalProfile.id == profile_id)
        .options(selectinload(GlobalProfile.vars))
    )
    return result.scalar_one_or_none()


# ---- endpoints ----

@router.get("", response_model=list[GlobalProfileDto])
async def list_global_profiles(session: AsyncSession = Depends(get_session)) -> list[GlobalProfileDto]:
    result = await session.execute(
        select(GlobalProfile).order_by(GlobalProfile.name).options(selectinload(GlobalProfile.vars))
    )
    return [_to_dto(p) for p in result.scalars().unique().all()]


@router.post("", response_model=GlobalProfileDto, status_code=201)
async def create_global_profile(
    dto: CreateGlobalProfileDto,
    session: AsyncSession = Depends(get_session),
) -> GlobalProfileDto:
    name = dto.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name cannot be empty")
    existing = await session.execute(select(GlobalProfile).where(GlobalProfile.name == name))
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(status_code=409, detail=f"global profile '{name}' already exists")
    profile = GlobalProfile(name=name)
    session.add(profile)
    await session.commit()
    loaded = await _get_with_vars(session, profile.id)
    return _to_dto(loaded)  # type: ignore[arg-type]


@router.delete("/{profile_id}", status_code=204)
async def delete_global_profile(
    profile_id: int,
    session: AsyncSession = Depends(get_session),
) -> None:
    profile = await session.get(GlobalProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="global profile not found")
    await session.delete(profile)
    await session.commit()


@router.put("/{profile_id}/vars/{key}", response_model=GlobalProfileVarDto)
async def put_global_profile_var(
    profile_id: int,
    key: str,
    dto: UpsertVarDto,
    session: AsyncSession = Depends(get_session),
) -> GlobalProfileVarDto:
    profile = await session.get(GlobalProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="global profile not found")
    result = await session.execute(
        select(GlobalProfileVar).where(
            GlobalProfileVar.profile_id == profile_id, GlobalProfileVar.key == key
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = GlobalProfileVar(profile_id=profile_id, key=key, value=dto.value)
        session.add(row)
    else:
        row.value = dto.value
    await session.commit()
    await session.refresh(row)
    return GlobalProfileVarDto(key=row.key, value=row.value)


@router.delete("/{profile_id}/vars/{key}", status_code=204)
async def delete_global_profile_var(
    profile_id: int,
    key: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    profile = await session.get(GlobalProfile, profile_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="global profile not found")
    result = await session.execute(
        select(GlobalProfileVar).where(
            GlobalProfileVar.profile_id == profile_id, GlobalProfileVar.key == key
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.commit()
