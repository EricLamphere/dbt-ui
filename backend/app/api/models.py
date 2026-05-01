import asyncio
import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import ModelStatus, Project
from app.dbt.manifest import Manifest, ModelNode, load_manifest
from app.dbt.column_lineage import build_column_lineage, ColumnRef
from app.logs.project_logger import append_project_log

# Column lineage is CPU-bound (sqlglot parsing). A dedicated single-threaded
# executor serializes concurrent requests and prevents starving the default pool.
_lineage_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="col-lineage")

router = APIRouter(prefix="/api/projects", tags=["models"])


class NewModelDto(BaseModel):
    name: str
    sql: str = ""


class NewModelResponseDto(BaseModel):
    name: str
    path: str


class ColumnDto(BaseModel):
    name: str
    description: str = ""
    data_type: str = ""


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
    source_name: str | None = None
    status: str = "idle"
    message: str | None = None
    columns: list[ColumnDto] = []

    model_config = ConfigDict(populate_by_name=True)


class ColumnLineageEntryDto(BaseModel):
    node: str
    column: str


class ColumnLineageDto(BaseModel):
    lineage: dict[str, dict[str, list[ColumnLineageEntryDto]]]


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
        source_name=node.source_name,
        status=status.status if status else "idle",
        message=status.message if status else None,
        columns=[
            ColumnDto(name=c.name, description=c.description, data_type=c.data_type)
            for c in node.columns
        ],
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

    loop = asyncio.get_event_loop()
    manifest_path = Path(project.path) / "target" / "manifest.json"
    manifest: Manifest | None = await loop.run_in_executor(None, load_manifest, manifest_path)
    if manifest is None:
        return GraphDto(nodes=[], edges=[])

    statuses = await _load_statuses(session, project_id)
    nodes = [_node_to_dto(n, statuses.get(n.unique_id)) for n in manifest.nodes]
    edges = [EdgeDto(source=s, target=t) for s, t in manifest.edges()]
    return GraphDto(nodes=nodes, edges=edges)


@router.get("/{project_id}/column-lineage", response_model=ColumnLineageDto)
async def get_column_lineage(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> ColumnLineageDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    manifest_path = Path(project.path) / "target" / "manifest.json"
    loop = asyncio.get_event_loop()
    raw = await loop.run_in_executor(_lineage_executor, build_column_lineage, manifest_path)

    lineage: dict[str, dict[str, list[ColumnLineageEntryDto]]] = {
        uid: {
            col: [ColumnLineageEntryDto(node=ref.node, column=ref.column) for ref in refs]
            for col, refs in col_map.items()
        }
        for uid, col_map in raw.items()
    }
    return ColumnLineageDto(lineage=lineage)


@router.get("/{project_id}/models/{unique_id}", response_model=ModelDto)
async def get_model(
    project_id: int,
    unique_id: str,
    session: AsyncSession = Depends(get_session),
) -> ModelDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    loop = asyncio.get_event_loop()
    manifest = await loop.run_in_executor(None, load_manifest, Path(project.path) / "target" / "manifest.json")
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
    loop = asyncio.get_event_loop()
    manifest = await loop.run_in_executor(None, load_manifest, Path(project.path) / "target" / "manifest.json")
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
    force: bool = False,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    if not force:
        loop = asyncio.get_event_loop()
        manifest = await loop.run_in_executor(None, load_manifest, Path(project.path) / "target" / "manifest.json")
        if manifest is not None:
            node = next((n for n in manifest.nodes if n.unique_id == unique_id), None)
            if node and node.compiled_sql:
                return {"compiled_sql": node.compiled_sql}

    # Not in manifest, or force-recompile requested — run dbt compile for just this node
    # unique_id format is "model.project_name.model_name"; --select expects just the name
    model_name = unique_id.split(".")[-1]
    from app.dbt.venv import venv_dbt
    from app.api.init import load_project_env
    env = await load_project_env(project_id)
    append_project_log(project.path, f">>> dbt compile --select {model_name}", project_id)
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
        append_project_log(project.path, f"ERROR: dbt compile failed: {exc}", project_id)
        raise HTTPException(status_code=422, detail=f"dbt compile failed: {exc}")

    stdout_str = stdout_bytes.decode(errors="replace")
    for line in stdout_str.splitlines():
        if line.strip():
            append_project_log(project.path, line, project_id)

    if proc.returncode != 0:
        append_project_log(project.path, f"<<< dbt compile --select {model_name} FAILED", project_id)
        raise HTTPException(status_code=422, detail=f"dbt compile failed:\n{stdout_str[-1000:]}")
    append_project_log(project.path, f"<<< dbt compile --select {model_name} OK", project_id)

    loop = asyncio.get_event_loop()
    manifest2 = await loop.run_in_executor(None, load_manifest, Path(project.path) / "target" / "manifest.json")
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

    # unique_id format: "model.<project>.<name>" or "test.<project>.<name>.<hash>"
    # Tests have a trailing hash segment; use the second-to-last part for those.
    parts = unique_id.split(".")
    resource_type = parts[0] if parts else ""
    model_name = parts[-2] if resource_type == "test" and len(parts) >= 4 else parts[-1]
    from app.dbt.venv import venv_dbt
    limit = max(1, min(dto.limit, 5000))
    from app.api.init import load_project_env
    env = await load_project_env(project_id)
    append_project_log(project.path, f">>> dbt show --select {model_name} --limit {limit}", project_id)
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
        append_project_log(project.path, f"ERROR: dbt show failed: {exc}", project_id)
        raise HTTPException(status_code=500, detail=f"dbt show failed: {exc}")

    stdout = stdout_bytes.decode(errors="replace")
    stderr = stderr_bytes.decode(errors="replace")

    if proc.returncode != 0:
        detail = stderr[-1000:] or stdout[-1000:]
        append_project_log(project.path, f"<<< dbt show --select {model_name} FAILED", project_id)
        for line in detail.splitlines():
            if line.strip():
                append_project_log(project.path, line, project_id)
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
            append_project_log(project.path, f"<<< dbt show --select {model_name} OK ({len(rows)} rows)", project_id)
            return ShowResponseDto(columns=columns, rows=rows)

        # Format 2: dbt 1.11+ compact output — {"node": "...", "show": [{col: val}, ...]}
        show_rows = parsed.get("show")
        if isinstance(show_rows, list) and show_rows:
            columns = list(show_rows[0].keys())
            rows = [[row.get(c) for c in columns] for row in show_rows]
            append_project_log(project.path, f"<<< dbt show --select {model_name} OK ({len(rows)} rows)", project_id)
            return ShowResponseDto(columns=columns, rows=rows)

    # Nothing parseable found — surface raw output for diagnosis
    detail_lines = (stdout + "\n" + stderr).strip()[-1000:]
    append_project_log(project.path, f"<<< dbt show --select {model_name} FAILED (could not parse output)", project_id)
    raise HTTPException(status_code=422, detail=f"Could not parse dbt show output:\n{detail_lines}")


async def _compile_project(project_id: int, project_path: str) -> None:
    from app.events.bus import Event, bus
    from app.api.init import load_project_env
    from app.dbt.venv import venv_dbt

    topic = f"project:{project_id}"
    env = await load_project_env(project_id)
    dbt = str(venv_dbt())
    project = Path(project_path)
    profiles_args = ["--profiles-dir", project_path] if (project / "profiles.yml").exists() else []

    await bus.publish(Event(topic=topic, type="compile_started", data={}))
    append_project_log(project_path, ">>> dbt compile", project_id)
    ok = False
    try:
        proc = await asyncio.create_subprocess_exec(
            dbt, "compile", *profiles_args,
            cwd=project_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        assert proc.stdout is not None
        async for raw in proc.stdout:
            append_project_log(project_path, raw.decode(errors="replace").rstrip("\n"), project_id)
        rc = await proc.wait()
        ok = rc == 0
    except Exception:
        pass
    append_project_log(project_path, f"<<< dbt compile {'OK' if ok else 'FAILED'}", project_id)
    await bus.publish(Event(topic=topic, type="compile_finished", data={"ok": ok}))
    if ok:
        await bus.publish(Event(topic=topic, type="graph_changed", data={}))
