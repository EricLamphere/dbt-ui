from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import init as init_api
from app.api import setup as setup_api
from app.config import settings
from app.db.models import AppSetting, Base
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def no_env_workspace(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "dbt_projects_path", None)


@pytest.fixture
def python_changes(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Record python_path changes instead of validating/rebuilding a real venv."""
    calls: list[str] = []

    async def fake_change(session: AsyncSession, raw: str) -> None:
        calls.append(raw)

    monkeypatch.setattr(setup_api, "change_python_path", fake_change)
    return calls


def _body(projects: Path, **overrides: object) -> dict[str, object]:
    return {
        "dbt_projects_path": str(projects),
        "python_path": "",
        "global_requirements_path": "",
        "theme": "dark",
        **overrides,
    }


# ---- setup_completed flag ----


async def test_fresh_install_needs_setup(client: AsyncClient) -> None:
    assert (await client.get("/api/settings")).json()["setup_completed"] is False


async def test_complete_setup_saves_everything(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    req = tmp_path / "requirements.txt"
    req.write_text("dbt-duckdb\n")

    resp = await client.post(
        "/api/setup/complete",
        json=_body(tmp_path, python_path="/opt/homebrew/bin/python3.12", global_requirements_path=str(req), theme="light"),
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["setup_completed"] is True
    assert body["configured"] is True
    assert body["dbt_projects_path"] == str(tmp_path)
    assert body["global_requirements_path"] == str(req)
    assert body["theme"] == "light"
    assert python_changes == ["/opt/homebrew/bin/python3.12"]


async def test_blank_python_uses_auto_detection(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    resp = await client.post("/api/setup/complete", json=_body(tmp_path))
    assert resp.status_code == 200
    assert python_changes == [""]


async def test_blank_requirements_clears_setting(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    await client.put("/api/settings", json={"global_requirements_path": "/old/requirements.txt"})

    resp = await client.post("/api/setup/complete", json=_body(tmp_path))

    assert resp.json()["global_requirements_path"] is None


async def test_projects_path_expands_user(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, python_changes: list[str]
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "dbt").mkdir()

    resp = await client.post("/api/setup/complete", json=_body(Path("~/dbt")))

    assert resp.json()["dbt_projects_path"] == str(tmp_path / "dbt")


# ---- validation ----


async def test_missing_projects_dir_rejected(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    resp = await client.post("/api/setup/complete", json=_body(tmp_path / "nope"))

    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert detail["field"] == "dbt_projects_path"
    assert detail["code"] == "not_found"
    assert (await client.get("/api/settings")).json()["setup_completed"] is False


async def test_missing_projects_dir_created_on_request(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    target = tmp_path / "new" / "dbt-projects"

    resp = await client.post("/api/setup/complete", json=_body(target, create_projects_dir=True))

    assert resp.status_code == 200
    assert target.is_dir()


async def test_projects_path_that_is_a_file_rejected(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    f = tmp_path / "file.txt"
    f.write_text("")

    resp = await client.post("/api/setup/complete", json=_body(f, create_projects_dir=True))

    assert resp.status_code == 400
    assert resp.json()["detail"]["field"] == "dbt_projects_path"


async def test_empty_projects_path_rejected(client: AsyncClient, python_changes: list[str]) -> None:
    resp = await client.post("/api/setup/complete", json=_body(Path("  ")))
    assert resp.status_code == 400
    assert resp.json()["detail"]["field"] == "dbt_projects_path"


async def test_missing_requirements_file_rejected(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    resp = await client.post(
        "/api/setup/complete",
        json=_body(tmp_path, global_requirements_path=str(tmp_path / "missing.txt")),
    )

    assert resp.status_code == 400
    assert resp.json()["detail"]["field"] == "global_requirements_path"
    assert python_changes == []


async def test_invalid_theme_rejected(client: AsyncClient, tmp_path: Path, python_changes: list[str]) -> None:
    resp = await client.post("/api/setup/complete", json=_body(tmp_path, theme="neon"))
    assert resp.status_code == 422


async def test_python_error_reported_on_python_field(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from fastapi import HTTPException

    async def failing_change(session: AsyncSession, raw: str) -> None:
        raise HTTPException(status_code=400, detail="/usr/bin/python3 is Python 3.9")

    monkeypatch.setattr(setup_api, "change_python_path", failing_change)

    resp = await client.post("/api/setup/complete", json=_body(tmp_path, python_path="/usr/bin/python3"))

    assert resp.status_code == 400
    assert resp.json()["detail"] == {
        "field": "python_path",
        "code": "invalid",
        "message": "/usr/bin/python3 is Python 3.9",
    }
    assert (await client.get("/api/settings")).json()["setup_completed"] is False


async def test_complete_setup_rescans_projects(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    proj = tmp_path / "jaffle"
    proj.mkdir()
    (proj / "dbt_project.yml").write_text("name: jaffle\nprofile: jaffle\n")

    await client.post("/api/setup/complete", json=_body(tmp_path))

    names = [p["name"] for p in (await client.get("/api/projects")).json()]
    assert "jaffle" in names


# ---- existing installs skip the wizard ----


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)() as s:
        yield s
    await engine.dispose()


async def test_existing_install_marked_complete(session: AsyncSession) -> None:
    session.add(AppSetting(key="dbt_projects_path", value="/Users/me/dbt"))
    await session.commit()

    await setup_api.seed_setup_completed(session)

    row = await session.get(AppSetting, setup_api.SETUP_COMPLETED_KEY)
    assert row is not None and row.value == "true"


async def test_env_configured_install_marked_complete(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dbt_projects_path", Path("/Users/me/dbt"))

    await setup_api.seed_setup_completed(session)

    assert (await session.get(AppSetting, setup_api.SETUP_COMPLETED_KEY)) is not None


async def test_fresh_install_left_for_wizard(session: AsyncSession) -> None:
    await setup_api.seed_setup_completed(session)
    assert await session.get(AppSetting, setup_api.SETUP_COMPLETED_KEY) is None


async def test_seed_does_not_override_existing_flag(session: AsyncSession) -> None:
    session.add(AppSetting(key=setup_api.SETUP_COMPLETED_KEY, value="false"))
    session.add(AppSetting(key="dbt_projects_path", value="/Users/me/dbt"))
    await session.commit()

    await setup_api.seed_setup_completed(session)

    row = await session.get(AppSetting, setup_api.SETUP_COMPLETED_KEY)
    assert row is not None and row.value == "false"


# ---- global setup always has something to install ----


def test_global_setup_installs_requirements_file(tmp_path: Path) -> None:
    req = tmp_path / "requirements.txt"
    assert init_api._global_setup_install_args(req) == ["-r", str(req)]


def test_global_setup_defaults_to_latest_dbt_core() -> None:
    assert init_api._global_setup_install_args(None) == ["--upgrade", "dbt-core"]


async def test_global_setup_runs_without_requirements_path(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    installs: list[list[str]] = []

    def fake_pip(pip: Path, install_args: list[str], pip_env: dict) -> None:
        installs.append(install_args)
        init_api._global_output_queue.put(None)

    monkeypatch.setattr(init_api, "_run_pip_in_thread", fake_pip)
    monkeypatch.setattr(init_api, "venv_pip", lambda: tmp_path / "pip")

    resp = await client.post("/api/init/global-setup")
    init_api._global_setup_thread.join(timeout=5)

    assert resp.status_code == 200
    assert installs == [["--upgrade", "dbt-core"]]


async def test_global_setup_missing_requirements_file_still_errors(
    client: AsyncClient, tmp_path: Path
) -> None:
    await client.put("/api/settings", json={"global_requirements_path": str(tmp_path / "gone.txt")})

    resp = await client.post("/api/init/global-setup")

    assert resp.status_code == 404



# ---- default requirements file ----


async def test_missing_requirements_file_created_on_request(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    req = tmp_path / "requirements.txt"

    resp = await client.post(
        "/api/setup/complete",
        json=_body(tmp_path, global_requirements_path=str(req), create_requirements_file=True),
    )

    assert resp.status_code == 200, resp.text
    assert req.read_text() == "dbt-core\n"
    assert resp.json()["global_requirements_path"] == str(req)


async def test_existing_requirements_file_not_overwritten(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    req = tmp_path / "requirements.txt"
    req.write_text("dbt-duckdb==1.10.1\n")

    await client.post(
        "/api/setup/complete",
        json=_body(tmp_path, global_requirements_path=str(req), create_requirements_file=True),
    )

    assert req.read_text() == "dbt-duckdb==1.10.1\n"


async def test_requirements_file_created_inside_new_projects_dir(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    projects = tmp_path / "fresh" / "dbt-projects"
    req = projects / "requirements.txt"

    resp = await client.post(
        "/api/setup/complete",
        json=_body(
            projects,
            create_projects_dir=True,
            global_requirements_path=str(req),
            create_requirements_file=True,
        ),
    )

    assert resp.status_code == 200, resp.text
    assert req.is_file()


async def test_requirements_path_that_is_a_dir_rejected(
    client: AsyncClient, tmp_path: Path, python_changes: list[str]
) -> None:
    resp = await client.post(
        "/api/setup/complete",
        json=_body(tmp_path, global_requirements_path=str(tmp_path), create_requirements_file=True),
    )

    assert resp.status_code == 400
    assert resp.json()["detail"]["field"] == "global_requirements_path"
