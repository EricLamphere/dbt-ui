import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.init import global_setup_running, init_pipeline_running
from app.config import settings
from app.db.engine import get_session
from app.db.models import AppSetting
from app.dbt import venv
from app.dbt.python_env import PYTHON_PATH_KEY
from app.dbt.runner import runner
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# "true" once the first-run setup wizard has been completed (see api/setup.py).
SETUP_COMPLETED_KEY = "setup_completed"


class SettingsUpdateDto(BaseModel):
    dbt_projects_path: str | None = None
    data_dir: str | None = None
    log_level: str | None = None
    global_requirements_path: str | None = None
    theme: str | None = None
    python_path: str | None = None


class SettingsDto(BaseModel):
    dbt_projects_path: str | None
    data_dir: str | None
    log_level: str | None
    global_requirements_path: str | None
    theme: str | None
    python_path: str | None
    # False only when DBT_UI_DBT_VENV_DIR points at the venv the backend itself
    # runs from — rebuilding that would take the server down with it.
    python_path_editable: bool
    configured: bool
    setup_completed: bool


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
    python_path = await _get_override(session, PYTHON_PATH_KEY)
    setup_completed = await _get_override(session, SETUP_COMPLETED_KEY) == "true"

    return SettingsDto(
        dbt_projects_path=dbt_projects_path,
        configured=configured,
        data_dir=data_dir,
        log_level=log_level,
        global_requirements_path=global_requirements_path,
        theme=theme,
        python_path=python_path or None,
        python_path_editable=not venv.is_own_venv(),
        setup_completed=setup_completed,
    )


def _python_env_busy_reason() -> str | None:
    """Why the dbt venv can't be rebuilt right now, if anything is using it."""
    if runner.is_busy():
        return "a dbt command is running"
    if global_setup_running():
        return "global setup is running"
    if init_pipeline_running():
        return "a project init pipeline is running"
    return None


async def change_python_path(session: AsyncSession, raw: str) -> None:
    """Validate the interpreter, rebuild the dbt venv from it, then save.

    Empty input re-runs auto-detection. The setting is only saved once the new
    venv exists, so a failed rebuild leaves the previous value in place.
    """
    if venv.is_own_venv():
        raise HTTPException(
            status_code=400,
            detail="DBT_UI_DBT_VENV_DIR points at the venv dbt-ui itself runs from, "
            "which can't be rebuilt — point it at a separate directory to switch Python.",
        )
    loop = asyncio.get_running_loop()
    try:
        if raw.strip():
            python = venv.validate_python(raw)
        else:
            python = await loop.run_in_executor(None, venv.find_system_python)
    except (venv.InvalidPythonError, RuntimeError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    venv_exists = (settings.dbt_venv_dir / "bin" / "python3").exists()
    if not (venv_exists and venv.same_interpreter(venv.venv_built_from(), python)):
        busy = _python_env_busy_reason()
        if busy:
            raise HTTPException(
                status_code=409,
                detail=f"Can't switch Python while {busy} — try again once it finishes.",
            )
        try:
            await loop.run_in_executor(None, venv.rebuild_venv, python)
        except RuntimeError as exc:
            log.error("python_path_rebuild_failed", python=python, error=str(exc))
            raise HTTPException(status_code=500, detail=str(exc))
        log.info("python_path_changed", python=python)

    await _upsert(session, PYTHON_PATH_KEY, python)
    venv.set_configured_python(python)


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
    if dto.python_path is not None:
        await change_python_path(session, dto.python_path)
    await session.commit()
    return await get_settings(session)


class PythonInterpreterDto(BaseModel):
    path: str
    version: str


@router.get("/python-interpreters", response_model=list[PythonInterpreterDto])
async def list_python_interpreters(
    session: AsyncSession = Depends(get_session),
) -> list[PythonInterpreterDto]:
    """Python 3.11+ interpreters on this machine, for the DBT_UI_PYTHON_PATH picker."""
    current = await _get_override(session, PYTHON_PATH_KEY)
    found = await asyncio.get_running_loop().run_in_executor(None, venv.list_pythons, current)
    return [PythonInterpreterDto(path=p.path, version=p.version) for p in found]


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
