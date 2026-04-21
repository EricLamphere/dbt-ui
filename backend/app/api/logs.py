"""
API endpoints for reading and clearing log files.

GET    /api/projects/{id}/logs/project   — last N lines of project_logs.log
DELETE /api/projects/{id}/logs/project   — truncate project_logs.log
GET    /api/projects/{id}/logs/api       — last N lines of api_logs.log
DELETE /api/projects/{id}/logs/api       — truncate api_logs.log
"""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project
from app.logs.api_logger import get_api_log_path, read_api_log_tail
from app.logs.project_logger import read_project_log_tail

router = APIRouter(prefix="/api/projects", tags=["logs"])


class LogLinesDto(BaseModel):
    lines: list[str]


class OkDto(BaseModel):
    ok: bool


def _clear_log_file(path: Path) -> None:
    if path.exists():
        path.write_text("", encoding="utf-8")


@router.get("/{project_id}/logs/project", response_model=LogLinesDto)
async def get_project_logs(
    project_id: int,
    tail: int = 500,
    session: AsyncSession = Depends(get_session),
) -> LogLinesDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    lines = read_project_log_tail(project.path, lines=min(tail, 2000))
    return LogLinesDto(lines=lines)


@router.delete("/{project_id}/logs/project", response_model=OkDto)
async def clear_project_logs(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> OkDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    log_file = Path(project.path) / "logs" / "dbt-ui" / "project_logs.log"
    _clear_log_file(log_file)
    return OkDto(ok=True)


@router.get("/{project_id}/logs/api", response_model=LogLinesDto)
async def get_api_logs(
    project_id: int,
    tail: int = 500,
) -> LogLinesDto:
    lines = read_api_log_tail(lines=min(tail, 2000))
    return LogLinesDto(lines=lines)


@router.delete("/{project_id}/logs/api", response_model=OkDto)
async def clear_api_logs(project_id: int) -> OkDto:
    path = get_api_log_path()
    if path is not None:
        _clear_log_file(path)
    return OkDto(ok=True)
