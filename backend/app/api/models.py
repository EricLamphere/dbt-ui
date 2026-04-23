import asyncio
import json
import re
import sys
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import ModelStatus, Project
from app.dbt.manifest import Manifest, ModelNode, load_manifest

router = APIRouter(prefix="/api/projects", tags=["models"])


class NewModelDto(BaseModel):
    name: str
    sql: str = ""


class NewModelResponseDto(BaseModel):
    name: str
    path: str


class ModelDto(BaseModel):
    unique_id: str
    name: str
    resource_type: str
    schema_: str | None = None
    database: str | None = None
    materialized: str | None = None
    tags: list[str] = []
    description: str = ""
    original_file_path: str | None = None
    status: str = "idle"
    message: str | None = None

    model_config = ConfigDict(populate_by_name=True)


class EdgeDto(BaseModel):
    source: str
    target: str


class GraphDto(BaseModel):
    nodes: list[ModelDto]
    edges: list[EdgeDto]


def _node_to_dto(node: ModelNode, status: ModelStatus | None) -> ModelDto:
    return ModelDto(
        unique_id=node.unique_id,
        name=node.name,
        resource_type=node.resource_type,
        schema_=node.schema_,
        database=node.database,
        materialized=node.materialized,
        tags=list(node.tags),
        description=node.description,
        original_file_path=node.original_file_path,
        status=status.status if status else "idle",
        message=status.message if status else None,
    )


async def _load_statuses(session: AsyncSession, project_id: int) -> dict[str, ModelStatus]:
    result = await session.execute(
        select(ModelStatus).where(ModelStatus.project_id == project_id)
    )
    return {row.unique_id: row for row in result.scalars().all()}


@router.get("/{project_id}/models", response_model=GraphDto)
async def get_models(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> GraphDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    manifest: Manifest | None = load_manifest(Path(project.path) / "target" / "manifest.json")
    if manifest is None:
        return GraphDto(nodes=[], edges=[])

    statuses = await _load_statuses(session, project_id)
    nodes = [_node_to_dto(n, statuses.get(n.unique_id)) for n in manifest.nodes]
    edges = [EdgeDto(source=s, target=t) for s, t in manifest.edges()]
    return GraphDto(nodes=nodes, edges=edges)


@router.get("/{project_id}/models/{unique_id}", response_model=ModelDto)
async def get_model(
    project_id: int,
    unique_id: str,
    session: AsyncSession = Depends(get_session),
) -> ModelDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    manifest = load_manifest(Path(project.path) / "target" / "manifest.json")
    if manifest is None:
        raise HTTPException(status_code=404, detail="manifest not found")
    node = next((n for n in manifest.nodes if n.unique_id == unique_id), None)
    if node is None:
        raise HTTPException(status_code=404, detail="model not found")
    statuses = await _load_statuses(session, project_id)
    return _node_to_dto(node, statuses.get(unique_id))


@router.post("/{project_id}/models", response_model=NewModelResponseDto, status_code=201)
async def create_model(
    project_id: int,
    dto: NewModelDto,
    session: AsyncSession = Depends(get_session),
) -> NewModelResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    name = dto.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="model name cannot be empty")
    # Each path segment may only contain safe characters; no leading/trailing slashes
    if not re.fullmatch(r"[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*", name):
        raise HTTPException(
            status_code=422,
            detail="model name may only contain letters, digits, underscores, and hyphens; use / to specify subdirectories",
        )

    models_dir = Path(project.path) / "models"
    model_file = models_dir / f"{name}.sql"
    # Ensure the resolved path stays within the project's models directory (path traversal guard)
    try:
        model_file.resolve().relative_to(models_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=422, detail="invalid model path")
    model_file.parent.mkdir(parents=True, exist_ok=True)
    if model_file.exists():
        raise HTTPException(status_code=409, detail=f"model '{name}' already exists")

    content = dto.sql if dto.sql.strip() else f"-- {name}\nselect\n    1 as id\n"
    model_file.write_text(content, encoding="utf-8")

    # Run dbt compile in the background so the manifest updates and the new
    # model node appears in the DAG immediately after the frontend invalidates.
    asyncio.create_task(_compile_project(project_id, project.path))

    return NewModelResponseDto(name=name, path=str(model_file))


@router.delete("/{project_id}/models/{unique_id}", status_code=204)
async def delete_model(
    project_id: int,
    unique_id: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    manifest = load_manifest(Path(project.path) / "target" / "manifest.json")
    if manifest is None:
        raise HTTPException(status_code=404, detail="manifest not found")
    node = next((n for n in manifest.nodes if n.unique_id == unique_id), None)
    if node is None:
        raise HTTPException(status_code=404, detail="model not found")
    if node.original_file_path is None:
        raise HTTPException(status_code=400, detail="model has no file path")

    model_file = Path(project.path) / node.original_file_path
    if model_file.exists():
        model_file.unlink()

    # Remove status rows
    result = await session.execute(
        select(ModelStatus).where(
            ModelStatus.project_id == project_id,
            ModelStatus.unique_id == unique_id,
        )
    )
    for row in result.scalars().all():
        await session.delete(row)
    await session.commit()

    asyncio.create_task(_compile_project(project_id, project.path))


@router.post("/{project_id}/compile", status_code=202)
async def compile_project(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    asyncio.create_task(_compile_project(project_id, project.path))
    return {"status": "started"}


class ShowRequestDto(BaseModel):
    limit: int = 1000


class ShowResponseDto(BaseModel):
    columns: list[str]
    rows: list[list]


@router.get("/{project_id}/models/{unique_id}/compiled")
async def get_compiled(
    project_id: int,
    unique_id: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    manifest = load_manifest(Path(project.path) / "target" / "manifest.json")
    if manifest is not None:
        node = next((n for n in manifest.nodes if n.unique_id == unique_id), None)
        if node and node.compiled_sql:
            return {"compiled_sql": node.compiled_sql}

    # Not in manifest — run dbt compile for just this node, then re-read
    # unique_id format is "model.project_name.model_name"; --select expects just the name
    model_name = unique_id.split(".")[-1]
    from app.dbt.venv import venv_dbt
    from app.api.init import load_project_env
    env = await load_project_env(project_id)
    try:
        proc = await asyncio.create_subprocess_exec(
            str(venv_dbt()), "compile", "--select", model_name,
            cwd=project.path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        stdout_bytes, _ = await proc.communicate()
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"dbt compile failed: {exc}")

    if proc.returncode != 0:
        err = stdout_bytes.decode(errors="replace")[-1000:]
        raise HTTPException(status_code=422, detail=f"dbt compile failed:\n{err}")

    manifest2 = load_manifest(Path(project.path) / "target" / "manifest.json")
    if manifest2 is not None:
        node2 = next((n for n in manifest2.nodes if n.unique_id == unique_id), None)
        if node2 and node2.compiled_sql:
            return {"compiled_sql": node2.compiled_sql}

    raise HTTPException(status_code=404, detail="compiled SQL not available")


@router.post("/{project_id}/models/{unique_id}/show", response_model=ShowResponseDto)
async def show_model(
    project_id: int,
    unique_id: str,
    dto: ShowRequestDto,
    session: AsyncSession = Depends(get_session),
) -> ShowResponseDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    # unique_id format is "model.project_name.model_name"; --select expects just the name
    model_name = unique_id.split(".")[-1]
    from app.dbt.venv import venv_dbt
    limit = max(1, min(dto.limit, 5000))
    from app.api.init import load_project_env
    env = await load_project_env(project_id)
    try:
        proc = await asyncio.create_subprocess_exec(
            str(venv_dbt()), "show", "--select", model_name,
            "--limit", str(limit),
            "--output", "json",
            cwd=project.path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        stdout_bytes, stderr_bytes = await proc.communicate()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"dbt show failed: {exc}")

    stdout = stdout_bytes.decode(errors="replace")
    stderr = stderr_bytes.decode(errors="replace")

    if proc.returncode != 0:
        detail = stderr[-1000:] or stdout[-1000:]
        raise HTTPException(status_code=422, detail=f"dbt show failed:\n{detail}")

    # Strip ANSI escape codes — dbt colorizes output even with --output json
    _ansi_re = re.compile(r"\x1b\[[0-9;]*m")
    clean_stdout = _ansi_re.sub("", stdout)

    # dbt show --output json may emit a multi-line JSON object mixed with log lines.
    # Collect all lines that are part of a JSON block and try to parse them together,
    # then fall back to trying each line individually.
    json_candidates: list[str] = []
    buffer: list[str] = []
    depth = 0
    for line in clean_stdout.splitlines():
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

        # Format 1: dbt >=1.5 structured output — {"results": [{"table": {...}}]}
        results = parsed.get("results") or []
        if results:
            result = results[0]
            table = result.get("table") or result.get("agate_table") or {}
            columns: list[str] = table.get("column_names") or []
            rows: list[list] = table.get("rows") or []
            return ShowResponseDto(columns=columns, rows=rows)

        # Format 2: dbt 1.11+ compact output — {"node": "...", "show": [{col: val}, ...]}
        show_rows = parsed.get("show")
        if isinstance(show_rows, list) and show_rows:
            columns = list(show_rows[0].keys())
            rows = [[row.get(c) for c in columns] for row in show_rows]
            return ShowResponseDto(columns=columns, rows=rows)

    # Nothing parseable found — surface raw output for diagnosis
    detail_lines = (stdout + "\n" + stderr).strip()[-1000:]
    raise HTTPException(status_code=422, detail=f"Could not parse dbt show output:\n{detail_lines}")


async def _compile_project(project_id: int, project_path: str) -> None:
    from app.events.bus import Event, bus
    from app.api.init import load_project_env
    from app.dbt.runner import RunRequest, runner

    topic = f"project:{project_id}"
    env = await load_project_env(project_id)
    await bus.publish(Event(topic=topic, type="compile_started", data={}))
    ok = False
    try:
        req = RunRequest(
            project_id=project_id,
            project_path=Path(project_path),
            command="compile",
            env=env,
        )
        async for _kind, _line in runner.stream(req):
            pass
        ok = True
    except Exception:
        pass
    await bus.publish(Event(topic=topic, type="compile_finished", data={"ok": ok}))
    if ok:
        await bus.publish(Event(topic=topic, type="graph_changed", data={}))
