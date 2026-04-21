from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project
from app.dbt.manifest import load_manifest

router = APIRouter(prefix="/api/projects", tags=["sql"])


class SqlDto(BaseModel):
    unique_id: str
    path: str
    content: str


class SqlWriteDto(BaseModel):
    content: str


def _resolve_sql_path(project: Project, unique_id: str) -> Path:
    manifest = load_manifest(Path(project.path) / "target" / "manifest.json")
    if manifest is None:
        raise HTTPException(status_code=404, detail="manifest not found")
    node = next((n for n in manifest.nodes if n.unique_id == unique_id), None)
    if node is None or not node.original_file_path:
        raise HTTPException(status_code=404, detail="model file not found")
    project_root = Path(project.path).resolve()
    candidate = (project_root / node.original_file_path).resolve()
    if project_root not in candidate.parents and candidate != project_root:
        raise HTTPException(status_code=400, detail="path escapes project root")
    if not candidate.exists():
        raise HTTPException(status_code=404, detail="file not on disk")
    return candidate


@router.get("/{project_id}/models/{unique_id}/sql", response_model=SqlDto)
async def get_sql(
    project_id: int,
    unique_id: str,
    session: AsyncSession = Depends(get_session),
) -> SqlDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    path = _resolve_sql_path(project, unique_id)
    return SqlDto(unique_id=unique_id, path=str(path), content=path.read_text())


@router.put("/{project_id}/models/{unique_id}/sql", response_model=SqlDto)
async def put_sql(
    project_id: int,
    unique_id: str,
    dto: SqlWriteDto,
    session: AsyncSession = Depends(get_session),
) -> SqlDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    path = _resolve_sql_path(project, unique_id)
    path.write_text(dto.content)
    return SqlDto(unique_id=unique_id, path=str(path), content=dto.content)
