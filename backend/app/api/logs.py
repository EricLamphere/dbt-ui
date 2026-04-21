"""
API endpoints for reading log files.

GET  /api/projects/{id}/logs/project   — last N lines of project_logs.log
GET  /api/projects/{id}/logs/api       — last N lines of api_logs.log
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project
from app.logs.api_logger import read_api_log_tail
from app.logs.project_logger import read_project_log_tail

router = APIRouter(prefix="/api/projects", tags=["logs"])


class LogLinesDto(BaseModel):
    lines: list[str]


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


@router.get("/{project_id}/logs/api", response_model=LogLinesDto)
async def get_api_logs(
    project_id: int,
    tail: int = 500,
) -> LogLinesDto:
    lines = read_api_log_tail(lines=min(tail, 2000))
    return LogLinesDto(lines=lines)
