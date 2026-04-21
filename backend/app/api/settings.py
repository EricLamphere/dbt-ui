from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.engine import get_session
from app.db.models import AppSetting

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdateDto(BaseModel):
    dbt_projects_path: str


class SettingsDto(BaseModel):
    dbt_projects_path: str | None
    configured: bool


async def _get_override(session: AsyncSession, key: str) -> str | None:
    row = await session.get(AppSetting, key)
    return row.value if row is not None else None


@router.get("", response_model=SettingsDto)
async def get_settings(session: AsyncSession = Depends(get_session)) -> SettingsDto:
    override = await _get_override(session, "dbt_projects_path")
    if override is not None:
        return SettingsDto(dbt_projects_path=override, configured=True)
    env_path = settings.dbt_projects_path
    if env_path is not None:
        return SettingsDto(dbt_projects_path=str(env_path), configured=True)
    return SettingsDto(dbt_projects_path=None, configured=False)


@router.put("", response_model=SettingsDto)
async def put_settings(
    dto: SettingsUpdateDto,
    session: AsyncSession = Depends(get_session),
) -> SettingsDto:
    row = await session.get(AppSetting, "dbt_projects_path")
    if row is None:
        session.add(AppSetting(key="dbt_projects_path", value=dto.dbt_projects_path))
    else:
        row.value = dto.dbt_projects_path
    await session.commit()
    return SettingsDto(dbt_projects_path=dto.dbt_projects_path, configured=True)
