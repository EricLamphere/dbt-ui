"""Documentation generator: add stub `- name:` entries for a node and its columns
to the schema YAML next to it (creating the file/entry if needed)."""

import asyncio
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.init import load_project_env
from app.api.models import _compile_model
from app.db.engine import get_session
from app.db.models import Project
from app.dbt.manifest import load_manifest
from app.dbt.probe import probe_warehouse_columns
from app.dbt.schema_yaml import RESOURCE_KEYS, DocumentTarget, SchemaYamlError, document_node
from app.logging_setup import get_logger

router = APIRouter(prefix="/api/projects", tags=["document"])
log = get_logger(__name__)

MAX_COLUMNS = 2000
ColumnName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]


class DocumentRequestDto(BaseModel):
    # None → read the node's actual columns from the warehouse
    columns: list[ColumnName] | None = Field(default=None, max_length=MAX_COLUMNS)


class DocumentResultDto(BaseModel):
    path: str
    created_file: bool
    added_entry: bool
    added_columns: list[str]


@router.post("/{project_id}/models/{unique_id:path}/document", response_model=DocumentResultDto)
async def document_model(
    project_id: int,
    unique_id: str,
    dto: DocumentRequestDto,
    session: AsyncSession = Depends(get_session),
) -> DocumentResultDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    project_path = Path(project.path)

    manifest = await asyncio.to_thread(load_manifest, project_path / "target" / "manifest.json")
    if manifest is None:
        raise HTTPException(status_code=422, detail="manifest not found — run dbt compile first")
    node = next((n for n in manifest.nodes if n.unique_id == unique_id), None)
    if node is None:
        raise HTTPException(status_code=404, detail="node not found")
    if node.resource_type not in RESOURCE_KEYS or not node.original_file_path:
        raise HTTPException(
            status_code=422, detail=f"documenting a {node.resource_type} is not supported"
        )

    columns = dto.columns
    if columns is None:
        env = await load_project_env(project_id)
        probe = await probe_warehouse_columns(
            project_id, project_path, node.name, env, env.get("DBT_TARGET")
        )
        if probe.error is not None:
            raise HTTPException(
                status_code=422, detail=f"could not read columns from the warehouse: {probe.error}"
            )
        columns = list(probe.columns)

    target = DocumentTarget(
        name=node.name,
        resource_type=node.resource_type,
        original_file_path=node.original_file_path,
        patch_path=node.patch_path,
    )
    try:
        result = await asyncio.to_thread(document_node, project_path, target, columns)
    except SchemaYamlError as exc:
        log.warning("document_failed", project_id=project_id, unique_id=unique_id, error=str(exc))
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    log.info(
        "document_written",
        project_id=project_id,
        unique_id=unique_id,
        path=result.path,
        added_columns=len(result.added_columns),
    )
    if result.created_file or result.added_entry or result.added_columns:
        # Refresh the manifest so the side pane / docs pick up the new entries
        asyncio.create_task(_compile_model(project_id, project.path, node.name))

    return DocumentResultDto(
        path=result.path,
        created_file=result.created_file,
        added_entry=result.added_entry,
        added_columns=list(result.added_columns),
    )
