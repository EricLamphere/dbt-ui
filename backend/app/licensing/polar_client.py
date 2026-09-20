"""Thin async client for Polar's customer-portal license-key API.

Only the two endpoints dbt-ui needs: validate (check a key's current status)
and activate (register this device against a key, respecting Polar's
activation-limit seat cap). Both are public/unauthenticated per Polar's docs —
they're designed to be called directly from an untrusted client like a
desktop app — so no API key is sent on these calls.

See https://polar.sh/docs/api-reference/customer-portal/license-keys/validate
and .../activate.
"""

from dataclasses import dataclass
from typing import Any

import httpx

from app.config import settings
from app.logging_setup import get_logger

log = get_logger(__name__)

_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


class PolarError(Exception):
    """Raised when Polar couldn't be reached or gave an unexpected response —
    callers should fall back to the cached LicenseState row's last-known-good
    result within its grace period, NOT treat this as "not entitled" outright.
    A real, current answer from Polar (either LicenseKeyNotEntitled below, or
    a successful LicenseKeyState) is never raised as this.
    """


class LicenseKeyNotEntitled(Exception):
    """Polar gave a definitive, current answer: this key is not entitled —
    e.g. the underlying subscription was canceled. Confirmed by sandbox
    testing: a canceled subscription's key does NOT come back from validate()
    with a "revoked"/"disabled" status field to check — Polar just 404s with
    {"error": "ResourceNotFound", "detail": "License key is no longer active."}.
    An unrecognized key (typo, never existed) 404s identically ({"detail":
    "Not found"}), so callers should show the same "not entitled" UI for
    both rather than try to distinguish them.

    activate() on a dead key instead 403s with {"error": "NotPermitted",
    "detail": "License key is no longer active. This license key can not be
    activated."} — same underlying condition as the validate() 404 above,
    just a different status code on this endpoint. activate() raises this
    same exception for that case (matched on the "error" body field, not
    status code alone — see ACTIVATION_LIMIT_ERROR below for the OTHER
    "NotPermitted" case on this same endpoint, which is NOT this).

    Unlike PolarError, this should immediately update the cached
    LicenseState to not-entitled — it's not a transient failure to tolerate
    via the offline grace period, it's Polar confirming the key is dead.
    """


class ActivationLimitReached(Exception):
    """activate() refused because this key already has its maximum number of
    active devices (Polar's "Limit Activations" benefit setting — 2 for
    dbt-ui Pro). This is NOT "not entitled": the subscription is fine, the
    user just needs to deactivate an old device (self-serve, via their Polar
    customer portal, since "Enable user to deactivate instances" is on) or
    contact support. Surfaced separately from LicenseKeyNotEntitled so the UI
    can show "you've reached your device limit" instead of "upgrade to Pro"
    to someone who's already a paying customer.

    NOT independently confirmed against the live API (doing so requires a
    key with 2 real activations already used, which the canceled test key
    couldn't provide — see conversation history). Best-effort matched on
    Polar's documented "NotPermitted" error family for this endpoint;
    revisit if real usage shows this doesn't fire correctly.
    """


@dataclass(frozen=True)
class LicenseKeyState:
    status: str  # "granted" (the only value observed for a currently-active key)
    expires_at: str | None
    activation_id: str | None


async def activate(license_key: str, device_label: str) -> str:
    """Register this device against a license key. Returns the activation_id
    to persist and pass to every subsequent validate() call for this device.

    Raises LicenseKeyNotEntitled if the key is dead (subscription canceled/
    unrecognized), ActivationLimitReached if the key already has its max
    devices activated, or PolarError for anything else unexpected.
    """
    org_id = settings.polar_organization_id
    if not org_id:
        raise PolarError("Polar organization ID is not configured")

    url = f"{settings.polar_api_base}/v1/customer-portal/license-keys/activate"
    payload = {
        "key": license_key,
        "organization_id": org_id,
        "label": device_label,
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.post(url, json=payload)
        except httpx.HTTPError as exc:
            raise PolarError(f"Network error contacting Polar: {exc}") from exc

    if resp.status_code == 404:
        raise LicenseKeyNotEntitled(resp.text)
    if resp.status_code == 403:
        # Both "key is dead" and "activation limit reached" come back as
        # error: "NotPermitted" at the same status code (confirmed for the
        # dead-key case; the limit case is inferred from Polar's error
        # naming convention, not independently observed — see
        # ActivationLimitReached's docstring). Distinguish by message text,
        # the only signal available.
        body_lower = resp.text.lower()
        if "no longer active" in body_lower:
            raise LicenseKeyNotEntitled(resp.text)
        raise ActivationLimitReached(resp.text)
    if resp.status_code != 200:
        raise PolarError(f"Polar activate failed ({resp.status_code}): {resp.text}")

    data: dict[str, Any] = resp.json()
    activation_id = data.get("id")
    if not activation_id:
        raise PolarError("Polar activate response missing activation id")
    return activation_id


async def validate(
    license_key: str,
    activation_id: str | None,
) -> LicenseKeyState:
    """Check a license key's current status with Polar.

    Raises LicenseKeyNotEntitled if Polar gives a definitive "no" (confirmed
    by sandbox testing: this is always a 404, for both an unrecognized key
    and a key whose subscription was canceled — Polar does not return a
    "revoked" status field to distinguish them, it just stops recognizing
    the key at all). Raises PolarError for anything else unexpected (network
    failure, 5xx, malformed response) — callers should fall back to the
    cached LicenseState row's last-known-good result within its grace period
    for THIS case only, not for LicenseKeyNotEntitled.
    """
    org_id = settings.polar_organization_id
    if not org_id:
        raise PolarError("Polar organization ID is not configured")

    url = f"{settings.polar_api_base}/v1/customer-portal/license-keys/validate"
    payload: dict[str, Any] = {
        "key": license_key,
        "organization_id": org_id,
    }
    if activation_id:
        payload["activation_id"] = activation_id

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            resp = await client.post(url, json=payload)
        except httpx.HTTPError as exc:
            raise PolarError(f"Network error contacting Polar: {exc}") from exc

    if resp.status_code == 404:
        raise LicenseKeyNotEntitled(resp.text)
    if resp.status_code != 200:
        raise PolarError(f"Polar validate failed ({resp.status_code}): {resp.text}")

    data: dict[str, Any] = resp.json()
    activation = data.get("activation") or {}
    return LicenseKeyState(
        status=data.get("status", "unset"),
        expires_at=data.get("expires_at"),
        activation_id=activation.get("id"),
    )
