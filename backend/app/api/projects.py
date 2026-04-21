import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.engine import get_session
from app.db.models import Project
from app.projects.service import list_projects, rescan_projects

router = APIRouter(prefix="/api/projects", tags=["projects"])

_README_NAMES = ("README.md", "README.mdx", "readme.md", "readme.mdx", "README.rst", "README.txt")


def _read_readme(project_path: str) -> str | None:
    root = Path(project_path)
    for name in _README_NAMES:
        candidate = root / name
        if candidate.is_file():
            try:
                return candidate.read_text(encoding="utf-8", errors="replace")
            except OSError:
                return None
    return None


class ProjectOut(BaseModel):
    id: int
    name: str
    path: str
    platform: str
    profile: str | None
    vscode_cmd: str | None
    init_script_path: str = "init"
    readme: str | None = None

    @classmethod
    def from_row(cls, row: Project, include_readme: bool = False) -> "ProjectOut":
        return cls(
            id=row.id,
            name=row.name,
            path=row.path,
            platform=row.platform,
            profile=row.profile,
            vscode_cmd=row.vscode_cmd,
            init_script_path=row.init_script_path,
            readme=_read_readme(row.path) if include_readme else None,
        )


@router.get("", response_model=list[ProjectOut])
async def get_projects(session: AsyncSession = Depends(get_session)) -> list[ProjectOut]:
    rows = await list_projects(session)
    if not rows:
        rows = await rescan_projects(session)
    return [ProjectOut.from_row(r) for r in rows]


@router.post("/rescan", response_model=list[ProjectOut])
async def post_rescan(session: AsyncSession = Depends(get_session)) -> list[ProjectOut]:
    rows = await rescan_projects(session)
    return [ProjectOut.from_row(r) for r in rows]


@router.get("/applications", response_model=list[str])
async def list_applications() -> list[str]:
    """Return names of installed .app bundles from /Applications and ~/Applications."""
    search_dirs = [Path("/Applications"), Path.home() / "Applications"]
    seen: set[str] = set()
    for apps_dir in search_dirs:
        if not apps_dir.is_dir():
            continue
        try:
            for p in apps_dir.iterdir():
                if p.suffix == ".app":
                    seen.add(p.stem)
        except OSError:
            continue
    return sorted(seen)


class OpenInAppDto(BaseModel):
    app_name: str
    path: str


@router.post("/open-in-app")
async def open_in_app(dto: OpenInAppDto) -> dict[str, bool]:
    """Open a path in the given macOS application using `open -a`."""
    # Validate path is absolute and exists
    target = Path(dto.path)
    if not target.exists():
        raise HTTPException(status_code=400, detail="path does not exist")
    # Sanitize app_name — only allow .app stem names (no slashes etc)
    app_name = dto.app_name.strip()
    if "/" in app_name or "\\" in app_name or not app_name:
        raise HTTPException(status_code=400, detail="invalid app name")
    subprocess.Popen(["open", "-a", app_name, str(target)])
    return {"ok": True}


@router.get("/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: int, session: AsyncSession = Depends(get_session)
) -> ProjectOut:
    row = await session.get(Project, project_id)
    if row is None:
        raise HTTPException(status_code=404, detail="project not found")
    return ProjectOut.from_row(row, include_readme=True)


@router.get("/by-path/{path:path}", response_model=ProjectOut)
async def get_project_by_path(
    path: str, session: AsyncSession = Depends(get_session)
) -> ProjectOut:
    result = await session.execute(select(Project).where(Project.path == f"/{path}"))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="project not found")
    return ProjectOut.from_row(row)


class ProjectSettingsDto(BaseModel):
    init_script_path: str


@router.patch("/{project_id}/settings", response_model=ProjectOut)
async def patch_project_settings(
    project_id: int,
    dto: ProjectSettingsDto,
    session: AsyncSession = Depends(get_session),
) -> ProjectOut:
    row = await session.get(Project, project_id)
    if row is None:
        raise HTTPException(status_code=404, detail="project not found")
    if not dto.init_script_path or "/" in dto.init_script_path or dto.init_script_path.startswith("."):
        raise HTTPException(status_code=400, detail="invalid init_script_path")
    row.init_script_path = dto.init_script_path
    await session.commit()
    await session.refresh(row)
    return ProjectOut.from_row(row)
