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

        if not await _column_exists(session, "projects", "pinned"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
            )
            await session.commit()

        if not await _column_exists(session, "projects", "last_opened_at"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN last_opened_at DATETIME")
            )
            await session.commit()

        # Migrate old default 'init' to '' (empty = use runtime default 'dbtui/init')
        await session.execute(
            text("UPDATE projects SET init_script_path = '' WHERE init_script_path = 'init'")
        )
        await session.commit()

        if not await _column_exists(session, "init_steps", "captured_vars"):
            await session.execute(
                text("ALTER TABLE init_steps ADD COLUMN captured_vars TEXT NOT NULL DEFAULT ''")
            )
            await session.commit()

        if not await _table_exists(session, "run_invocations"):
            await session.execute(text(
                "CREATE TABLE run_invocations ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
                "command TEXT NOT NULL, "
                "selector TEXT, "
                "status TEXT NOT NULL DEFAULT 'pending', "
                "log_path TEXT, "
                "started_at DATETIME, "
                "finished_at DATETIME)"
            ))
            await session.commit()

        if not await _column_exists(session, "model_statuses", "execution_time"):
            await session.execute(
                text("ALTER TABLE model_statuses ADD COLUMN execution_time REAL")
            )
            await session.commit()

        if not await _column_exists(session, "model_statuses", "invocation_id"):
            await session.execute(
                text(
                    "ALTER TABLE model_statuses ADD COLUMN invocation_id INTEGER"
                    " REFERENCES run_invocations(id) ON DELETE SET NULL"
                )
            )
            await session.commit()

        # Reset any run invocations left in running/pending state from a crashed server process
        await session.execute(
            text(
                "UPDATE run_invocations SET status = 'error'"
                " WHERE status IN ('running', 'pending')"
            )
        )
        await session.commit()

        # Per-invocation per-node result history (replaces overwriting model_statuses)
        if not await _table_exists(session, "invocation_model_results"):
            await session.execute(text(
                "CREATE TABLE invocation_model_results ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "invocation_id INTEGER NOT NULL REFERENCES run_invocations(id) ON DELETE CASCADE, "
                "project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
                "unique_id TEXT NOT NULL, "
                "name TEXT NOT NULL, "
                "kind TEXT NOT NULL, "
                "status TEXT NOT NULL, "
                "execution_time REAL, "
                "message TEXT)"
            ))
            await session.commit()
            await session.execute(text(
                "CREATE INDEX idx_imr_invocation ON invocation_model_results(invocation_id)"
            ))
            await session.execute(text(
                "CREATE INDEX idx_imr_project_uid ON invocation_model_results(project_id, unique_id)"
            ))
            await session.commit()

        if not await _column_exists(session, "run_invocations", "cli_command"):
            await session.execute(
                text("ALTER TABLE run_invocations ADD COLUMN cli_command TEXT")
            )
            await session.commit()

        if not await _column_exists(session, "run_invocations", "profile"):
            await session.execute(
                text("ALTER TABLE run_invocations ADD COLUMN profile TEXT")
            )
            await session.commit()

        if not await _column_exists(session, "run_invocations", "target"):
            await session.execute(
                text("ALTER TABLE run_invocations ADD COLUMN target TEXT")
            )
            await session.commit()

        if not await _column_exists(session, "projects", "pin_order"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN pin_order INTEGER")
            )
            await session.commit()

        if not await _column_exists(session, "projects", "last_init_status"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN last_init_status TEXT NOT NULL DEFAULT 'idle'")
            )
            await session.commit()

        if not await _column_exists(session, "projects", "last_init_started_at"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN last_init_started_at DATETIME")
            )
            await session.commit()

        if not await _column_exists(session, "projects", "last_init_finished_at"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN last_init_finished_at DATETIME")
            )
            await session.commit()

        if not await _column_exists(session, "projects", "last_init_failed_step"):
            await session.execute(
                text("ALTER TABLE projects ADD COLUMN last_init_failed_step TEXT")
            )
            await session.commit()

        if not await _column_exists(session, "init_steps", "last_status"):
            await session.execute(
                text("ALTER TABLE init_steps ADD COLUMN last_status TEXT NOT NULL DEFAULT 'idle'")
            )
            await session.commit()

        if not await _column_exists(session, "init_steps", "last_started_at"):
            await session.execute(
                text("ALTER TABLE init_steps ADD COLUMN last_started_at DATETIME")
            )
            await session.commit()

        if not await _column_exists(session, "init_steps", "last_finished_at"):
            await session.execute(
                text("ALTER TABLE init_steps ADD COLUMN last_finished_at DATETIME")
            )
            await session.commit()

        if not await _column_exists(session, "init_steps", "last_log"):
            await session.execute(
                text("ALTER TABLE init_steps ADD COLUMN last_log TEXT NOT NULL DEFAULT ''")
            )
            await session.commit()

        # Reset any init runs left in 'running' state from a previous server process
        await session.execute(
            text(
                "UPDATE projects SET last_init_status = 'error',"
                " last_init_failed_step = COALESCE(last_init_failed_step, 'interrupted by server restart')"
                " WHERE last_init_status = 'running'"
            )
        )
        await session.commit()

        await session.execute(
            text("UPDATE init_steps SET last_status = 'error' WHERE last_status = 'running'")
        )
        await session.commit()

        if not await _table_exists(session, "column_lineage_snapshots"):
            await session.execute(text(
                "CREATE TABLE column_lineage_snapshots ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, "
                "project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE, "
                "started_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "finished_at DATETIME, "
                "status TEXT NOT NULL DEFAULT 'running', "
                "total_models INTEGER NOT NULL DEFAULT 0, "
                "checked_models INTEGER NOT NULL DEFAULT 0, "
                "results_json TEXT NOT NULL DEFAULT '{}', "
                "error_message TEXT, "
                "manifest_mtime REAL NOT NULL DEFAULT 0)"
            ))
            await session.commit()

        # Reset any column lineage scans left running from a crashed server process
        await session.execute(
            text(
                "UPDATE column_lineage_snapshots SET status = 'error',"
                " error_message = 'interrupted by server restart'"
                " WHERE status = 'running'"
            )
        )
        await session.commit()

        # One-time fixup: a bug in _sync_steps_from_disk (fixed in code) could
        # assign a newly-appearing base step (e.g. "base: pip install", which
        # only appears once REQUIREMENTS_PATH is set) the same `order` value
        # as an unrelated pre-existing step, since the old counter advanced
        # once per BASE_STEPS entry *visited* rather than being derived from
        # order values actually already in use. Duplicate orders made
        # ORDER BY init_steps.order non-deterministic across identical
        # queries, which surfaced as steps silently reordering themselves
        # and drag-and-drop reordering appearing broken. Renumber, per
        # project, using each row's existing (order, id) as the stable sort
        # key — this only breaks ties; it never changes the relative order
        # of two rows that already had distinct order values, so a real
        # user-driven reorder from before this fixup is preserved.
        if await _table_exists(session, "init_steps"):
            result = await session.execute(
                text('SELECT id, project_id, "order" FROM init_steps ORDER BY project_id, "order", id')
            )
            rows = result.fetchall()
            by_project: dict[int, list[tuple[int, int]]] = {}
            for row_id, project_id, order in rows:
                by_project.setdefault(project_id, []).append((row_id, order))
            for project_id, project_rows in by_project.items():
                has_collision = len({order for _, order in project_rows}) != len(project_rows)
                if not has_collision:
                    continue
                for new_order, (row_id, _old_order) in enumerate(project_rows):
                    await session.execute(
                        text('UPDATE init_steps SET "order" = :new_order WHERE id = :row_id'),
                        {"new_order": new_order, "row_id": row_id},
                    )
            await session.commit()


async def init_db() -> None:
    await ensure_db_initialized()
    await run_migrations()
