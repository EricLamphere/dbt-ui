import stat
import sys
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.api import settings as settings_api
from app.config import settings
from app.db.models import AppSetting, Base
from app.dbt import python_env, venv
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture(autouse=True)
def isolated_venv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Point the dbt venv at a temp dir and record rebuilds instead of running them."""
    monkeypatch.setattr(settings, "dbt_venv_dir", tmp_path / "dbt-venv")
    monkeypatch.setattr(venv, "_configured_python", None)
    rebuilds: list[str] = []

    def fake_rebuild(python: str) -> Path:
        rebuilds.append(python)
        d = settings.dbt_venv_dir
        (d / "bin").mkdir(parents=True, exist_ok=True)
        (d / "bin" / "python3").touch()
        (d / venv.MARKER_NAME).write_text(python)
        return d

    monkeypatch.setattr(venv, "rebuild_venv", fake_rebuild)
    return rebuilds


def _fake_python(tmp_path: Path, name: str, version: str) -> str:
    p = tmp_path / name
    p.write_text(f"#!/bin/sh\necho '{version}'\n")
    p.chmod(p.stat().st_mode | stat.S_IXUSR)
    return str(p)


async def test_get_settings_includes_python_path(client: AsyncClient) -> None:
    body = (await client.get("/api/settings")).json()
    assert body["python_path"] is None
    assert body["python_path_editable"] is True


async def test_get_settings_reports_not_editable_for_own_venv(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "dbt_venv_dir", Path(sys.prefix))
    body = (await client.get("/api/settings")).json()
    assert body["python_path_editable"] is False


async def test_put_python_path_rebuilds_and_saves(
    client: AsyncClient, tmp_path: Path, isolated_venv: list[str]
) -> None:
    py = _fake_python(tmp_path, "python3.13", "3 13")

    resp = await client.put("/api/settings", json={"python_path": py})

    assert resp.status_code == 200
    assert resp.json()["python_path"] == py
    assert isolated_venv == [py]
    assert venv.configured_python() == py


async def test_put_same_python_path_skips_rebuild(
    client: AsyncClient, tmp_path: Path, isolated_venv: list[str]
) -> None:
    py = _fake_python(tmp_path, "python3.13", "3 13")
    await client.put("/api/settings", json={"python_path": py})

    resp = await client.put("/api/settings", json={"python_path": py})

    assert resp.status_code == 200
    assert isolated_venv == [py]


async def test_put_invalid_python_path_rejected(
    client: AsyncClient, tmp_path: Path, isolated_venv: list[str]
) -> None:
    old = _fake_python(tmp_path, "python3.9", "3 9")

    resp = await client.put("/api/settings", json={"python_path": old})

    assert resp.status_code == 400
    assert "3.11" in resp.json()["detail"]
    assert isolated_venv == []
    assert (await client.get("/api/settings")).json()["python_path"] is None


async def test_put_empty_python_path_redetects(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, isolated_venv: list[str]
) -> None:
    detected = _fake_python(tmp_path, "python3.12", "3 12")
    monkeypatch.setattr(venv, "find_system_python", lambda: detected)

    resp = await client.put("/api/settings", json={"python_path": "  "})

    assert resp.status_code == 200
    assert resp.json()["python_path"] == detected
    assert isolated_venv == [detected]


async def test_put_python_path_rejected_for_own_venv(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, isolated_venv: list[str]
) -> None:
    monkeypatch.setattr(settings, "dbt_venv_dir", Path(sys.prefix))
    py = _fake_python(tmp_path, "python3.13", "3 13")

    resp = await client.put("/api/settings", json={"python_path": py})

    assert resp.status_code == 400
    assert "DBT_UI_DBT_VENV_DIR" in resp.json()["detail"]
    assert isolated_venv == []


async def test_put_python_path_conflicts_while_busy(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch, isolated_venv: list[str]
) -> None:
    monkeypatch.setattr(settings_api, "_python_env_busy_reason", lambda: "a dbt command is running")
    py = _fake_python(tmp_path, "python3.13", "3 13")

    resp = await client.put("/api/settings", json={"python_path": py})

    assert resp.status_code == 409
    assert "dbt command" in resp.json()["detail"]
    assert isolated_venv == []


async def test_put_python_path_rebuild_failure_not_saved(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing_rebuild(python: str) -> Path:
        raise RuntimeError("venv exploded")

    monkeypatch.setattr(venv, "rebuild_venv", failing_rebuild)
    py = _fake_python(tmp_path, "python3.13", "3 13")

    resp = await client.put("/api/settings", json={"python_path": py})

    assert resp.status_code == 500
    assert "venv exploded" in resp.json()["detail"]
    assert (await client.get("/api/settings")).json()["python_path"] is None


# ---- startup sync ----


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    async with async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)() as s:
        yield s
    await engine.dispose()


async def test_load_python_setting_stores_detected(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(venv, "detect_python", lambda: "/opt/homebrew/bin/python3.12")

    value = await python_env.load_python_setting(session)

    assert value == "/opt/homebrew/bin/python3.12"
    row = await session.get(AppSetting, python_env.PYTHON_PATH_KEY)
    assert row is not None and row.value == "/opt/homebrew/bin/python3.12"
    assert venv.configured_python() == "/opt/homebrew/bin/python3.12"


async def test_load_python_setting_keeps_existing(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    session.add(AppSetting(key=python_env.PYTHON_PATH_KEY, value="/usr/local/bin/python3.11"))
    await session.commit()
    monkeypatch.setattr(venv, "detect_python", lambda: "/opt/homebrew/bin/python3.13")

    value = await python_env.load_python_setting(session)

    assert value == "/usr/local/bin/python3.11"
    assert venv.configured_python() == "/usr/local/bin/python3.11"


async def test_load_python_setting_nothing_detected(
    session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(venv, "detect_python", lambda: None)

    assert await python_env.load_python_setting(session) is None
    assert await session.get(AppSetting, python_env.PYTHON_PATH_KEY) is None
    assert venv.configured_python() is None


async def test_list_python_interpreters(
    client: AsyncClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    d = tmp_path / "bin"
    d.mkdir()
    py = _fake_python(d, "python3.13", "3 13 1")
    monkeypatch.setattr(venv, "_interpreter_search_dirs", lambda: [d])

    resp = await client.get("/api/settings/python-interpreters")

    assert resp.status_code == 200
    assert resp.json() == [{"path": py, "version": "3.13.1"}]


async def test_put_symlinked_alias_of_current_skips_rebuild(
    client: AsyncClient, tmp_path: Path, isolated_venv: list[str]
) -> None:
    py = _fake_python(tmp_path, "python3.13", "3 13")
    alias = tmp_path / "python3"
    alias.symlink_to(py)
    await client.put("/api/settings", json={"python_path": py})

    resp = await client.put("/api/settings", json={"python_path": str(alias)})

    assert resp.status_code == 200
    assert isolated_venv == [py]
