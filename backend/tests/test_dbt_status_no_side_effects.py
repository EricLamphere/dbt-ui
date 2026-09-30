"""Status endpoints must never create the dbt venv: on a fresh install that takes
~1s of blocking work, stalls every other request, and builds the venv before the
user has picked a Python in the setup wizard."""
from pathlib import Path

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.dbt import venv
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


@pytest.fixture
def missing_venv(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    d = tmp_path / "dbt-venv"
    monkeypatch.setattr(settings, "dbt_venv_dir", d)

    def fail(*args: object, **kwargs: object) -> None:
        raise AssertionError("status check tried to create the venv")

    monkeypatch.setattr(venv, "_create_venv", fail)
    return d


async def test_dbt_core_status_without_venv(client: AsyncClient, missing_venv: Path) -> None:
    resp = await client.get("/api/init/dbt-core-status")

    assert resp.status_code == 200
    assert resp.json() == {"installed": False, "version": None}
    assert not missing_venv.exists()


async def test_package_info_without_venv(client: AsyncClient, missing_venv: Path) -> None:
    resp = await client.get("/api/init/package-info", params={"package": "dbt-core"})

    assert resp.status_code == 200
    assert resp.json() == {"package": "dbt-core", "installed_version": None}
    assert not missing_venv.exists()


def test_existing_bin(missing_venv: Path) -> None:
    assert venv.existing_bin("dbt") is None
    (missing_venv / "bin").mkdir(parents=True)
    (missing_venv / "bin" / "dbt").write_text("")
    assert venv.existing_bin("dbt") == missing_venv / "bin" / "dbt"
