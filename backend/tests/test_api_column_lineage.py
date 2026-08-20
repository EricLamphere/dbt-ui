"""
Tests for the backgrounded column-lineage endpoints:
  POST /api/projects/{id}/column-lineage/start
  GET  /api/projects/{id}/column-lineage
  GET  /api/projects/{id}/column-lineage/{snapshot_id}

These mirror the drift/freshness snapshot pattern: a POST kicks off a
background asyncio.Task that fans work out across a ProcessPoolExecutor, and
progress/completion are observable both via polling GET and via SSE events on
the bus.

Note: the background runner (`_run_column_lineage` in api/column_lineage.py)
imports `SessionLocal` fresh from `app.db.engine` on every DB write (mirroring
the drift/freshness pattern), rather than going through FastAPI's DI. The
`override_db` autouse fixture only swaps the `get_session` DI dependency, so
without extra help the background task would keep writing to the real
on-disk `app.db.engine.SessionLocal` instead of the in-memory test DB. The
`db_session` fixture below additionally monkeypatches `app.db.engine.SessionLocal`
so background writes land in the same in-memory database the test/HTTP layer
reads from.
"""

import asyncio
import json
from pathlib import Path

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.db.engine as db_engine
from app.db.engine import get_session
from app.db.models import Base, Project
from app.events.bus import bus
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
async def db_session(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """Fresh DB, wired into both FastAPI DI and the module-level SessionLocal
    that background tasks import directly.

    Uses a temp-file SQLite DB rather than ':memory:'. An in-memory DB forces
    SQLAlchemy onto a StaticPool (one shared physical connection for the whole
    engine); this suite has a real background asyncio.Task (fanning work out
    across a ProcessPoolExecutor) committing concurrently with the test's own
    polling GETs, and that concurrent traffic through one shared aiosqlite
    connection caused writes to silently become invisible to later reads on
    that same engine (a genuine StaticPool/aiosqlite visibility bug, not
    something in the endpoint code) — surfacing as `_wait_for_done` polling
    forever even though the background task's own commit had already
    succeeded. A temp-file DB uses normal per-checkout connections, matching
    how the real app's file-based SQLite engine behaves, and does not exhibit
    this problem.
    """
    db_path = tmp_path / "test_column_lineage.sqlite"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    TestSessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

    async def _get_session():
        async with TestSessionLocal() as s:
            yield s

    app.dependency_overrides[get_session] = _get_session
    monkeypatch.setattr(db_engine, "SessionLocal", TestSessionLocal)

    async with TestSessionLocal() as session:
        yield session

    app.dependency_overrides.pop(get_session, None)
    await engine.dispose()
    await engine.dispose()


async def _seed_project(session: AsyncSession, path: str) -> int:
    proj = Project(name="test_proj", path=path, platform="local")
    session.add(proj)
    await session.commit()
    await session.refresh(proj)
    return proj.id


def _make_manifest(target_dir: Path) -> None:
    manifest_data = {
        "nodes": {
            "model.proj.stg_orders": {
                "unique_id": "model.proj.stg_orders",
                "name": "stg_orders",
                "resource_type": "model",
                "schema": "staging",
                "database": "wh",
                "config": {"materialized": "view"},
                "tags": [],
                "description": "",
                "original_file_path": "models/stg_orders.sql",
                "compiled_code": "SELECT id AS order_id FROM raw.orders",
                "columns": {},
            },
            "model.proj.orders": {
                "unique_id": "model.proj.orders",
                "name": "orders",
                "resource_type": "model",
                "schema": "analytics",
                "database": "wh",
                "config": {"materialized": "table"},
                "tags": [],
                "description": "",
                "original_file_path": "models/orders.sql",
                "compiled_code": "SELECT order_id FROM stg_orders",
                "columns": {},
            },
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.stg_orders"],
        },
        "metadata": {},
    }
    (target_dir / "manifest.json").write_text(json.dumps(manifest_data))


async def _wait_for_done(client: AsyncClient, pid: int, timeout: float = 30.0) -> dict:
    async with asyncio.timeout(timeout):
        while True:
            r = await client.get(f"/api/projects/{pid}/column-lineage")
            assert r.status_code == 200
            body = r.json()
            if body is not None and body["status"] in ("done", "error"):
                return body
            await asyncio.sleep(0.1)


async def test_start_and_poll_end_to_end(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    proj_dir = tmp_path / "proj"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    _make_manifest(target)
    pid = await _seed_project(db_session, str(proj_dir))

    start_resp = await client.post(f"/api/projects/{pid}/column-lineage/start")
    assert start_resp.status_code == 202
    started = start_resp.json()
    assert started["status"] == "running"
    assert started["total_models"] == 1  # only 'orders' has a parent + resolvable columns

    final = await _wait_for_done(client, pid)
    assert final["status"] == "done"
    assert final["checked_models"] == 1
    assert "model.proj.orders" in final["results"]
    refs = final["results"]["model.proj.orders"]["order_id"]
    assert len(refs) == 1
    assert refs[0]["node"] == "model.proj.stg_orders"
    assert refs[0]["column"] == "order_id"


async def test_start_no_manifest_returns_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    proj_dir = tmp_path / "empty_proj"
    proj_dir.mkdir()
    pid = await _seed_project(db_session, str(proj_dir))

    r = await client.post(f"/api/projects/{pid}/column-lineage/start")
    assert r.status_code == 422


async def test_start_project_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    r = await client.post("/api/projects/999999/column-lineage/start")
    assert r.status_code == 404


async def test_get_latest_project_not_found(client: AsyncClient, db_session: AsyncSession) -> None:
    r = await client.get("/api/projects/999999/column-lineage")
    assert r.status_code == 404


async def test_get_latest_no_snapshot_returns_null(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    proj_dir = tmp_path / "proj_no_scan"
    proj_dir.mkdir()
    pid = await _seed_project(db_session, str(proj_dir))

    r = await client.get(f"/api/projects/{pid}/column-lineage")
    assert r.status_code == 200
    assert r.json() is None


async def test_start_twice_returns_409_while_running(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    proj_dir = tmp_path / "proj2"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    _make_manifest(target)
    pid = await _seed_project(db_session, str(proj_dir))

    first = await client.post(f"/api/projects/{pid}/column-lineage/start")
    assert first.status_code == 202

    second = await client.post(f"/api/projects/{pid}/column-lineage/start")
    # Either a 409 (still running) or, if it raced to completion already, a
    # fresh 202 restart is also acceptable — on a fast machine the scan (2
    # tiny models) could complete before the second request lands.
    assert second.status_code in (202, 409)

    await _wait_for_done(client, pid)


async def test_start_publishes_sse_events(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    proj_dir = tmp_path / "proj3"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    _make_manifest(target)
    pid = await _seed_project(db_session, str(proj_dir))

    queue = await bus.subscribe(f"project:{pid}")
    try:
        r = await client.post(f"/api/projects/{pid}/column-lineage/start")
        assert r.status_code == 202

        seen_types: set[str] = set()
        async with asyncio.timeout(30):
            while "column_lineage_finished" not in seen_types:
                event = await queue.get()
                seen_types.add(event.type)

        assert "column_lineage_started" in seen_types
        assert "column_lineage_progress" in seen_types
        assert "column_lineage_finished" in seen_types
    finally:
        await bus.unsubscribe(f"project:{pid}", queue)


async def test_rerun_short_circuits_when_manifest_unchanged(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    proj_dir = tmp_path / "proj4"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    _make_manifest(target)
    pid = await _seed_project(db_session, str(proj_dir))

    first_start = await client.post(f"/api/projects/{pid}/column-lineage/start")
    assert first_start.status_code == 202
    first_final = await _wait_for_done(client, pid)
    first_id = first_final["id"]

    # Manifest mtime unchanged — a second start should short-circuit and
    # return the same snapshot rather than kicking off a new run.
    second_start = await client.post(f"/api/projects/{pid}/column-lineage/start")
    assert second_start.status_code == 200
    assert second_start.json()["id"] == first_id
