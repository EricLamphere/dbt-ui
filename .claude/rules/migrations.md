# Database Migrations for dbt-ui

## No Alembic — Idempotent DDL on Startup

All migrations run in `backend/app/db/migrations.py` inside `run_migrations()`, which is called at server startup via `init_db()`. There are no version numbers, no migration files, and no Alembic.

**Every migration must be idempotent** — safe to run on a database that already has the change applied.

## Helper Functions

Two helpers are defined at the top of `migrations.py`:

```python
async def _column_exists(session: AsyncSession, table: str, column: str) -> bool:
    result = await session.execute(text(f"PRAGMA table_info({table})"))
    return any(row[1] == column for row in result.fetchall())

async def _table_exists(session: AsyncSession, table: str) -> bool:
    result = await session.execute(
        text("SELECT name FROM sqlite_master WHERE type='table' AND name=:t"),
        {"t": table},
    )
    return result.scalar_one_or_none() is not None
```

Always use these — never use raw `IF NOT EXISTS` DDL syntax.

## Patterns

### Adding a new column

```python
if not await _column_exists(session, "projects", "my_new_column"):
    await session.execute(
        text("ALTER TABLE projects ADD COLUMN my_new_column TEXT NOT NULL DEFAULT ''")
    )
    await session.commit()
```

### Adding a new table

```python
if not await _table_exists(session, "my_new_table"):
    await session.execute(text(
        "CREATE TABLE my_new_table ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "name TEXT NOT NULL UNIQUE, "
        "created_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
    ))
    await session.commit()
```

### Adding a child table (with FK)

```python
if not await _table_exists(session, "my_new_table_vars"):
    await session.execute(text(
        "CREATE TABLE my_new_table_vars ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "parent_id INTEGER NOT NULL REFERENCES my_new_table(id) ON DELETE CASCADE, "
        "key TEXT NOT NULL, "
        "value TEXT NOT NULL DEFAULT '', "
        "UNIQUE(parent_id, key))"
    ))
    await session.commit()
```

## Rules

- **One commit per migration block** — don't batch multiple DDL statements in one transaction
- **Add new blocks at the bottom** of `run_migrations()`, in chronological order
- **Never drop columns or tables** — SQLite doesn't support DROP COLUMN cleanly; leave old columns orphaned if needed
- **Naming conventions**: tables use `{resource}s` (plural); var/child tables use `{resource}_vars`
- **Always add corresponding SQLAlchemy model** in `backend/app/db/models.py` alongside the migration

## SQLAlchemy Model Conventions

New models go in `backend/app/db/models.py`. Follow the existing pattern:

```python
class MyResource(Base):
    __tablename__ = "my_resources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    vars: Mapped[list["MyResourceVar"]] = relationship(
        back_populates="resource", cascade="all, delete-orphan"
    )

class MyResourceVar(Base):
    __tablename__ = "my_resource_vars"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resource_id: Mapped[int] = mapped_column(ForeignKey("my_resources.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(255))
    value: Mapped[str] = mapped_column(Text, default="")
    resource: Mapped["MyResource"] = relationship(back_populates="vars")
    __table_args__ = (UniqueConstraint("resource_id", "key", name="uq_my_resource_var"),)
```

Use `selectinload` when querying models with relationships to avoid N+1:

```python
result = await session.execute(
    select(MyResource).options(selectinload(MyResource.vars))
)
```
