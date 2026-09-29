from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.engine import get_session
from app.licensing import entitlements
from app.licensing.polar_client import PolarError

router = APIRouter(prefix="/api/license", tags=["license"])


class LicenseStatusDto(BaseModel):
    has_key: bool
    license_key: str | None
    entitled: bool
    reason: str
    status: str
    checked_at: str | None
    checkout_url: str | None
    can_cancel: bool
    limit_activations: int | None
    can_view_activations: bool


class SetLicenseKeyDto(BaseModel):
    license_key: str | None = None


class CancelResultDto(BaseModel):
    ok: bool
    error: str | None = None


class ActivationCountDto(BaseModel):
    count: int
    limit: int | None


def _to_dto(state, entitlement: entitlements.Entitlement) -> LicenseStatusDto:
    return LicenseStatusDto(
        has_key=bool(state.license_key),
        license_key=state.license_key,
        entitled=entitlement.entitled,
        reason=entitlement.reason,
        status=state.status,
        checked_at=state.checked_at.isoformat() if state.checked_at else None,
        checkout_url=settings.polar_checkout_url,
        can_cancel=bool(state.customer_id),
        limit_activations=state.limit_activations,
        can_view_activations=bool(state.license_key_id),
    )


@router.get("", response_model=LicenseStatusDto)
async def get_license_status(session: AsyncSession = Depends(get_session)) -> LicenseStatusDto:
    """Current cached entitlement — does NOT force a fresh Polar check (that
    only happens on the RECHECK_INTERVAL schedule, or via POST /recheck)."""
    state = await entitlements.get_cached_state(session)
    entitlement = await entitlements.check_entitlement(session)
    return _to_dto(state, entitlement)


@router.put("", response_model=LicenseStatusDto)
async def set_license_key(
    dto: SetLicenseKeyDto,
    session: AsyncSession = Depends(get_session),
) -> LicenseStatusDto:
    """Set (or clear, if license_key is null/empty) the license key for this
    installation, then immediately check it against Polar."""
    key = dto.license_key.strip() if dto.license_key else None
    state = await entitlements.set_license_key(session, key)
    entitlement = await entitlements.check_entitlement(session, force=True) if key else entitlements.Entitlement(
        entitled=False, reason="not_licensed"
    )
    return _to_dto(state, entitlement)


@router.post("/recheck", response_model=LicenseStatusDto)
async def recheck_license(session: AsyncSession = Depends(get_session)) -> LicenseStatusDto:
    """Force an immediate Polar check, bypassing RECHECK_INTERVAL — used by
    the "Retry" action after e.g. freeing an activation slot."""
    state = await entitlements.get_cached_state(session)
    entitlement = await entitlements.check_entitlement(session, force=True)
    return _to_dto(state, entitlement)


@router.post("/cancel", response_model=CancelResultDto)
async def cancel_license(session: AsyncSession = Depends(get_session)) -> CancelResultDto:
    """Cancel the active subscription at period end via Polar. Pro access
    remains active until the period ends — see entitlements.cancel_subscription."""
    try:
        await entitlements.cancel_subscription(session)
    except PolarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return CancelResultDto(ok=True)


@router.get("/activations", response_model=ActivationCountDto)
async def get_activations(session: AsyncSession = Depends(get_session)) -> ActivationCountDto:
    """Live count of devices currently activated against this license key,
    fetched fresh from Polar (not cached) — lets a user notice if their key
    has been activated on a device they don't recognize (shared/leaked)."""
    state = await entitlements.get_cached_state(session)
    try:
        count = await entitlements.get_activation_count(session)
    except PolarError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return ActivationCountDto(count=count, limit=state.limit_activations)
