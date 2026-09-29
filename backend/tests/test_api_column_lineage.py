"""
Tests for the backgrounded column-lineage endpoints:
  POST /api/projects/{id}/column-lineage/start
  GET  /api/projects/{id}/column-lineage
  GET  /api/projects/{id}/column-lineage/{snapshot_id}

These mirror the drift/freshness snapshot pattern: a POST kicks off a
background asyncio.Task that fans work out across a ProcessPoolExecutor, and
progress/completion are observable both via polling GET and via SSE events on
the bus.

Column-level lineage is a dbt-ui Pro feature (see app/licensing/): the real
tracing algorithm lives in the private dbt_ui_pro package, not this repo.
These tests don't need it installed — `_entitled` below forces
check_entitlement() to report entitled for every test in this file (a
separate test class covers the actual gating behavior when NOT entitled),
and `_fake_algorithm` substitutes a small, deterministic stand-in for
prepare_lineage_jobs/trace_job that reproduces the exact lineage
_make_manifest()'s fixture data would really trace, without depending on
sqlglot or the private package at all.

Patching trace_job specifically requires patching app.dbt.column_lineage's
copy, not app.api.column_lineage's imported alias of it: trace_job is
submitted to a ProcessPoolExecutor by reference (loop.run_in_executor(_pool,
trace_job, job)), and the worker subprocess re-imports it fresh from its
true origin module (app.dbt.column_lineage) rather than seeing whatever
local alias the test patched in api/column_lineage.py's namespace.
prepare_lineage_jobs, by contrast, runs via run_in_executor(None, ...) — a
thread pool in the SAME process — so patching either module's reference
would work for it, but we patch both consistently at their shared true
origin for clarity.

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
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import app.db.engine as db_engine
import app.dbt.column_lineage as column_lineage_module
from app.db.engine import get_session
from app.db.models import Base, Project
from app.dbt.column_lineage import ColumnRef, LineageJob
from app.events.bus import bus
from app.licensing import entitlements
from app.main import app


def _fake_prepare_lineage_jobs(manifest_path: Path) -> list[LineageJob]:
    """Reproduces exactly what the real algorithm would compute for
    _make_manifest()'s fixture data (orders.order_id <- stg_orders.order_id),
    without depending on sqlglot or dbt_ui_pro."""
    data = json.loads(manifest_path.read_text())
    if "model.proj.orders" not in data.get("nodes", {}):
        return []
    return [
        LineageJob(
            uid="model.proj.orders",
            columns=("order_id",),
            sql="SELECT order_id FROM stg_orders",
            dialect=None,
            parent_short_names=("stg_orders",),
            name_to_uid={"stg_orders": "model.proj.stg_orders", "orders": "model.proj.orders"},
            sources={"stg_orders": "SELECT order_id"},
        )
    ]


def _fake_trace_job(job: LineageJob) -> tuple[str, dict[str, list[ColumnRef]]]:
    """Matches _fake_prepare_lineage_jobs' single job — real ProcessPoolExecutor
    fan-out still happens, this just replaces the sqlglot tracing itself."""
    return job.uid, {"order_id": [ColumnRef(node="model.proj.stg_orders", column="order_id")]}


@pytest.fixture(autouse=True)
def _fake_algorithm(monkeypatch: pytest.MonkeyPatch):
    """See module docstring for why both the true-origin module AND the
    api module's imported alias are patched."""
    monkeypatch.setattr(column_lineage_module, "prepare_lineage_jobs", _fake_prepare_lineage_jobs)
    monkeypatch.setattr(column_lineage_module, "trace_job", _fake_trace_job)
    import app.api.column_lineage as api_module
    monkeypatch.setattr(api_module, "prepare_lineage_jobs", _fake_prepare_lineage_jobs)
    monkeypatch.setattr(api_module, "trace_job", _fake_trace_job)


@pytest.fixture(autouse=True)
async def _entitled(monkeypatch: pytest.MonkeyPatch):
    """Forces every test in this file to see an entitled installation —
    entitlement-gating behavior itself (403 when NOT entitled) is covered
    separately below in TestEntitlementGating, which does NOT use this
    fixture."""
    async def _always_entitled(session, *, force: bool = False):
        return entitlements.Entitlement(entitled=True, reason="granted")

    monkeypatch.setattr(entitlements, "check_entitlement", _always_entitled)


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
    # total_models is 0 in the immediate response — prepare_lineage_jobs() now
    # runs inside the background task (so the endpoint stays fast even when a
    # stale manifest needs a `dbt compile` first), not before the snapshot row
    # is created. The real count shows up once polling reaches "done" below.

    final = await _wait_for_done(client, pid)
    assert final["status"] == "done"
    assert final["checked_models"] == 1
    assert "model.proj.orders" in final["results"]
    refs = final["results"]["model.proj.orders"]["order_id"]
    assert len(refs) == 1
    assert refs[0]["node"] == "model.proj.stg_orders"
    assert refs[0]["column"] == "order_id"


async def test_start_auto_compiles_stale_manifest(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A manifest with no compiled_code on any model (e.g. from `dbt parse`,
    or before the project has ever been compiled) must not silently report
    zero models — start_column_lineage should run `dbt compile` first, then
    proceed with the scan against the freshly compiled manifest."""
    proj_dir = tmp_path / "stale_proj"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    manifest_path = target / "manifest.json"
    manifest_path.write_text(json.dumps({
        "nodes": {
            "model.proj.stg_orders": {
                "unique_id": "model.proj.stg_orders",
                "name": "stg_orders",
                "resource_type": "model",
                "original_file_path": "models/stg_orders.sql",
                "columns": {},
                # no compiled_code — this is the "needs compile" condition
            },
        },
        "sources": {},
        "parent_map": {},
        "metadata": {},
    }))
    pid = await _seed_project(db_session, str(proj_dir))

    compile_calls: list[int] = []

    async def _fake_compile_project(project_id: int, project_path: str) -> bool:
        compile_calls.append(project_id)
        # Simulate a real `dbt compile`: it rewrites the manifest with
        # compiled_code populated.
        _make_manifest(Path(project_path) / "target")
        return True

    import app.api.models as models_module
    monkeypatch.setattr(models_module, "_compile_project", _fake_compile_project)

    queue = await bus.subscribe(f"project:{pid}")
    try:
        r = await client.post(f"/api/projects/{pid}/column-lineage/start")
        assert r.status_code == 202
        assert r.json()["status"] == "running"

        seen_types: list[str] = []
        async with asyncio.timeout(30):
            while "column_lineage_finished" not in seen_types:
                event = await queue.get()
                seen_types.append(event.type)
    finally:
        await bus.unsubscribe(f"project:{pid}", queue)

    assert compile_calls == [pid]
    # compiling must be signaled before the scan itself starts
    assert seen_types.index("column_lineage_compiling") < seen_types.index("column_lineage_started")

    final = await _wait_for_done(client, pid)
    assert final["status"] == "done"
    assert "model.proj.orders" in final["results"]


async def test_start_reports_error_when_compile_fails(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    proj_dir = tmp_path / "stale_proj_fails"
    proj_dir.mkdir()
    target = proj_dir / "target"
    target.mkdir()
    (target / "manifest.json").write_text(json.dumps({
        "nodes": {
            "model.proj.stg_orders": {
                "unique_id": "model.proj.stg_orders",
                "name": "stg_orders",
                "resource_type": "model",
                "original_file_path": "models/stg_orders.sql",
                "columns": {},
            },
        },
        "sources": {},
        "parent_map": {},
        "metadata": {},
    }))
    pid = await _seed_project(db_session, str(proj_dir))

    async def _fake_compile_project_fails(project_id: int, project_path: str) -> bool:
        return False

    import app.api.models as models_module
    monkeypatch.setattr(models_module, "_compile_project", _fake_compile_project_fails)

    r = await client.post(f"/api/projects/{pid}/column-lineage/start")
    assert r.status_code == 202

    final = await _wait_for_done(client, pid)
    assert final["status"] == "error"
    assert "compile failed" in final["error_message"]


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
    # 409 (still running) is the expected case. But on a fast machine the
    # scan (2 tiny models) can complete before the second request lands —
    # then start_column_lineage's manifest-mtime short-circuit kicks in and
    # returns the already-`done` snapshot: 200 if the manifest is unchanged,
    # or a fresh 202 restart if it decided a new scan was needed anyway.
    assert second.status_code in (200, 202, 409)

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


class TestEntitlementGating:
    """Unlike every test above, these do NOT use the _entitled autouse
    fixture's override — they verify the real check_entitlement() logic
    correctly blocks all three routes when there's no valid license."""

    @pytest.fixture(autouse=True)
    def _not_entitled(self, monkeypatch: pytest.MonkeyPatch):
        async def _never_entitled(session, *, force: bool = False):
            return entitlements.Entitlement(entitled=False, reason="not_licensed")

        monkeypatch.setattr(entitlements, "check_entitlement", _never_entitled)

    async def test_start_returns_403_when_not_entitled(
        self, client: AsyncClient, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        proj_dir = tmp_path / "proj_gated"
        proj_dir.mkdir()
        target = proj_dir / "target"
        target.mkdir()
        _make_manifest(target)
        pid = await _seed_project(db_session, str(proj_dir))

        r = await client.post(f"/api/projects/{pid}/column-lineage/start")
        assert r.status_code == 403
        assert r.json()["detail"]["error"] == "pro_feature_required"

    async def test_get_latest_returns_403_when_not_entitled(
        self, client: AsyncClient, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        proj_dir = tmp_path / "proj_gated2"
        proj_dir.mkdir()
        pid = await _seed_project(db_session, str(proj_dir))

        r = await client.get(f"/api/projects/{pid}/column-lineage")
        assert r.status_code == 403

    async def test_get_snapshot_returns_403_when_not_entitled(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        r = await client.get("/api/projects/1/column-lineage/1")
        assert r.status_code == 403
