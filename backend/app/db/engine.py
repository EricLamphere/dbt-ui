import asyncio
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings

# Ensure data dir exists before building the URL (SQLite needs the directory).
settings.data_dir.mkdir(parents=True, exist_ok=True)

engine = create_async_engine(settings.resolved_database_url(), future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)

_db_initialized = False
_init_lock = asyncio.Lock()


async def ensure_db_initialized() -> None:
    """Idempotently run create_all. Called from lifespan AND from get_session
    as a safety net so first requests never fail with 'no such table'."""
    global _db_initialized
    if _db_initialized:
        return
    async with _init_lock:
        if _db_initialized:
            return
        from app.db.models import Base
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        _db_initialized = True


async def get_session() -> AsyncIterator[AsyncSession]:
    await ensure_db_initialized()
    async with SessionLocal() as session:
        yield session
