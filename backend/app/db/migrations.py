from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import SessionLocal, ensure_db_initialized


async def _column_exists(session: AsyncSession, table: str, column: str) -> bool:
    result = await session.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result.fetchall())


async def _table_exists(session: AsyncSession, table: str) -> bool:
    result = await session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
        {"t": table},
    )
    return result.scalar_one_or_none() is not None


async def run_migrations() -> None:
    await ensure_db_initialized()
    async with SessionLocal() as session:
        if not await _column_exists(session, "projects", "init_script_path"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN init_script_path TEXT NOT NULL DEFAULT 'init'")
            )
            await session.commit()
        if not await _table_exists(session, "app_settings"):
            await session.execute(
                text("CREATE TABLE app_settings (key TEXT NOT NULL PRIMARY KEY, value TEXT NOT NULL DEFAULT '')")
            )
            await session.commit()
        if not await _column_exists(session, "projects", "ignored"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN ignored INTEGER NOT NULL DEFAULT 0")
            )
            await session.commit()


async def init_db() -> None:
    await ensure_db_initialized()
    await run_migrations()
