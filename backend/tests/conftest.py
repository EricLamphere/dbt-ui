"""
Shared pytest fixtures that wire up a fresh in-memory SQLite DB per test
and patch the FastAPI dependency so every test gets a clean slate.
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.db.models import Base
from app.db.engine import get_session
from app.main import app


@pytest.fixture(autouse=True)
async def override_db():
    """Create a fresh in-memory DB, wire it into FastAPI DI, tear down after."""
    test_engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    TestSessionLocal = async_sessionmaker(
        test_engine, expire_on_commit=False, class_=AsyncSession
    )

    async def _get_test_session():
        async with TestSessionLocal() as session:
            yield session

    app.dependency_overrides[get_session] = _get_test_session

    yield

    app.dependency_overrides.pop(get_session, None)
    await test_engine.dispose()
