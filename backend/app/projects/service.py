from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AppSetting, Project
from app.projects.discovery import DiscoveredProject, discover_projects
from app.config import settings


async def _effective_workspace(session: AsyncSession) -> Path | None:
    """Return the effective workspace path, or None if not configured."""
    row = await session.get(AppSetting, "dbt_projects_path")
    if row is not None and row.value:
        return Path(row.value)
    if settings.dbt_projects_path is not None:
        return settings.dbt_projects_path
    return None


async def list_projects(session: AsyncSession) -> list[Project]:
    result = await session.execute(select(Project).order_by(Project.name))
    return list(result.scalars().all())


async def rescan_projects(session: AsyncSession) -> list[Project]:
    workspace = await _effective_workspace(session)
    if workspace is None:
        return await list_projects(session)
    discovered: list[DiscoveredProject] = discover_projects(workspace)
    existing = await list_projects(session)
    by_path = {p.path: p for p in existing}

    seen_paths: set[str] = set()
    for dp in discovered:
        key = str(dp.path)
        seen_paths.add(key)
        row = by_path.get(key)
        if row is None:
            row = Project(
                name=dp.name,
                path=key,
                platform=dp.platform,
                profile=dp.profile,
            )
            session.add(row)
        else:
            row.name = dp.name
            row.platform = dp.platform
            row.profile = dp.profile

    for path, row in by_path.items():
        if path not in seen_paths:
            await session.delete(row)

    await session.commit()
    return await list_projects(session)
