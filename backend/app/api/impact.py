"""Impact analysis API — which dbt nodes a git change set touches.

The frontend computes the downstream impact itself from the graph
(``lib/impact.ts``); this endpoint only supplies the "changed" seed nodes:
files changed in the working tree (``scope=working``) or on the current
branch vs. a base (``scope=branch``), mapped to manifest nodes.
"""
import asyncio
import json
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project
from app.dbt.changes import (
    ChangeMapping,
    map_changed_files,
    resource_dirs_from_project_yml,
)
from app.git.changeset import (
    ChangeSetError,
    branch_changes,
    current_branch,
    resolve_base,
    to_project_files,
    working_changes,
)
from app.git.repo import find_repo_root
from app.git.runner import GitRequest, git_runner
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["impact"])

ChangeScope = Literal["working", "branch"]


class ChangedFileDto(BaseModel):
    path: str
    change: str


class ChangeReasonDto(BaseModel):
    kind: str  # file | yaml | macro
    path: str
    change: str
    macro: str | None = None


class ChangedNodeDto(BaseModel):
    unique_id: str
    reasons: list[ChangeReasonDto]


class ImpactChangesDto(BaseModel):
    scope: ChangeScope
    branch: str | None
    base: str | None          # resolved base ref (branch scope only)
    merge_base: str | None    # short sha (branch scope only)
    manifest_available: bool
    changed_files: int        # dbt-relevant changed files (mapped, project-wide or unmapped)
    nodes: list[ChangedNodeDto]
    unmapped: list[ChangedFileDto]
    project_wide: list[ChangedFileDto]


def _load_manifest_dict(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("impact_manifest_read_failed", path=str(path), error=str(exc))
        return None
    return data if isinstance(data, dict) else None


def _read_text(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


def _project_subpath(project_path: Path, repo: Path) -> str:
    try:
        rel = project_path.resolve().relative_to(repo)
    except ValueError:
        return ""
    return "" if str(rel) == "." else rel.as_posix()


def _to_dto(
    scope: ChangeScope, branch: str | None, base: str | None, merge_base: str | None,
    mapping: ChangeMapping, manifest_available: bool,
) -> ImpactChangesDto:
    return ImpactChangesDto(
        scope=scope,
        branch=branch,
        base=base,
        merge_base=merge_base[:7] if merge_base else None,
        manifest_available=manifest_available,
        changed_files=mapping.relevant_files,
        nodes=[
            ChangedNodeDto(
                unique_id=uid,
                reasons=[ChangeReasonDto(kind=r.kind, path=r.path, change=r.change, macro=r.macro) for r in reasons],
            )
            for uid, reasons in mapping.nodes.items()
        ],
        unmapped=[ChangedFileDto(path=f.path, change=f.change) for f in mapping.unmapped],
        project_wide=[ChangedFileDto(path=f.path, change=f.change) for f in mapping.project_wide],
    )


@router.get("/{project_id}/impact/changes", response_model=ImpactChangesDto)
async def get_impact_changes(
    project_id: int,
    scope: ChangeScope = Query("working"),
    base: str | None = Query(None, max_length=255),
    session: AsyncSession = Depends(get_session),
) -> ImpactChangesDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    project_path = Path(project.path)
    repo = find_repo_root(project_path)
    if repo is None:
        raise HTTPException(status_code=422, detail="project is not inside a git repository")

    async def git(*args: str) -> tuple[int, str]:
        return await git_runner.run(GitRequest(project_id=project_id, repo_root=repo, args=args))

    try:
        branch = await current_branch(git)
        resolved_base: str | None = None
        merge_base: str | None = None
        if scope == "branch":
            resolved_base = await resolve_base(git, base)
            merge_base, repo_changes = await branch_changes(git, resolved_base)
        else:
            repo_changes = await working_changes(git)
    except ChangeSetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    files = to_project_files(repo_changes, _project_subpath(project_path, repo))
    loop = asyncio.get_running_loop()
    manifest = await loop.run_in_executor(None, _load_manifest_dict, project_path / "target" / "manifest.json")
    project_yml = await loop.run_in_executor(None, _read_text, project_path / "dbt_project.yml")
    mapping = map_changed_files(manifest or {}, files, resource_dirs_from_project_yml(project_yml))
    return _to_dto(scope, branch, resolved_base, merge_base, mapping, manifest is not None)
