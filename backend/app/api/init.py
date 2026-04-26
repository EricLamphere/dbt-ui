import asyncio
import os
import re
import shlex
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import GlobalProfile, InitStep, Project, ProjectEnvVar
from app.dbt.init_scripts import BASE_STEPS, list_scripts, save_script, delete_script
from app.dbt.venv import venv_dbt, venv_pip, venv_python
from app.dbt.interactive import manager as init_manager
from app.events.bus import Event, bus
from app.events.sse import sse_response
from app.logging_setup import get_logger
from app.logs.project_logger import append_project_log

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["init"])


class InitStepDto(BaseModel):
    id: int | None
    name: str
    order: int
    is_base: bool
    enabled: bool
    script_path: str | None


class InitStepCreateDto(BaseModel):
    name: str
    content: str
    order: int | None = None


class InitReorderDto(BaseModel):
    ordered_names: list[str]


async def _sync_steps_from_disk(
    session: AsyncSession, project: Project
) -> list[InitStep]:
    """Ensure DB has rows for base steps + whatever scripts exist on disk."""
    result = await session.execute(
        select(InitStep).where(InitStep.project_id == project.id).order_by(InitStep.order)
    )
    existing = list(result.scalars().all())
    by_name = {s.name: s for s in existing}

    req_var_result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project.id,
            ProjectEnvVar.key == "REQUIREMENTS_PATH",
        )
    )
    has_project_requirements = req_var_result.scalar_one_or_none() is not None

    order_counter = 0

    def next_order() -> int:
        nonlocal order_counter
        order_counter += 1
        return order_counter - 1

    for base_name, _ in BASE_STEPS:
        if base_name == "base: pip install":
            existing_pip = by_name.get("base: pip install")
            if has_project_requirements:
                if existing_pip is None:
                    session.add(
                        InitStep(
                            project_id=project.id,
                            name=base_name,
                            order=next_order(),
                            is_base=True,
                            enabled=True,
                        )
                    )
                else:
                    next_order()
            else:
                if existing_pip is not None:
                    await session.delete(existing_pip)
                    del by_name["base: pip install"]
            continue

        if base_name not in by_name:
            session.add(
                InitStep(
                    project_id=project.id,
                    name=base_name,
                    order=next_order(),
                    is_base=True,
                    enabled=True,
                )
            )
        else:
            next_order()

    scripts = list_scripts(Path(project.path), project.init_script_path)
    script_names = {f"custom: {s.name}" for s in scripts}
    for s in scripts:
        display = f"custom: {s.name}"
        if display not in by_name:
            session.add(
                InitStep(
                    project_id=project.id,
                    name=display,
                    order=next_order(),
                    is_base=False,
                    enabled=True,
                    script_path=str(s.path),
                )
            )

    init_dir_abs = str(Path(project.path) / project.init_script_path)
    for row in existing:
        if not row.is_base and row.name not in script_names:
            # Only delete if the script lived inside the init dir (not a linked external script)
            script_in_init_dir = row.script_path and row.script_path.startswith(init_dir_abs)
            if script_in_init_dir:
                await session.delete(row)

    await session.commit()
    result = await session.execute(
        select(InitStep).where(InitStep.project_id == project.id).order_by(InitStep.order)
    )
    return list(result.scalars().all())


@router.get("/{project_id}/init/steps", response_model=list[InitStepDto])
async def get_steps(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> list[InitStepDto]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    rows = await _sync_steps_from_disk(session, project)
    return [
        InitStepDto(
            id=r.id,
            name=r.name,
            order=r.order,
            is_base=r.is_base,
            enabled=r.enabled,
            script_path=r.script_path,
        )
        for r in rows
    ]


@router.post("/{project_id}/init/steps", response_model=InitStepDto)
async def post_step(
    project_id: int,
    dto: InitStepCreateDto,
    session: AsyncSession = Depends(get_session),
) -> InitStepDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    script = save_script(Path(project.path), dto.name, dto.content, project.init_script_path)

    display = f"custom: {dto.name}"
    result = await session.execute(
        select(InitStep).where(
            InitStep.project_id == project.id, InitStep.name == display
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        result2 = await session.execute(
            select(InitStep).where(InitStep.project_id == project.id)
        )
        current = list(result2.scalars().all())
        row = InitStep(
            project_id=project.id,
            name=display,
            order=dto.order if dto.order is not None else len(current),
            is_base=False,
            enabled=True,
            script_path=str(script.path),
        )
        session.add(row)
    else:
        row.script_path = str(script.path)
    await session.commit()
    await session.refresh(row)
    return InitStepDto(
        id=row.id,
        name=row.name,
        order=row.order,
        is_base=row.is_base,
        enabled=row.enabled,
        script_path=row.script_path,
    )


@router.delete("/{project_id}/init/steps/{name}")
async def delete_step(
    project_id: int, name: str, session: AsyncSession = Depends(get_session)
) -> dict[str, bool]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    display = f"custom: {name}"
    result = await session.execute(
        select(InitStep).where(
            InitStep.project_id == project.id, InitStep.name == display
        )
    )
    row = result.scalar_one_or_none()
    if row and not row.is_base:
        await session.delete(row)
        await session.commit()
    delete_script(Path(project.path), name, project.init_script_path)
    return {"ok": True}


class InitStepToggleDto(BaseModel):
    enabled: bool


@router.patch("/{project_id}/init/steps/{name}", response_model=InitStepDto)
async def toggle_step(
    project_id: int,
    name: str,
    dto: InitStepToggleDto,
    session: AsyncSession = Depends(get_session),
) -> InitStepDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    # Accept either the bare name or the full display name (with prefix)
    if not name.startswith("base: ") and not name.startswith("custom: "):
        # Try base first, then custom
        result = await session.execute(
            select(InitStep).where(
                InitStep.project_id == project.id,
                InitStep.name.in_([f"base: {name}", f"custom: {name}", name]),
            )
        )
    else:
        result = await session.execute(
            select(InitStep).where(
                InitStep.project_id == project.id, InitStep.name == name
            )
        )
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="step not found")
    row.enabled = dto.enabled
    await session.commit()
    await session.refresh(row)
    return InitStepDto(
        id=row.id, name=row.name, order=row.order,
        is_base=row.is_base, enabled=row.enabled, script_path=row.script_path,
    )


@router.get("/{project_id}/init/steps/{name}/content")
async def get_step_content(
    project_id: int,
    name: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    # Prefer the script_path stored in the DB row (handles linked external scripts)
    display = f"custom: {name}"
    result = await session.execute(
        select(InitStep).where(InitStep.project_id == project_id, InitStep.name == display)
    )
    row = result.scalar_one_or_none()
    if row and row.script_path:
        script_path = Path(row.script_path)
    else:
        script_path = Path(project.path) / project.init_script_path / f"{name}.sh"

    if not script_path.exists():
        raise HTTPException(status_code=404, detail="script not found")
    return {"content": script_path.read_text()}


class InitStepContentDto(BaseModel):
    content: str


@router.put("/{project_id}/init/steps/{name}/content")
async def put_step_content(
    project_id: int,
    name: str,
    dto: InitStepContentDto,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    """Save script content, writing to the file path stored in the DB row."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    display = f"custom: {name}"
    result = await session.execute(
        select(InitStep).where(InitStep.project_id == project_id, InitStep.name == display)
    )
    row = result.scalar_one_or_none()
    if row and row.script_path:
        script_path = Path(row.script_path)
    else:
        script_path = Path(project.path) / project.init_script_path / f"{name}.sh"

    if not script_path.exists():
        raise HTTPException(status_code=404, detail="script not found")
    script_path.write_text(dto.content)
    return {"ok": "true"}


class InitStepLinkDto(BaseModel):
    path: str  # absolute path or path relative to project root


@router.post("/{project_id}/init/steps/link", response_model=InitStepDto)
async def link_step(
    project_id: int,
    dto: InitStepLinkDto,
    session: AsyncSession = Depends(get_session),
) -> InitStepDto:
    """Register an existing .sh file as an init step without copying it.
    Accepts an absolute path or a path relative to the project root."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")

    if dto.path.startswith("/"):
        candidate = Path(dto.path).resolve()
    else:
        root = Path(project.path).resolve()
        candidate = (root / dto.path).resolve()

    if not candidate.exists() or not candidate.is_file():
        raise HTTPException(status_code=400, detail="file not found")
    if candidate.suffix != ".sh":
        raise HTTPException(status_code=400, detail="only .sh files can be linked")

    import stat as _stat
    mode = candidate.stat().st_mode
    candidate.chmod(mode | _stat.S_IXUSR | _stat.S_IXGRP | _stat.S_IXOTH)

    stem = candidate.stem
    display = f"custom: {stem}"
    result = await session.execute(
        select(InitStep).where(InitStep.project_id == project_id, InitStep.name == display)
    )
    row = result.scalar_one_or_none()
    if row is None:
        count_result = await session.execute(
            select(InitStep).where(InitStep.project_id == project_id)
        )
        current = list(count_result.scalars().all())
        row = InitStep(
            project_id=project_id,
            name=display,
            order=len(current),
            is_base=False,
            enabled=True,
            script_path=str(candidate),
        )
        session.add(row)
    else:
        row.script_path = str(candidate)
    await session.commit()
    await session.refresh(row)
    return InitStepDto(
        id=row.id, name=row.name, order=row.order,
        is_base=row.is_base, enabled=row.enabled, script_path=row.script_path,
    )


@router.post("/{project_id}/init/reorder", response_model=list[InitStepDto])
async def reorder(
    project_id: int,
    dto: InitReorderDto,
    session: AsyncSession = Depends(get_session),
) -> list[InitStepDto]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    rows = await _sync_steps_from_disk(session, project)
    by_name = {r.name: r for r in rows}
    for i, name in enumerate(dto.ordered_names):
        if name in by_name:
            by_name[name].order = i
    await session.commit()
    return await get_steps(project_id, session)


# ---- Environment variables ----

class EnvVarDto(BaseModel):
    key: str
    value: str


@router.get("/{project_id}/init/env", response_model=list[EnvVarDto])
async def get_env_vars(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> list[EnvVarDto]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    result = await session.execute(
        select(ProjectEnvVar).where(ProjectEnvVar.project_id == project_id)
    )
    return [EnvVarDto(key=r.key, value=r.value) for r in result.scalars().all()]


@router.put("/{project_id}/init/env/{key}", response_model=EnvVarDto)
async def put_env_var(
    project_id: int,
    key: str,
    dto: EnvVarDto,
    session: AsyncSession = Depends(get_session),
) -> EnvVarDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id, ProjectEnvVar.key == key
        )
    )
    row = result.scalar_one_or_none()
    if row is None:
        row = ProjectEnvVar(project_id=project_id, key=dto.key, value=dto.value)
        session.add(row)
    else:
        row.key = dto.key
        row.value = dto.value
    await session.commit()
    await session.refresh(row)
    return EnvVarDto(key=row.key, value=row.value)


@router.delete("/{project_id}/init/env/{key}")
async def delete_env_var(
    project_id: int,
    key: str,
    session: AsyncSession = Depends(get_session),
) -> dict[str, bool]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    result = await session.execute(
        select(ProjectEnvVar).where(
            ProjectEnvVar.project_id == project_id, ProjectEnvVar.key == key
        )
    )
    row = result.scalar_one_or_none()
    if row is not None:
        await session.delete(row)
        await session.commit()
    return {"ok": True}


@router.post("/{project_id}/open")
async def open_project(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> dict[str, bool]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    rows = await _sync_steps_from_disk(session, project)
    enabled_rows = [r for r in rows if r.enabled]
    asyncio.create_task(_run_init_steps(project_id, project.path, enabled_rows))
    return {"accepted": True}


_ACTIVE_GLOBAL_PROFILE_KEY = "active_global_profile_id"


async def load_project_env(project_id: int) -> dict[str, str]:
    """Build an env dict from the current process env plus project + active-global-profile vars."""
    from app.db.engine import SessionLocal
    from sqlalchemy.orm import selectinload
    env = os.environ.copy()
    async with SessionLocal() as _ev_session:
        ev_result = await _ev_session.execute(
            select(ProjectEnvVar).where(ProjectEnvVar.project_id == project_id)
        )
        for ev in ev_result.scalars().all():
            env[ev.key] = ev.value
        # Apply active global profile vars (overrides project env vars)
        active_id_row = await _ev_session.execute(
            select(ProjectEnvVar).where(
                ProjectEnvVar.project_id == project_id,
                ProjectEnvVar.key == _ACTIVE_GLOBAL_PROFILE_KEY,
            )
        )
        active_id_var = active_id_row.scalar_one_or_none()
        if active_id_var is not None:
            try:
                global_profile_id = int(active_id_var.value)
                gp_result = await _ev_session.execute(
                    select(GlobalProfile)
                    .where(GlobalProfile.id == global_profile_id)
                    .options(selectinload(GlobalProfile.vars))
                )
                gp = gp_result.scalar_one_or_none()
                if gp is not None:
                    for pv in gp.vars:
                        env[pv.key] = pv.value
            except (ValueError, TypeError):
                pass
    return env


async def _run_init_steps(project_id: int, project_path: str, steps: list[InitStep]) -> None:
    topic = f"project:{project_id}"
    await bus.publish(
        Event(
            topic=topic,
            type="init_pipeline_started",
            data={"steps": [s.name for s in steps]},
        )
    )
    append_project_log(project_path, "=== Init pipeline started ===")
    env = await load_project_env(project_id)

    for step in steps:
        await bus.publish(
            Event(
                topic=topic,
                type="init_step",
                data={"name": step.name, "status": "running"},
            )
        )
        append_project_log(project_path, f"--- Step: {step.name} ---")
        started_at = datetime.now(timezone.utc).isoformat()
        try:
            if step.name == "base: pip install":
                global_req = await _get_global_requirements_path()
                project_req = env.get("REQUIREMENTS_PATH")
                log_lines = []
                ok = True
                return_code = 0
                for label, req_path in [("global", global_req), ("project", project_req)]:
                    if not req_path:
                        continue
                    if not Path(req_path).exists():
                        raise FileNotFoundError(f"{label} requirements path '{req_path}' not found")
                    rc, lines = await _exec_and_capture(
                        [str(venv_pip()), "install", "-r", req_path], project_path, env
                    )
                    log_lines.extend(lines)
                    if rc != 0:
                        return_code = rc
                        ok = False
                        break
            elif step.name == "base: dbt deps":
                return_code, log_lines = await _exec_and_capture(
                    [str(venv_dbt()), "deps"], project_path, env
                )
                ok = return_code == 0
            elif step.script_path:
                script_dir = str(Path(step.script_path).parent)
                return_code, log_lines = await _exec_and_capture(
                    ["bash", "-euo", "pipefail", step.script_path], script_dir, env
                )
                ok = return_code == 0
                if ok:
                    new_exports = await _capture_script_exports(step.script_path, script_dir, env)
                    if new_exports:
                        from app.db.engine import SessionLocal
                        async with SessionLocal() as _exp_session:
                            for key, value in new_exports.items():
                                existing = await _exp_session.execute(
                                    select(ProjectEnvVar).where(
                                        ProjectEnvVar.project_id == project_id,
                                        ProjectEnvVar.key == key,
                                    )
                                )
                                row = existing.scalar_one_or_none()
                                if row is None:
                                    _exp_session.add(ProjectEnvVar(project_id=project_id, key=key, value=value))
                                else:
                                    row.value = value
                            await _exp_session.commit()
                        # Merge into the running env so subsequent steps see the new vars
                        env.update(new_exports)
                        append_project_log(
                            project_path,
                            f"[init] captured {len(new_exports)} exported var(s): {', '.join(new_exports.keys())}",
                        )
            else:
                return_code = 0
                log_lines = []
                ok = True
        except Exception as exc:
            ok = False
            return_code = -1
            log_lines = [f"error: {exc}"]

        for line in log_lines:
            append_project_log(project_path, line)
        status_str = "SUCCESS" if ok else f"FAILED (rc={return_code})"
        append_project_log(project_path, f"--- {step.name}: {status_str} ---")

        finished_at = datetime.now(timezone.utc).isoformat()
        await bus.publish(
            Event(
                topic=topic,
                type="init_step",
                data={
                    "name": step.name,
                    "status": "success" if ok else "error",
                    "return_code": return_code,
                    "log": "\n".join(log_lines[-200:]),
                    "started_at": started_at,
                    "finished_at": finished_at,
                },
            )
        )
        if not ok:
            append_project_log(project_path, f"=== Init pipeline finished: FAILED at '{step.name}' ===")
            await bus.publish(
                Event(
                    topic=topic,
                    type="init_pipeline_finished",
                    data={"status": "error", "failed_step": step.name},
                )
            )
            return
    append_project_log(project_path, "=== Init pipeline finished: SUCCESS ===")
    await bus.publish(
        Event(
            topic=topic,
            type="init_pipeline_finished",
            data={"status": "success"},
        )
    )
    # Run dbt compile in the background so the DAG is populated immediately
    from app.api.models import _compile_project
    asyncio.create_task(_compile_project(project_id, project_path))


async def _capture_script_exports(
    script_path: str, cwd: str, env: dict
) -> dict[str, str]:
    """Source the script in a subshell and return any newly exported vars.

    We run: bash -c 'set -a; source SCRIPT; export -p'
    Then parse the `export -p` output and return vars that weren't already
    in the parent env (or whose values changed).  This is the only reliable
    way to capture vars a shell script exports without modifying the scripts.
    """
    cmd = f"set -a; source {shlex.quote(script_path)}; export -p"
    proc = await asyncio.create_subprocess_exec(
        "bash", "-c", cmd,
        cwd=cwd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    assert proc.stdout is not None
    stdout_bytes = await proc.stdout.read()
    await proc.wait()

    exported: dict[str, str] = {}
    # export -p lines look like: declare -x KEY="value" or declare -x KEY
    pattern = re.compile(r'^declare -x ([A-Za-z_][A-Za-z0-9_]*)(?:="(.*)")?$')
    for raw_line in stdout_bytes.decode(errors="replace").splitlines():
        m = pattern.match(raw_line.strip())
        if not m:
            continue
        key, value = m.group(1), m.group(2) or ""
        # Unescape bash escape sequences in the value
        value = value.replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")
        if key not in env or env[key] != value:
            exported[key] = value

    return exported


async def _exec_and_capture(
    args: list[str], cwd: str, env: dict
) -> tuple[int, list[str]]:
    log.info("init_exec", args=args, cwd=cwd)
    proc = await asyncio.create_subprocess_exec(
        *args,
        cwd=cwd,
        env=env,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    assert proc.stdout is not None
    lines: list[str] = []
    while True:
        raw = await proc.stdout.readline()
        if not raw:
            break
        lines.append(raw.decode(errors="replace").rstrip("\n"))
    return_code = await proc.wait()
    return return_code, lines


# --- Interactive dbt init (PTY) ---

# Mapping from UI platform name to the PyPI dbt adapter package
DBT_ADAPTER_PACKAGES: dict[str, str] = {
    "postgres": "dbt-postgres",
    "bigquery": "dbt-bigquery",
    "snowflake": "dbt-snowflake",
    "redshift": "dbt-redshift",
    "duckdb": "dbt-duckdb",
    "spark": "dbt-spark",
    "databricks": "dbt-databricks",
    "trino": "dbt-trino",
    "athena": "dbt-athena-community",
    "clickhouse": "dbt-clickhouse",
}


class InitSessionDto(BaseModel):
    session_id: str


class InitSessionStartDto(BaseModel):
    platform: str
    cwd: str | None = None
    skip_install: bool = False


class InitInputDto(BaseModel):
    data: str




async def _get_global_requirements_path() -> str | None:
    from app.db.engine import SessionLocal
    from app.db.models import AppSetting
    async with SessionLocal() as session:
        row = await session.get(AppSetting, "global_requirements_path")
        if row is not None:
            return row.value.strip() or None
    from app.config import settings
    return str(settings.global_requirements_path) if settings.global_requirements_path else None




async def _pip_install_and_start_pty(
    session_id: str,
    package: str,
    target: Path,
    skip_install: bool = False,
) -> None:
    """Run pip install in the background, stream output to the session topic, then start PTY."""
    from app.events.bus import Event, bus
    from app.dbt.interactive import manager as init_manager

    topic = f"init:{session_id}"
    session = init_manager.get(session_id)
    if session is None:
        return

    def _emit(text: str) -> None:
        """Write text into replay buffer and publish to SSE subscribers."""
        session.replay_buffer.append(text)
        asyncio.get_event_loop().create_task(
            bus.publish(Event(topic=topic, type="init_output", data={"data": text}))
        )

    if skip_install:
        proc = await asyncio.create_subprocess_exec(
            str(venv_python()), "-m", "pip", "show", package,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        stdout, _ = await proc.communicate()
        version = None
        for line in stdout.decode().splitlines():
            if line.startswith("Version:"):
                version = line.split(":", 1)[1].strip()
                break
        version_str = f" {version}" if version else ""
        _emit(f"\r\n\x1b[32mUsing installed {package}{version_str}.\x1b[0m\r\n\r\n")
    else:
        _emit(f"\r\n\x1b[1;34mInstalling {package}…\x1b[0m\r\n")

        proc = await asyncio.create_subprocess_exec(
            str(venv_python()), "-m", "pip", "install", "--progress-bar", "off", package,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        assert proc.stdout is not None
        while True:
            chunk = await proc.stdout.read(512)
            if not chunk:
                break
            _emit(chunk.decode(errors="replace").replace("\n", "\r\n"))
        rc = await proc.wait()

        if rc != 0:
            _emit(f"\r\n\x1b[31mpip install failed (exit {rc}). Cannot continue.\x1b[0m\r\n")
            session.finished = True
            session.return_code = rc
            await bus.publish(Event(topic=topic, type="init_finished", data={"return_code": rc}))
            return

        _emit(f"\r\n\x1b[32m{package} installed.\x1b[0m\r\n\r\n")

    await init_manager.start_pty(session, args=(str(venv_dbt()), "init"))


@router.post("/init-session/start", response_model=InitSessionDto)
async def start_init_session(
    dto: InitSessionStartDto,
    session: AsyncSession = Depends(get_session),
) -> InitSessionDto:
    from app.projects.service import _effective_workspace

    platform = dto.platform.lower().strip()
    package = DBT_ADAPTER_PACKAGES.get(platform)
    if package is None:
        raise HTTPException(
            status_code=422,
            detail=f"unsupported platform '{platform}'. Supported: {', '.join(DBT_ADAPTER_PACKAGES)}",
        )

    if dto.cwd:
        target = Path(dto.cwd)
    else:
        target = await _effective_workspace(session)
        if target is None:
            raise HTTPException(
                status_code=400,
                detail="DBT_PROJECTS_PATH is not configured. Set it in Global Settings before creating a project.",
            )

    target.mkdir(parents=True, exist_ok=True)

    # Create a shell session immediately so the frontend gets a session_id and can subscribe to SSE.
    # The pip install + PTY start happens in the background.
    session = await init_manager.create_pending(target)
    asyncio.create_task(_pip_install_and_start_pty(session.session_id, package, target, skip_install=dto.skip_install))
    return InitSessionDto(session_id=session.session_id)


@router.post("/init-session/{session_id}/input")
async def send_init_input(session_id: str, dto: InitInputDto) -> dict[str, bool]:
    try:
        await init_manager.send_input(session_id, dto.data)
    except KeyError:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@router.post("/init-session/{session_id}/stop")
async def stop_init_session(session_id: str) -> dict[str, bool]:
    await init_manager.stop(session_id)
    return {"ok": True}


@router.get("/init-session/{session_id}/events")
async def init_session_events(session_id: str):
    from app.events.sse import sse_response_with_replay
    session = init_manager.get(session_id)
    replay = list(session.replay_buffer) if session else []
    finished = session.finished if session else False
    return_code = session.return_code if session else None
    return sse_response_with_replay(
        f"init:{session_id}",
        replay_chunks=replay,
        already_finished=finished,
        return_code=return_code,
    )


# --- Global init endpoints (not project-scoped) ---

global_router = APIRouter(prefix="/api/init", tags=["init"])


class PackageInfoDto(BaseModel):
    package: str
    installed_version: str | None


class DbtCoreStatusDto(BaseModel):
    installed: bool
    version: str | None


class AppendRequirementDto(BaseModel):
    line: str


@global_router.get("/package-info", response_model=PackageInfoDto)
async def get_package_info(package: str) -> PackageInfoDto:
    """Check if a package is installed in dbt's Python environment."""
    python = venv_python()
    proc = await asyncio.create_subprocess_exec(
        str(python), "-m", "pip", "show", package,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    stdout, _ = await proc.communicate()
    if proc.returncode != 0:
        return PackageInfoDto(package=package, installed_version=None)
    for line in stdout.decode().splitlines():
        if line.startswith("Version:"):
            return PackageInfoDto(package=package, installed_version=line.split(":", 1)[1].strip())
    return PackageInfoDto(package=package, installed_version=None)


@global_router.get("/dbt-core-status", response_model=DbtCoreStatusDto)
async def get_dbt_core_status() -> DbtCoreStatusDto:
    """Check if dbt binary is available in the backend venv and return its version."""
    try:
        dbt = str(venv_dbt())
    except RuntimeError:
        return DbtCoreStatusDto(installed=False, version=None)
    proc = await asyncio.create_subprocess_exec(
        dbt, "--version",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    stdout, _ = await proc.communicate()
    text = stdout.decode(errors="replace")
    m = re.search(r'dbt[- ](?:Core\s+|core\s+)?(\d+\.\d+[\.\d]*)', text, re.IGNORECASE)
    version = m.group(1) if m else None
    return DbtCoreStatusDto(installed=True, version=version)


@global_router.post("/append-requirement")
async def append_requirement(dto: AppendRequirementDto) -> dict[str, bool]:
    """Append a line to the global requirements file."""
    path_str = await _get_global_requirements_path()
    if not path_str:
        raise HTTPException(status_code=400, detail="DBT_UI_GLOBAL_REQUIREMENTS_PATH is not configured")
    req_path = Path(path_str)
    if not req_path.exists():
        raise HTTPException(status_code=404, detail=f"Requirements file not found: {path_str}")
    with req_path.open("a") as f:
        f.write(f"\n{dto.line.strip()}\n")
    return {"ok": True}


_global_setup_task: asyncio.Task | None = None
_global_setup_proc: asyncio.subprocess.Process | None = None


async def _run_global_pip_install(req_path: Path) -> None:
    global _global_setup_proc
    topic = "global-setup"
    await bus.publish(Event(topic=topic, type="global_setup_started", data={}))
    try:
        pip = venv_pip()
    except RuntimeError as exc:
        await bus.publish(Event(topic=topic, type="global_setup_output", data={"data": f"Error: {exc}\r\n"}))
        await bus.publish(Event(topic=topic, type="global_setup_finished", data={"return_code": 1}))
        return
    proc = await asyncio.create_subprocess_exec(
        str(pip), "install", "-r", str(req_path), "--progress-bar", "off",
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    _global_setup_proc = proc
    assert proc.stdout is not None

    async def _drain_stdout() -> None:
        """Read stdout continuously so the pipe never fills and blocks pip."""
        while True:
            chunk = await proc.stdout.read(4096)
            if not chunk:
                break
            await bus.publish(Event(
                topic=topic,
                type="global_setup_output",
                data={"data": chunk.decode(errors="replace")},
            ))

    drain_task = asyncio.create_task(_drain_stdout())
    try:
        await asyncio.shield(drain_task)
    except asyncio.CancelledError:
        drain_task.cancel()
        proc.kill()
        await proc.wait()
        await bus.publish(Event(topic=topic, type="global_setup_finished", data={"return_code": -1}))
        return
    finally:
        _global_setup_proc = None

    rc = await proc.wait()
    await bus.publish(Event(topic=topic, type="global_setup_finished", data={"return_code": rc}))


@global_router.post("/global-setup")
async def run_global_setup() -> dict[str, bool]:
    """Install global requirements.txt into the backend venv."""
    global _global_setup_task
    path_str = await _get_global_requirements_path()
    if not path_str:
        raise HTTPException(status_code=400, detail="DBT_UI_GLOBAL_REQUIREMENTS_PATH is not configured")
    req_path = Path(path_str)
    if not req_path.exists():
        raise HTTPException(status_code=404, detail=f"Requirements file not found: {path_str}")
    if _global_setup_task and not _global_setup_task.done():
        _global_setup_task.cancel()
    _global_setup_task = asyncio.create_task(_run_global_pip_install(req_path))
    return {"ok": True}


@global_router.post("/global-setup/cancel")
async def cancel_global_setup() -> dict[str, bool]:
    """Cancel a running global pip install."""
    global _global_setup_task, _global_setup_proc
    if _global_setup_proc is not None:
        try:
            _global_setup_proc.kill()
        except ProcessLookupError:
            pass
    if _global_setup_task and not _global_setup_task.done():
        _global_setup_task.cancel()
    return {"ok": True}


@global_router.get("/global-setup/events")
async def global_setup_events():
    return sse_response("global-setup")
