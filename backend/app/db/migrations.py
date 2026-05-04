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
        if not await _table_exists(session, "global_profiles"):
            await session.execute(text(
                "CREATE TABLE global_profiles ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "name TEXT NOT NULL UNIQUE, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            ))
            await session.commit()
        if not await _table_exists(session, "global_profile_vars"):
            await session.execute(text(
                "CREATE TABLE global_profile_vars ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "profile_id INTEGER NOT NULL REFERENCES global_profiles(id) ON DELETE CASCADE, "
                "key TEXT NOT NULL, "
                "value TEXT NOT NULL DEFAULT '', "
                "UNIQUE(profile_id, key))"
            ))
            await session.commit()


        if not await _table_exists(session, "drift_snapshots"):
            await session.execute(text(
                "CREATE TABLE drift_snapshots ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
                "started_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "finished_at DATETIME, "
                "status TEXT NOT NULL DEFAULT 'running', "
                "target TEXT, "
                "total_models INTEGER NOT NULL DEFAULT 0, "
                "checked_models INTEGER NOT NULL DEFAULT 0, "
                "results_json TEXT NOT NULL DEFAULT '[]', "
                "error_message TEXT)"
            ))
            await session.commit()

        # Reset any snapshots that were left in 'running' state from a previous server process
        await session.execute(
            text(
                "UPDATE drift_snapshots SET status = 'error', error_message = 'interrupted by server restart'"
                " WHERE status = 'running'"
            )
        )
        await session.commit()

        if not await _table_exists(session, "freshness_snapshots"):
            await session.execute(text(
                "CREATE TABLE freshness_snapshots ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
                "started_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "finished_at DATETIME, "
                "status TEXT NOT NULL DEFAULT 'running', "
                "target TEXT, "
                "results_json TEXT NOT NULL DEFAULT '[]', "
                "error_message TEXT)"
            ))
            await session.commit()

        # Reset any freshness snapshots left running from a crashed server process
        await session.execute(
            text(
                "UPDATE freshness_snapshots SET status = 'error', error_message = 'interrupted by server restart'"
                " WHERE status = 'running'"
            )
        )
        await session.commit()


async def init_db() -> None:
    await ensure_db_initialized()
    await run_migrations()
