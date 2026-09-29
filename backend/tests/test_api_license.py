"""Tests for /api/license — the licensing status/activation endpoints.

Mocks app.licensing.polar_client at the network boundary (never hits the
real Polar API). Uses the autouse `override_db` fixture from conftest.py.
"""

from unittest.mock import AsyncMock, patch

from httpx import ASGITransport, AsyncClient

from app.licensing.polar_client import LicenseKeyState, PolarError
from app.main import app


async def _client() -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_get_status_no_key_set() -> None:
    async with await _client() as client:
        r = await client.get("/api/license")

    assert r.status_code == 200
    body = r.json()
    assert body["has_key"] is False
    assert body["license_key"] is None
    assert body["entitled"] is False
    assert body["reason"] == "not_licensed"
    assert body["checked_at"] is None
    assert body["can_cancel"] is False
    assert body["limit_activations"] is None
    assert body["can_view_activations"] is False


async def test_set_license_key_activates_and_validates() -> None:
    with patch(
        "app.licensing.entitlements.polar_client.activate", new=AsyncMock(return_value="act_123")
    ), patch(
        "app.licensing.entitlements.polar_client.validate",
        new=AsyncMock(
            return_value=LicenseKeyState(
                status="granted",
                expires_at=None,
                activation_id="act_123",
                customer_id="cust_123",
                license_key_id="lk_123",
                limit_activations=2,
            )
        ),
    ):
        async with await _client() as client:
            r = await client.put("/api/license", json={"license_key": "DBTUI_-TEST-KEY"})

    assert r.status_code == 200
    body = r.json()
    assert body["has_key"] is True
    assert body["license_key"] == "DBTUI_-TEST-KEY"
    assert body["entitled"] is True
    assert body["reason"] == "granted"
    assert body["status"] == "granted"
    assert body["checked_at"] is not None
    assert body["can_cancel"] is True
    assert body["limit_activations"] == 2
    assert body["can_view_activations"] is True


async def test_set_license_key_not_entitled() -> None:
    from app.licensing.polar_client import LicenseKeyNotEntitled

    with patch(
        "app.licensing.entitlements.polar_client.activate",
        new=AsyncMock(side_effect=LicenseKeyNotEntitled("canceled")),
    ):
        async with await _client() as client:
            r = await client.put("/api/license", json={"license_key": "DBTUI_-CANCELED-KEY"})

    assert r.status_code == 200
    body = r.json()
    assert body["entitled"] is False
    assert body["reason"] == "not_entitled"


async def test_clear_license_key() -> None:
    with patch(
        "app.licensing.entitlements.polar_client.activate", new=AsyncMock(return_value="act_123")
    ), patch(
        "app.licensing.entitlements.polar_client.validate",
        new=AsyncMock(return_value=LicenseKeyState(status="granted", expires_at=None, activation_id="act_123")),
    ):
        async with await _client() as client:
            await client.put("/api/license", json={"license_key": "DBTUI_-TEST-KEY"})
            r = await client.put("/api/license", json={"license_key": None})

    assert r.status_code == 200
    body = r.json()
    assert body["has_key"] is False
    assert body["entitled"] is False
    assert body["reason"] == "not_licensed"


async def test_recheck_forces_fresh_check() -> None:
    with patch(
        "app.licensing.entitlements.polar_client.activate", new=AsyncMock(return_value="act_123")
    ), patch(
        "app.licensing.entitlements.polar_client.validate",
        new=AsyncMock(return_value=LicenseKeyState(status="granted", expires_at=None, activation_id="act_123")),
    ) as mock_validate:
        async with await _client() as client:
            await client.put("/api/license", json={"license_key": "DBTUI_-TEST-KEY"})
            r = await client.post("/api/license/recheck")

    assert r.status_code == 200
    assert r.json()["entitled"] is True
    # Called once during PUT (initial check) and once during the forced recheck.
    assert mock_validate.await_count == 2


async def test_checkout_url_included_when_configured() -> None:
    from app.config import settings

    original = settings.polar_sandbox_checkout_url
    settings.polar_sandbox_checkout_url = "https://polar.sh/lamphere-labs/checkout/test"
    try:
        async with await _client() as client:
            r = await client.get("/api/license")
        assert r.json()["checkout_url"] == "https://polar.sh/lamphere-labs/checkout/test"
    finally:
        settings.polar_sandbox_checkout_url = original


async def _activate_licensed_client(client: AsyncClient) -> None:
    with patch(
        "app.licensing.entitlements.polar_client.activate", new=AsyncMock(return_value="act_123")
    ), patch(
        "app.licensing.entitlements.polar_client.validate",
        new=AsyncMock(
            return_value=LicenseKeyState(
                status="granted",
                expires_at=None,
                activation_id="act_123",
                customer_id="cust_123",
                license_key_id="lk_123",
                limit_activations=2,
            )
        ),
    ):
        await client.put("/api/license", json={"license_key": "DBTUI_-TEST-KEY"})


async def test_cancel_subscription_success() -> None:
    async with await _client() as client:
        await _activate_licensed_client(client)

        with patch(
            "app.licensing.entitlements.polar_client.create_customer_session",
            new=AsyncMock(return_value="session_token_abc"),
        ), patch(
            "app.licensing.entitlements.polar_client.list_active_subscription_ids",
            new=AsyncMock(return_value=["sub_123"]),
        ), patch(
            "app.licensing.entitlements.polar_client.cancel_subscription", new=AsyncMock()
        ) as mock_cancel:
            r = await client.post("/api/license/cancel")

    assert r.status_code == 200
    assert r.json() == {"ok": True, "error": None}
    mock_cancel.assert_awaited_once_with("session_token_abc", "sub_123")


async def test_cancel_subscription_without_customer_id_fails() -> None:
    async with await _client() as client:
        r = await client.post("/api/license/cancel")

    assert r.status_code == 502


async def test_cancel_subscription_no_active_subscription_fails() -> None:
    async with await _client() as client:
        await _activate_licensed_client(client)

        with patch(
            "app.licensing.entitlements.polar_client.create_customer_session",
            new=AsyncMock(return_value="session_token_abc"),
        ), patch(
            "app.licensing.entitlements.polar_client.list_active_subscription_ids",
            new=AsyncMock(return_value=[]),
        ):
            r = await client.post("/api/license/cancel")

    assert r.status_code == 502


async def test_cancel_subscription_polar_error_propagates() -> None:
    async with await _client() as client:
        await _activate_licensed_client(client)

        with patch(
            "app.licensing.entitlements.polar_client.create_customer_session",
            new=AsyncMock(side_effect=PolarError("boom")),
        ):
            r = await client.post("/api/license/cancel")

    assert r.status_code == 502


async def test_get_activations_success() -> None:
    async with await _client() as client:
        await _activate_licensed_client(client)

        with patch(
            "app.licensing.entitlements.polar_client.get_activation_count",
            new=AsyncMock(return_value=2),
        ):
            r = await client.get("/api/license/activations")

    assert r.status_code == 200
    assert r.json() == {"count": 2, "limit": 2}


async def test_get_activations_without_license_key_id_fails() -> None:
    async with await _client() as client:
        r = await client.get("/api/license/activations")

    assert r.status_code == 502


async def test_get_activations_polar_error_propagates() -> None:
    async with await _client() as client:
        await _activate_licensed_client(client)

        with patch(
            "app.licensing.entitlements.polar_client.get_activation_count",
            new=AsyncMock(side_effect=PolarError("boom")),
        ):
            r = await client.get("/api/license/activations")

    assert r.status_code == 502
