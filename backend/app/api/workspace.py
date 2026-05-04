import asyncio
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project, ProjectEnvVar
from app.dbt.venv import venv_dbt
from app.api.init import load_project_env
from app.logs.project_logger import append_project_log

router = APIRouter(prefix="/api/projects", tags=["workspace"])

_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")
_LIMIT_RE = re.compile(r"\bLIMIT\s+(\d+)\s*;?\s*$", re.IGNORECASE)


class WorkspaceCompileRequestDto(BaseModel):
    sql: str


class WorkspaceCompileResponseDto(BaseModel):
    compiled_sql: str


class WorkspaceRunRequestDto(BaseModel):
    sql: str
    limit: int = 100


class WorkspaceRunResponseDto(BaseModel):
    columns: list[str]
    rows: list[list]


class WorkspacePathResponseDto(BaseModel):
    path: str
    relative_path: str


async def _resolve_workspace_path(session: AsyncSession, project: Project) -> Path:
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project.id,
            ProjectEnvVar.key == "WORKSPACE_PATH",
        )
    )
    row = result.scalar_one_or_none()
    rel = (row.value.strip() if row and row.value.strip() else None) or "workspace"
    ws_path = Path(project.path) / rel
    ws_path.mkdir(parents=True, exist_ok=True)
    return ws_path


def _parse_show_output(stdout: str, stderr: str, label: str) -> WorkspaceRunResponseDto:
    clean = _ANSI_RE.sub("", stdout)

    json_candidates: list[str] = []
    buffer: list[str] = []
    depth = 0
    for line in clean.splitlines():
        stripped = line.strip()
        if not buffer and not stripped.startswith("{"):
            continue
        buffer.append(stripped)
        depth += stripped.count("{") - stripped.count("}")
        if depth <= 0 and buffer:
            json_candidates.append("\n".join(buffer))
            buffer = []
            depth = 0

    for candidate in json_candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        results = parsed.get("results") or []
        if results:
            result = results[0]
            table = result.get("table") or result.get("agate_table") or {}
            columns: list[str] = table.get("column_names") or []
            rows: list[list] = table.get("rows") or []
            return WorkspaceRunResponseDto(columns=columns, rows=rows)

        show_rows = parsed.get("show")
        if isinstance(show_rows, list) and show_rows:
            columns = list(show_rows[0].keys())
            rows = [[row.get(c) for c in columns] for row in show_rows]
            return WorkspaceRunResponseDto(columns=columns, rows=rows)

    detail = (stdout + "\n" + stderr).strip()[-1000:]
    raise HTTPException(status_code=422, detail=f"Could not parse dbt show output:\n{detail}")


@router.get("/{project_id}/workspace/path", response_model=WorkspacePathResponseDto)
async def get_workspace_path(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> WorkspacePathResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id,
            ProjectEnvVar.key == "WORKSPACE_PATH",
        )
    )
    row = result.scalar_one_or_none()
    rel = (row.value.strip() if row and row.value.strip() else None) or "workspace"
    ws_path = Path(project.path) / rel
    ws_path.mkdir(parents=True, exist_ok=True)

    return WorkspacePathResponseDto(path=str(ws_path), relative_path=rel)


@router.post("/{project_id}/workspace/compile", response_model=WorkspaceCompileResponseDto)
async def compile_workspace_sql(
    project_id: int,
    dto: WorkspaceCompileRequestDto,
    session: AsyncSession = Depends(get_session),
) -> WorkspaceCompileResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    sql = dto.sql.strip()
    if not sql:
        raise HTTPException(status_code=400, detail="SQL cannot be empty")

    env = await load_project_env(project_id)
    append_project_log(project.path, f">>> dbt compile --inline {sql}", project_id)

    try:
        proc = await asyncio.create_subprocess_exec(
            str(venv_dbt()),
            "compile",
            "--inline", sql,
            "--output", "json",
            cwd=project.path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout_bytes, stderr_bytes = await proc.communicate()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="dbt executable not found")
    except Exception as exc:
        append_project_log(project.path, f"ERROR: dbt compile failed: {exc}", project_id)
        raise HTTPException(status_code=500, detail=f"dbt compile failed: {exc}")

    stdout = stdout_bytes.decode(errors="replace")
    stderr = stderr_bytes.decode(errors="replace")

    if proc.returncode != 0:
        detail = stderr[-1000:] or stdout[-1000:]
        append_project_log(project.path, "<<< dbt compile --inline FAILED", project_id)
        for line in detail.splitlines():
            if line.strip():
                append_project_log(project.path, line, project_id)
        raise HTTPException(status_code=422, detail=f"dbt compile failed:\n{detail}")

    # Extract compiled SQL from JSON output
    clean = _ANSI_RE.sub("", stdout)
    buffer: list[str] = []
    depth = 0
    for line in clean.splitlines():
        stripped = line.strip()
        if not buffer and not stripped.startswith("{"):
            continue
        buffer.append(stripped)
        depth += stripped.count("{") - stripped.count("}")
        if depth <= 0 and buffer:
            try:
                parsed = json.loads("\n".join(buffer))
                # dbt 1.10+: {"compiled": "<sql>"}
                compiled = parsed.get("compiled")
                if compiled and isinstance(compiled, str):
                    append_project_log(project.path, "<<< dbt compile --inline OK", project_id)
                    return WorkspaceCompileResponseDto(compiled_sql=compiled)
                # older format: {"results": [{"node": {"compiled_code": ...}}]}
                results = parsed.get("results") or []
                if results:
                    node = results[0].get("node") or {}
                    compiled = node.get("compiled_code") or node.get("compiled_sql") or ""
                    if compiled:
                        append_project_log(project.path, "<<< dbt compile --inline OK", project_id)
                        return WorkspaceCompileResponseDto(compiled_sql=compiled)
            except json.JSONDecodeError:
                pass
            buffer = []
            depth = 0

    detail = (stdout + "\n" + stderr).strip()[-1000:]
    append_project_log(project.path, "<<< dbt compile --inline FAILED (could not parse output)", project_id)
    raise HTTPException(status_code=422, detail=f"Could not parse dbt compile output:\n{detail}")


@router.post("/{project_id}/workspace/run", response_model=WorkspaceRunResponseDto)
async def run_workspace_sql(
    project_id: int,
    dto: WorkspaceRunRequestDto,
    session: AsyncSession = Depends(get_session),
) -> WorkspaceRunResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    sql = dto.sql.strip().rstrip(";").strip()
    if not sql:
        raise HTTPException(status_code=400, detail="SQL cannot be empty")

    limit = max(1, min(dto.limit, 5000))
    m = _LIMIT_RE.search(sql)
    if m:
        limit = int(m.group(1))
        sql = sql[: m.start()].rstrip()

    env = await load_project_env(project_id)
    append_project_log(project.path, f">>> dbt show --inline ... --limit {limit}", project_id)

    try:
        proc = await asyncio.create_subprocess_exec(
            str(venv_dbt()),
            "show",
            "--inline", sql,
            "--limit", str(limit),
            "--output", "json",
            cwd=project.path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout_bytes, stderr_bytes = await proc.communicate()
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="dbt executable not found")
    except Exception as exc:
        append_project_log(project.path, f"ERROR: dbt show failed: {exc}", project_id)
        raise HTTPException(status_code=500, detail=f"dbt show failed: {exc}")

    stdout = stdout_bytes.decode(errors="replace")
    stderr = stderr_bytes.decode(errors="replace")

    if proc.returncode != 0:
        detail = stderr[-1000:] or stdout[-1000:]
        append_project_log(project.path, f"<<< dbt show --inline FAILED", project_id)
        for line in detail.splitlines():
            if line.strip():
                append_project_log(project.path, line, project_id)
        raise HTTPException(status_code=422, detail=f"dbt show failed:\n{detail}")

    response = _parse_show_output(stdout, stderr, "inline")
    append_project_log(
        project.path,
        f"<<< dbt show --inline OK ({len(response.rows)} rows)",
        project_id,
    )
    return response
