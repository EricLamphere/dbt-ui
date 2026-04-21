"""File explorer API — directory listing and file read/write within a project."""
import shutil
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project

router = APIRouter(prefix="/api/projects", tags=["files"])

# File extensions that are safe to read/write as text
TEXT_EXTENSIONS = {
    ".sql", ".yml", ".yaml", ".md", ".txt", ".toml", ".ini",
    ".json", ".csv", ".py", ".sh", ".env", ".gitignore",
}

# Directories that should never appear in the tree
HIDDEN_DIRS = {"__pycache__", ".git", "node_modules", "dbt_packages", "logs", ".venv", "venv"}


class FileNode(BaseModel):
    name: str
    path: str        # relative to project root
    is_dir: bool
    children: list["FileNode"] | None = None  # None means not expanded


class FileContentDto(BaseModel):
    path: str
    content: str
    language: str    # sql | yaml | markdown | json | python | shell | text


class FileWriteDto(BaseModel):
    content: str


class RenameDto(BaseModel):
    new_name: str   # just the new filename, not a full path


class NewFileDto(BaseModel):
    name: str       # filename (no path separators) — relative to dir_path
    dir_path: str   # directory to create the file in (relative to project root)
    is_dir: bool = False


def _rel(project_root: Path, p: Path) -> str:
    return str(p.relative_to(project_root))


def _safe_path(project: Project, rel_path: str) -> Path:
    """Resolve a relative path and ensure it stays within the project root."""
    root = Path(project.path).resolve()
    candidate = (root / rel_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="path escapes project root")
    return candidate


def _language(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".sql": "sql",
        ".yml": "yaml",
        ".yaml": "yaml",
        ".md": "markdown",
        ".json": "json",
        ".py": "python",
        ".sh": "shell",
        ".toml": "ini",
    }.get(suffix, "plaintext")


def _build_tree(root: Path, current: Path, depth: int = 0) -> list[FileNode]:
    if depth > 8:
        return []
    nodes: list[FileNode] = []
    try:
        entries = sorted(current.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return []
    for entry in entries:
        if entry.is_dir() and entry.name in HIDDEN_DIRS:
            continue
        rel = _rel(root, entry)
        if entry.is_dir():
            nodes.append(FileNode(name=entry.name, path=rel, is_dir=True, children=None))
        elif entry.suffix.lower() in TEXT_EXTENSIONS:
            nodes.append(FileNode(name=entry.name, path=rel, is_dir=False))
    return nodes


@router.get("/{project_id}/files", response_model=list[FileNode])
async def list_files(
    project_id: int,
    path: str = "",
    session: AsyncSession = Depends(get_session),
) -> list[FileNode]:
    """List directory contents one level deep. `path` is relative to project root."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    root = Path(project.path).resolve()
    target = _safe_path(project, path) if path else root
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="not a directory")
    return _build_tree(root, target)


@router.get("/{project_id}/files/content", response_model=FileContentDto)
async def get_file(
    project_id: int,
    path: str,
    session: AsyncSession = Depends(get_session),
) -> FileContentDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    file_path = _safe_path(project, path)
    if not file_path.is_file():
        raise HTTPException(status_code=404, detail="file not found")
    if file_path.suffix.lower() not in TEXT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="binary file")
    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise HTTPException(status_code=500, detail=str(e))
    return FileContentDto(path=path, content=content, language=_language(file_path))


@router.put("/{project_id}/files/content", response_model=FileContentDto)
async def put_file(
    project_id: int,
    path: str,
    dto: FileWriteDto,
    session: AsyncSession = Depends(get_session),
) -> FileContentDto:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    file_path = _safe_path(project, path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="file not found")
    if file_path.suffix.lower() not in TEXT_EXTENSIONS:
        raise HTTPException(status_code=400, detail="binary file")
    file_path.write_text(dto.content, encoding="utf-8")
    return FileContentDto(path=path, content=dto.content, language=_language(file_path))


@router.post("/{project_id}/files/new", response_model=FileNode, status_code=201)
async def new_file(
    project_id: int,
    dto: NewFileDto,
    session: AsyncSession = Depends(get_session),
) -> FileNode:
    """Create a new file or directory."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if "/" in dto.name or "\\" in dto.name:
        raise HTTPException(status_code=422, detail="name must not contain path separators")
    root = Path(project.path).resolve()
    dir_path = _safe_path(project, dto.dir_path) if dto.dir_path else root
    if not dir_path.is_dir():
        raise HTTPException(status_code=400, detail="parent directory not found")
    target = (dir_path / dto.name).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="path escapes project root")
    if target.exists():
        raise HTTPException(status_code=409, detail=f"'{dto.name}' already exists")
    if dto.is_dir:
        target.mkdir(parents=False, exist_ok=False)
    else:
        target.touch()
    rel = _rel(root, target)
    return FileNode(name=target.name, path=rel, is_dir=dto.is_dir)


@router.post("/{project_id}/files/rename", response_model=FileNode)
async def rename_file(
    project_id: int,
    path: str,
    dto: RenameDto,
    session: AsyncSession = Depends(get_session),
) -> FileNode:
    """Rename a file or directory (stays in the same parent directory)."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    if "/" in dto.new_name or "\\" in dto.new_name:
        raise HTTPException(status_code=422, detail="new_name must not contain path separators")
    root = Path(project.path).resolve()
    src = _safe_path(project, path)
    if not src.exists():
        raise HTTPException(status_code=404, detail="path not found")
    dst = (src.parent / dto.new_name).resolve()
    try:
        dst.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="path escapes project root")
    if dst.exists():
        raise HTTPException(status_code=409, detail=f"'{dto.new_name}' already exists")
    src.rename(dst)
    rel = _rel(root, dst)
    return FileNode(name=dst.name, path=rel, is_dir=dst.is_dir())


@router.delete("/{project_id}/files", status_code=204)
async def delete_file(
    project_id: int,
    path: str,
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a file or directory (directories deleted recursively)."""
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    target = _safe_path(project, path)
    if not target.exists():
        raise HTTPException(status_code=404, detail="path not found")
    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()
