"""First-run setup wizard: collect the global settings in one validated step.

The frontend shows the wizard until `setup_completed` is set. Installing dbt
afterwards is left to the normal global setup endpoint, which the wizard
triggers (and streams) as its final step.
"""
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.settings import (
    SETUP_COMPLETED_KEY,
    SettingsDto,
    _upsert,
    change_python_path,
    get_settings,
)
from app.config import settings
from app.db.engine import get_session
from app.db.models import AppSetting
from app.dbt import venv
from app.logging_setup import get_logger
from app.projects.service import rescan_projects

log = get_logger(__name__)

router = APIRouter(prefix="/api/setup", tags=["setup"])

# Seed for a requirements file the wizard creates: installs the same thing as
# leaving the path blank, but gives the user a file to add adapters to.
DEFAULT_REQUIREMENTS = "dbt-core\n"


class SetupDto(BaseModel):
    dbt_projects_path: str
    create_projects_dir: bool = False
    # Empty → auto-detect (the same search used before this setting existed).
    python_path: str = ""
    # Empty → global setup installs the latest dbt-core instead of a file.
    global_requirements_path: str = ""
    # Create a missing requirements file (seeded with DEFAULT_REQUIREMENTS).
    create_requirements_file: bool = False
    theme: Literal["dark", "light"] = "dark"


def _field_error(field: str, code: str, message: str) -> HTTPException:
    """400 naming the offending field, so the wizard can show it on that step."""
    return HTTPException(status_code=400, detail={"field": field, "code": code, "message": message})


def _resolve_projects_dir(raw: str, create: bool) -> Path:
    if not raw.strip():
        raise _field_error("dbt_projects_path", "required", "Choose a folder for your dbt projects.")
    path = Path(raw.strip()).expanduser()
    if not path.is_absolute():
        raise _field_error("dbt_projects_path", "invalid", "Use a full path, e.g. ~/dbt-projects.")
    if path.exists() and not path.is_dir():
        raise _field_error("dbt_projects_path", "invalid", f"{path} is a file, not a folder.")
    if not path.exists():
        if not create:
            raise _field_error("dbt_projects_path", "not_found", f"{path} doesn't exist yet.")
        try:
            path.mkdir(parents=True)
        except OSError as exc:
            raise _field_error("dbt_projects_path", "invalid", f"Couldn't create {path}: {exc}")
        log.info("setup_projects_dir_created", path=str(path))
    return path


def _resolve_requirements(raw: str, create: bool) -> tuple[Path | None, bool]:
    """Return (path, needs_creating). Nothing is written here, so a later
    validation failure doesn't leave a stray file behind."""
    if not raw.strip():
        return None, False
    path = Path(raw.strip()).expanduser()
    if not path.is_absolute():
        raise _field_error("global_requirements_path", "invalid", "Use a full path, e.g. ~/dbt-projects/requirements.txt.")
    if path.is_dir():
        raise _field_error("global_requirements_path", "invalid", f"{path} is a folder, not a file.")
    if path.is_file():
        return path, False
    if not create:
        raise _field_error("global_requirements_path", "not_found", f"No file at {path}.")
    return path, True


def _create_requirements_file(path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(DEFAULT_REQUIREMENTS)
    except OSError as exc:
        raise _field_error("global_requirements_path", "invalid", f"Couldn't create {path}: {exc}")
    log.info("setup_requirements_file_created", path=str(path))


async def _delete_setting(session: AsyncSession, key: str) -> None:
    row = await session.get(AppSetting, key)
    if row is not None:
        await session.delete(row)


@router.post("/complete", response_model=SettingsDto)
async def complete_setup(dto: SetupDto, session: AsyncSession = Depends(get_session)) -> SettingsDto:
    """Validate and save every wizard setting, then mark setup complete.

    Paths are checked before anything is written; the Python switch (which may
    rebuild the dbt venv) runs last among the checks, and nothing is committed
    unless every step succeeds.
    """
    projects_dir = _resolve_projects_dir(dto.dbt_projects_path, dto.create_projects_dir)
    requirements, create_requirements = _resolve_requirements(
        dto.global_requirements_path, dto.create_requirements_file
    )

    if not venv.is_own_venv():
        try:
            await change_python_path(session, dto.python_path)
        except HTTPException as exc:
            raise _field_error("python_path", "invalid", str(exc.detail)) from exc

    if requirements is not None and create_requirements:
        _create_requirements_file(requirements)

    await _upsert(session, "dbt_projects_path", str(projects_dir))
    if requirements is None:
        await _delete_setting(session, "global_requirements_path")
    else:
        await _upsert(session, "global_requirements_path", str(requirements))
    await _upsert(session, "theme", dto.theme)
    await _upsert(session, SETUP_COMPLETED_KEY, "true")
    await session.commit()
    log.info("setup_completed", projects_dir=str(projects_dir), requirements=str(requirements))

    await rescan_projects(session)
    return await get_settings(session)


async def seed_setup_completed(session: AsyncSession) -> None:
    """Skip the wizard for installs that predate it: if a projects folder is
    already configured (DB or env), mark setup complete. Runs at startup."""
    if await session.get(AppSetting, SETUP_COMPLETED_KEY) is not None:
        return
    row = await session.get(AppSetting, "dbt_projects_path")
    already_configured = (row is not None and bool(row.value)) or settings.dbt_projects_path is not None
    if already_configured:
        session.add(AppSetting(key=SETUP_COMPLETED_KEY, value="true"))
        await session.commit()
        log.info("setup_completed_seeded")
