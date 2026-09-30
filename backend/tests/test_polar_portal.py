"""Customer portal link: where users recover a lost license key and manage devices."""
import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings, settings
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as c:
        yield c


def test_production_portal_url() -> None:
    s = Settings(_env_file=None, POLAR_USE_SANDBOX=False)
    assert s.polar_portal_url == "https://polar.sh/lamphere-labs/portal"


def test_sandbox_portal_url() -> None:
    s = Settings(_env_file=None, POLAR_USE_SANDBOX=True)
    assert s.polar_portal_url == "https://sandbox.polar.sh/lamphere-labs/portal"


def test_slug_overridable_per_environment() -> None:
    s = Settings(_env_file=None, POLAR_USE_SANDBOX=True, POLAR_SANDBOX_ORGANIZATION_SLUG="lamphere-labs-sbx")
    assert s.polar_portal_url == "https://sandbox.polar.sh/lamphere-labs-sbx/portal"


def test_blank_slug_disables_portal_link() -> None:
    s = Settings(_env_file=None, POLAR_USE_SANDBOX=False, POLAR_PRODUCTION_ORGANIZATION_SLUG="")
    assert s.polar_portal_url is None


async def test_license_status_includes_portal_url(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "polar_use_sandbox", False)
    body = (await client.get("/api/license")).json()
    assert body["portal_url"] == "https://polar.sh/lamphere-labs/portal"
