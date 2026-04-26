from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.engine import get_session
from app.db.models import AppSetting

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdateDto(BaseModel):
    dbt_projects_path: str | None = None
    data_dir: str | None = None
    log_level: str | None = None
    global_requirements_path: str | None = None
    theme: str | None = None


class SettingsDto(BaseModel):
    dbt_projects_path: str | None
    data_dir: str | None
    log_level: str | None
    global_requirements_path: str | None
    theme: str | None
    configured: bool


async def _get_override(session: AsyncSession, key: str) -> str | None:
    row = await session.get(AppSetting, key)
    return row.value if row is not None else None


async def _upsert(session: AsyncSession, key: str, value: str) -> None:
    row = await session.get(AppSetting, key)
    if row is None:
        session.add(AppSetting(key=key, value=value))
    else:
        row.value = value


@router.get("", response_model=SettingsDto)
async def get_settings(session: AsyncSession = Depends(get_session)) -> SettingsDto:
    projects_path_override = await _get_override(session, "dbt_projects_path")
    if projects_path_override is not None:
        dbt_projects_path = projects_path_override
        configured = True
    elif settings.dbt_projects_path is not None:
        dbt_projects_path = str(settings.dbt_projects_path)
        configured = True
    else:
        dbt_projects_path = None
        configured = False

    data_dir_override = await _get_override(session, "data_dir")
    data_dir = data_dir_override if data_dir_override is not None else str(settings.data_dir)

    log_level_override = await _get_override(session, "log_level")
    log_level = log_level_override if log_level_override is not None else settings.log_level

    global_requirements_path = await _get_override(session, "global_requirements_path")
    theme = await _get_override(session, "theme")

    return SettingsDto(
        dbt_projects_path=dbt_projects_path,
        configured=configured,
        data_dir=data_dir,
        log_level=log_level,
        global_requirements_path=global_requirements_path,
        theme=theme,
    )


@router.put("", response_model=SettingsDto)
async def put_settings(
    dto: SettingsUpdateDto,
    session: AsyncSession = Depends(get_session),
) -> SettingsDto:
    if dto.dbt_projects_path is not None:
        await _upsert(session, "dbt_projects_path", dto.dbt_projects_path.strip())
    if dto.data_dir is not None:
        await _upsert(session, "data_dir", dto.data_dir)
    if dto.log_level is not None:
        await _upsert(session, "log_level", dto.log_level)
    if dto.global_requirements_path is not None:
        await _upsert(session, "global_requirements_path", dto.global_requirements_path.strip())
    if dto.theme is not None:
        await _upsert(session, "theme", dto.theme)
    await session.commit()
    return await get_settings(session)


class RequirementsFileDto(BaseModel):
    content: str


@router.get("/requirements-file", response_model=RequirementsFileDto)
async def get_requirements_file(
    session: AsyncSession = Depends(get_session),
) -> RequirementsFileDto:
    global_req_path = await _get_override(session, "global_requirements_path")
    if not global_req_path:
        raise HTTPException(
            status_code=400,
            detail="DBT_UI_GLOBAL_REQUIREMENTS_PATH variable has not been set",
        )
    p = Path(global_req_path)
    if not p.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found at the path specified in the DBT_UI_GLOBAL_REQUIREMENTS_PATH variable: {global_req_path}",
        )
    return RequirementsFileDto(content=p.read_text())


@router.put("/requirements-file", response_model=RequirementsFileDto)
async def put_requirements_file(
    dto: RequirementsFileDto,
    session: AsyncSession = Depends(get_session),
) -> RequirementsFileDto:
    global_req_path = await _get_override(session, "global_requirements_path")
    if not global_req_path:
        raise HTTPException(
            status_code=400,
            detail="DBT_UI_GLOBAL_REQUIREMENTS_PATH variable has not been set",
        )
    p = Path(global_req_path)
    p.write_text(dto.content)
    return RequirementsFileDto(content=dto.content)
