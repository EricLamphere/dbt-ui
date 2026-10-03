"""
Tests for POST /api/projects/{id}/command (arbitrary dbt commands) and the
custom-command branch of POST /api/projects/{id}/run-history/{inv}/rerun.

The background invocation (`_run_invocation` in api/runs.py) opens sessions
via `SessionLocal` directly rather than through FastAPI DI, so — as in
test_api_column_lineage.py — the `db` fixture points both DI and the
module-level SessionLocal references at the same temp-file SQLite DB.
"""
import asyncio
import json
import os
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.api.runs as runs_module
import app.db.engine as db_engine
from app.db.engine import get_session
from app.db.models import Base, ModelStatus, Project, ProjectEnvVar, RunInvocation
from app.dbt.runner import RunRequest, runner
from app.events.bus import bus
from app.main import app


@pytest.fixture
async def db(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'test.sqlite'}", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _get_session():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_session] = _get_session
    monkeypatch.setattr(db_engine, "SessionLocal", session_factory)
    monkeypatch.setattr(runs_module, "SessionLocal", session_factory)
    yield session_factory
    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def project(db, tmp_path: Path) -> Project:
    project_dir = tmp_path / "proj"
    (project_dir / "target").mkdir(parents=True)
    async with db() as session:
        proj = Project(name="proj", path=str(project_dir), platform="duckdb")
        session.add(proj)
        await session.commit()
        await session.refresh(proj)
        return proj


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> list[RunRequest]:
    """Replace runner.stream with a fake that records each RunRequest."""
    reqs: list[RunRequest] = []

    async def _fake_stream(req: RunRequest):
        reqs.append(req)
        yield ("stdout", "hello from fake dbt")

    monkeypatch.setattr(runner, "stream", _fake_stream)
    monkeypatch.setattr(runner, "pop_return_code", lambda _pid: 0)
    return reqs


async def _post_and_wait(client: AsyncClient, project_id: int, path: str, body: dict) -> dict:
    """POST, then wait for the background invocation to publish run_history_changed."""
    queue = await bus.subscribe(f"project:{project_id}")
    try:
        resp = await client.post(f"/api/projects/{project_id}{path}", json=body)
        assert resp.status_code == 200, resp.text
        while True:
            event = await asyncio.wait_for(queue.get(), timeout=5.0)
            if event.type == "run_history_changed":
                return resp.json()
    finally:
        await bus.unsubscribe(f"project:{project_id}", queue)


async def _only_invocation(db) -> RunInvocation:
    async with db() as session:
        rows = (await session.execute(select(RunInvocation))).scalars().all()
    assert len(rows) == 1
    return rows[0]


async def test_404_for_unknown_project(db, client: AsyncClient) -> None:
    resp = await client.post("/api/projects/999/command", json={"command": "ls"})
    assert resp.status_code == 404


@pytest.mark.parametrize("command", ["", "init", "docs serve", "--debug run", "run --vars '{"])
async def test_400_for_invalid_command(
    client: AsyncClient, project: Project, captured: list[RunRequest], command: str
) -> None:
    resp = await client.post(f"/api/projects/{project.id}/command", json={"command": command})
    assert resp.status_code == 400
    assert resp.json()["detail"]
    assert captured == []


async def test_runs_command_and_records_invocation(
    db, client: AsyncClient, project: Project, captured: list[RunRequest]
) -> None:
    body = await _post_and_wait(client, project.id, "/command", {"command": "dbt ls -s +orders"})
    assert body == {"accepted": True, "command": "ls", "select": "+orders"}

    [req] = captured
    assert req.command == "ls"
    assert req.select is None
    assert req.extra == ("-s", "+orders")
    assert req.inject_profiles_dir is True

    inv = await _only_invocation(db)
    assert inv.command == "ls"
    assert inv.selector == "+orders"
    assert inv.cli_command == "dbt ls -s +orders"
    assert json.loads(inv.custom_args) == ["ls", "-s", "+orders"]
    # ls writes no run_results.json → status falls back to the exit code
    assert inv.status == "success"
    log_lines = Path(inv.log_path).read_text().splitlines()
    assert log_lines == ["hello from fake dbt"]


async def test_injects_active_target(
    db, client: AsyncClient, project: Project, captured: list[RunRequest]
) -> None:
    async with db() as session:
        session.add(ProjectEnvVar(project_id=project.id, key="dbt_target", value="prod"))
        await session.commit()

    await _post_and_wait(client, project.id, "/command", {"command": "compile"})

    assert captured[0].extra == ("--target", "prod")
    inv = await _only_invocation(db)
    assert inv.target == "prod"
    assert inv.cli_command == "dbt compile --target prod"
    assert json.loads(inv.custom_args) == ["compile"]


async def test_user_target_and_profiles_dir_win(
    db, client: AsyncClient, project: Project, captured: list[RunRequest]
) -> None:
    async with db() as session:
        session.add(ProjectEnvVar(project_id=project.id, key="dbt_target", value="prod"))
        await session.commit()

    await _post_and_wait(
        client, project.id, "/command", {"command": "run -t dev --profiles-dir /elsewhere"}
    )

    req = captured[0]
    assert req.extra == ("-t", "dev", "--profiles-dir", "/elsewhere")
    assert req.inject_profiles_dir is False
    assert (await _only_invocation(db)).target == "dev"


async def test_nonzero_exit_without_results_is_error(
    db, client: AsyncClient, project: Project, captured: list[RunRequest], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(runner, "pop_return_code", lambda _pid: 2)
    await _post_and_wait(client, project.id, "/command", {"command": "parse"})
    assert (await _only_invocation(db)).status == "error"


async def test_stale_run_results_are_not_persisted(
    db, client: AsyncClient, project: Project, captured: list[RunRequest]
) -> None:
    """A command that doesn't rewrite run_results.json (e.g. ls) must not
    re-persist the previous run's results as if they were its own."""
    results_path = Path(project.path) / "target" / "run_results.json"
    results_path.write_text(json.dumps({
        "results": [{"unique_id": "model.proj.orders", "status": "error",
                     "message": "old failure", "execution_time": 1.0}],
    }))
    old = results_path.stat().st_mtime - 60
    os.utime(results_path, (old, old))

    await _post_and_wait(client, project.id, "/command", {"command": "ls"})

    async with db() as session:
        statuses = (await session.execute(select(ModelStatus))).scalars().all()
    assert statuses == []
    assert (await _only_invocation(db)).status == "success"


async def test_fresh_run_results_are_persisted(
    db, client: AsyncClient, project: Project, monkeypatch: pytest.MonkeyPatch
) -> None:
    results_path = Path(project.path) / "target" / "run_results.json"

    async def _fake_stream(req: RunRequest):
        results_path.write_text(json.dumps({
            "results": [{"unique_id": "model.proj.orders", "status": "success",
                         "message": "OK", "execution_time": 0.5}],
        }))
        yield ("stdout", "1 of 1 OK")

    monkeypatch.setattr(runner, "stream", _fake_stream)
    monkeypatch.setattr(runner, "pop_return_code", lambda _pid: 0)

    await _post_and_wait(client, project.id, "/command", {"command": "run -s orders"})

    async with db() as session:
        [status] = (await session.execute(select(ModelStatus))).scalars().all()
    assert status.unique_id == "model.proj.orders"
    assert status.status == "success"
    assert (await _only_invocation(db)).status == "success"


async def test_rerun_replays_custom_args(
    db, client: AsyncClient, project: Project, captured: list[RunRequest]
) -> None:
    await _post_and_wait(client, project.id, "/command", {"command": "build -s orders --full-refresh"})
    inv = await _only_invocation(db)

    body = await _post_and_wait(client, project.id, f"/run-history/{inv.id}/rerun", {})

    assert body["command"] == "build"
    assert captured[1].command == "build"
    assert captured[1].extra == ("-s", "orders", "--full-refresh")
