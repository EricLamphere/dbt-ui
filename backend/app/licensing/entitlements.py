"""Entitlement resolution: is this installation currently allowed to use Pro
features? Wraps polar_client with a persistent grace-period cache so Pro
features keep working through brief offline periods / Polar outages, while
still requiring a fresh successful check periodically so a canceled
subscription doesn't stay entitled forever just by going offline.

Design (per project decision — see conversation history, not re-litigated
here): grace period, not fail-open or fail-closed. A definitive "no" from
Polar (LicenseKeyNotEntitled — confirmed via sandbox testing to be how a
canceled subscription's key actually behaves, see polar_client.py) is always
trusted immediately, regardless of the grace period; the grace period only
protects against not being able to REACH Polar at all.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import LicenseState
from app.licensing import polar_client
from app.licensing.polar_client import ActivationLimitReached, LicenseKeyNotEntitled, PolarError
from app.logging_setup import get_logger

log = get_logger(__name__)

# How long a previously-successful "entitled" result stays trusted without a
# fresh check succeeding. Chosen to comfortably cover a week offline (e.g. a
# laptop with no internet for a trip) without indefinitely honoring a
# canceled subscription for someone who deliberately stays offline to dodge
# the check.
GRACE_PERIOD = timedelta(days=7)

# Re-check at most this often even when everything's fine — avoids hitting
# Polar on every single app launch/feature use once we already know the
# answer is "yes" from recently.
RECHECK_INTERVAL = timedelta(hours=6)


@dataclass(frozen=True)
class Entitlement:
    entitled: bool
    reason: str  # "granted" | "not_licensed" | "not_entitled" | "grace_period" | "unreachable" | "activation_limit_reached"


async def _get_or_create_state(session: AsyncSession) -> LicenseState:
    state = await session.get(LicenseState, 1)
    if state is None:
        state = LicenseState(id=1, device_id=uuid.uuid4().hex, entitled=False, status="unset")
        session.add(state)
        await session.commit()
        await session.refresh(state)
    return state


async def set_license_key(session: AsyncSession, license_key: str | None) -> LicenseState:
    """Set (or clear) the license key for this installation. Clears any
    cached activation/entitlement — the next check_entitlement() call will
    activate + validate the new key fresh."""
    state = await _get_or_create_state(session)
    state.license_key = license_key.strip() if license_key else None
    state.activation_id = None
    state.entitled = False
    state.status = "unset"
    state.checked_at = None
    await session.commit()
    await session.refresh(state)
    return state


async def get_cached_state(session: AsyncSession) -> LicenseState:
    return await _get_or_create_state(session)


async def check_entitlement(session: AsyncSession, *, force: bool = False) -> Entitlement:
    """Resolve current Pro entitlement, checking Polar if due (or forced),
    otherwise trusting the cache. Always persists whatever it learns.
    """
    state = await _get_or_create_state(session)

    if not state.license_key:
        return Entitlement(entitled=False, reason="not_licensed")

    now = datetime.now(timezone.utc)
    checked_at = state.checked_at
    if checked_at is not None and checked_at.tzinfo is None:
        checked_at = checked_at.replace(tzinfo=timezone.utc)

    due_for_check = force or checked_at is None or (now - checked_at) > RECHECK_INTERVAL
    if not due_for_check:
        return Entitlement(entitled=state.entitled, reason="granted" if state.entitled else "not_entitled")

    # Activate this device against the key if we haven't already — a fresh
    # license_key (just set by the user) has no activation_id yet.
    if state.activation_id is None:
        try:
            state.activation_id = await polar_client.activate(state.license_key, device_label=state.device_id)
            await session.commit()
        except LicenseKeyNotEntitled:
            state.entitled = False
            state.status = "not_entitled"
            state.checked_at = now
            await session.commit()
            return Entitlement(entitled=False, reason="not_entitled")
        except ActivationLimitReached:
            # Subscription is fine — this device just can't get a seat. Not
            # cached as "not entitled": leave state.entitled/status/checked_at
            # untouched so a later retry (after freeing a seat) re-attempts
            # activation rather than being stuck behind a stale not_licensed
            # result until RECHECK_INTERVAL elapses.
            return Entitlement(entitled=False, reason="activation_limit_reached")
        except PolarError as exc:
            log.warning("license_activate_unreachable error=%s", exc)
            return _grace_period_result(state, now)

    try:
        result = await polar_client.validate(state.license_key, state.activation_id)
    except LicenseKeyNotEntitled:
        # Definitive "no" — trust it immediately regardless of grace period.
        # This is the confirmed real-world shape of "subscription canceled".
        state.entitled = False
        state.status = "not_entitled"
        state.checked_at = now
        await session.commit()
        return Entitlement(entitled=False, reason="not_entitled")
    except PolarError as exc:
        log.warning("license_validate_unreachable error=%s", exc)
        return _grace_period_result(state, now)

    state.entitled = result.status == "granted"
    state.status = result.status
    state.checked_at = now
    await session.commit()
    return Entitlement(entitled=state.entitled, reason="granted" if state.entitled else "not_entitled")


def _grace_period_result(state: LicenseState, now: datetime) -> Entitlement:
    """Polar was unreachable. Honor the last known-good result if it's within
    the grace period; otherwise treat as not entitled rather than trusting a
    result that's gone stale."""
    checked_at = state.checked_at
    if checked_at is not None and checked_at.tzinfo is None:
        checked_at = checked_at.replace(tzinfo=timezone.utc)

    if state.entitled and checked_at is not None and (now - checked_at) <= GRACE_PERIOD:
        return Entitlement(entitled=True, reason="grace_period")
    return Entitlement(entitled=False, reason="unreachable")
