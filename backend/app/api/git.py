"""Git source-control API — status, diff, stage/unstage, commit, branches, push/pull, log."""
import asyncio
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.engine import get_session
from app.db.models import Project
from app.events.bus import Event, bus
from app.events.sse import sse_response
from app.git.repo import BranchInfo, FileChange, find_repo_root, parse_porcelain_v2
from app.git.runner import GitRequest, git_runner
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["git"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_project(project_id: int, session: AsyncSession) -> Project:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    return project


def _require_repo(project_id: int, project_path: Path) -> Path:
    repo = find_repo_root(project_path)
    if repo is None:
        raise HTTPException(status_code=422, detail="project is not inside a git repository")
    return repo


async def _git(project_id: int, repo_root: Path, *args: str) -> tuple[int, str]:
    req = GitRequest(project_id=project_id, repo_root=repo_root, args=tuple(args))
    return await git_runner.run(req)


async def _publish_status_changed(project_id: int) -> None:
    await bus.publish(Event(
        topic=f"project:{project_id}",
        type="git_status_changed",
        data={},
    ))


# ---------------------------------------------------------------------------
# DTOs
# ---------------------------------------------------------------------------


class FileChangeDto(BaseModel):
    path: str
    index_status: str
    worktree_status: str
    staged: bool
    is_untracked: bool
    is_conflict: bool
    renamed_from: str | None = None


class BranchInfoDto(BaseModel):
    name: str | None
    upstream: str | None
    ahead: int
    behind: int
    oid: str | None


class GitStatusDto(BaseModel):
    repo_root: str
    branch: BranchInfoDto
    changes: list[FileChangeDto]


class DiffDto(BaseModel):
    path: str
    staged: bool
    diff: str


class FileAtHeadDto(BaseModel):
    path: str
    content: str


class PathsDto(BaseModel):
    paths: list[str]


class CommitDto(BaseModel):
    message: str
    amend: bool = False


class BranchDto(BaseModel):
    name: str
    current: bool
    remote: bool
    upstream: str | None = None


class BranchesDto(BaseModel):
    branches: list[BranchDto]


class CreateBranchDto(BaseModel):
    name: str
    from_ref: str | None = None


class CheckoutDto(BaseModel):
    name: str


class CommitLogEntryDto(BaseModel):
    hash: str
    short_hash: str
    author: str
    date: str
    message: str


class CommitLogDto(BaseModel):
    entries: list[CommitLogEntryDto]


class AcceptedDto(BaseModel):
    accepted: bool


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/{project_id}/git/status", response_model=GitStatusDto)
async def get_git_status(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> GitStatusDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    rc, output = await _git(
        project_id, repo,
        "status", "--porcelain=v2", "--branch", "-z",
    )
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git status failed: {output.strip()}")

    branch, changes = parse_porcelain_v2(output)

    def _fc(c: FileChange) -> FileChangeDto:
        return FileChangeDto(
            path=c.path,
            index_status=c.index_status,
            worktree_status=c.worktree_status,
            staged=c.staged,
            is_untracked=c.is_untracked,
            is_conflict=c.is_conflict,
            renamed_from=c.renamed_from,
        )

    def _bi(b: BranchInfo) -> BranchInfoDto:
        return BranchInfoDto(
            name=b.name,
            upstream=b.upstream,
            ahead=b.ahead,
            behind=b.behind,
            oid=b.oid,
        )

    return GitStatusDto(
        repo_root=str(repo),
        branch=_bi(branch),
        changes=[_fc(c) for c in changes],
    )


@router.get("/{project_id}/git/diff", response_model=DiffDto)
async def get_git_diff(
    project_id: int,
    path: str = Query(...),
    staged: bool = Query(False),
    session: AsyncSession = Depends(get_session),
) -> DiffDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    args = ["diff", "--no-color"]
    if staged:
        args.append("--cached")
    args += ["--", path]

    rc, diff_text = await _git(project_id, repo, *args)
    # rc=1 from `git diff` means differences exist — that's fine
    return DiffDto(path=path, staged=staged, diff=diff_text)


@router.get("/{project_id}/git/file-at-head", response_model=FileAtHeadDto)
async def get_file_at_head(
    project_id: int,
    path: str = Query(...),
    session: AsyncSession = Depends(get_session),
) -> FileAtHeadDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    rc, content = await _git(project_id, repo, "show", f"HEAD:{path}")
    if rc != 0:
        # New file not yet in HEAD — return empty string so DiffEditor shows blank original
        content = ""
    return FileAtHeadDto(path=path, content=content)


@router.post("/{project_id}/git/stage", response_model=AcceptedDto)
async def post_stage(
    project_id: int,
    dto: PathsDto,
    session: AsyncSession = Depends(get_session),
) -> AcceptedDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    if not dto.paths:
        return AcceptedDto(accepted=True)
    rc, out = await _git(project_id, repo, "add", "--", *dto.paths)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git add failed: {out.strip()}")
    await _publish_status_changed(project_id)
    return AcceptedDto(accepted=True)


@router.post("/{project_id}/git/unstage", response_model=AcceptedDto)
async def post_unstage(
    project_id: int,
    dto: PathsDto,
    session: AsyncSession = Depends(get_session),
) -> AcceptedDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    if not dto.paths:
        return AcceptedDto(accepted=True)
    rc, out = await _git(project_id, repo, "restore", "--staged", "--", *dto.paths)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git restore --staged failed: {out.strip()}")
    await _publish_status_changed(project_id)
    return AcceptedDto(accepted=True)


@router.post("/{project_id}/git/discard", response_model=AcceptedDto)
async def post_discard(
    project_id: int,
    dto: PathsDto,
    session: AsyncSession = Depends(get_session),
) -> AcceptedDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    if not dto.paths:
        return AcceptedDto(accepted=True)
    rc, out = await _git(project_id, repo, "restore", "--", *dto.paths)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git restore failed: {out.strip()}")
    await _publish_status_changed(project_id)
    return AcceptedDto(accepted=True)


@router.post("/{project_id}/git/delete-new", response_model=AcceptedDto)
async def post_delete_new(
    project_id: int,
    dto: PathsDto,
    session: AsyncSession = Depends(get_session),
) -> AcceptedDto:
    """Delete untracked (new) files from the working tree via git clean."""
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    if not dto.paths:
        return AcceptedDto(accepted=True)
    rc, out = await _git(project_id, repo, "clean", "-f", "--", *dto.paths)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git clean failed: {out.strip()}")
    await _publish_status_changed(project_id)
    return AcceptedDto(accepted=True)


@router.post("/{project_id}/git/commit", response_model=AcceptedDto)
async def post_commit(
    project_id: int,
    dto: CommitDto,
    session: AsyncSession = Depends(get_session),
) -> AcceptedDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    args = ["commit", "-m", dto.message]
    if dto.amend:
        args.append("--amend")
    rc, out = await _git(project_id, repo, *args)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git commit failed: {out.strip()}")
    await _publish_status_changed(project_id)
    return AcceptedDto(accepted=True)


@router.get("/{project_id}/git/branches", response_model=BranchesDto)
async def get_branches(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> BranchesDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    rc, out = await _git(
        project_id, repo,
        "branch", "--format=%(HEAD)|%(refname:short)|%(upstream:short)|%(if)%(HEAD)%(then)current%(end)",
    )
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git branch failed: {out.strip()}")

    rc2, out2 = await _git(
        project_id, repo,
        "branch", "-r", "--format=%(refname:short)|%(upstream:short)",
    )

    branches: list[BranchDto] = []
    seen: set[str] = set()
    for line in out.splitlines():
        parts = line.split("|")
        if len(parts) < 2:
            continue
        is_current = parts[0].strip() == "*"
        name = parts[1].strip()
        upstream = parts[2].strip() if len(parts) > 2 and parts[2].strip() else None
        if name and name not in seen:
            seen.add(name)
            branches.append(BranchDto(name=name, current=is_current, remote=False, upstream=upstream))

    for line in out2.splitlines():
        parts = line.split("|")
        name = parts[0].strip()
        if name and name not in seen:
            seen.add(name)
            branches.append(BranchDto(name=name, current=False, remote=True))

    return BranchesDto(branches=branches)


@router.post("/{project_id}/git/branches", response_model=AcceptedDto)
async def create_branch(
    project_id: int,
    dto: CreateBranchDto,
    session: AsyncSession = Depends(get_session),
) -> AcceptedDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    args = ["branch", dto.name]
    if dto.from_ref:
        args.append(dto.from_ref)
    rc, out = await _git(project_id, repo, *args)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git branch failed: {out.strip()}")
    return AcceptedDto(accepted=True)


@router.post("/{project_id}/git/checkout", response_model=AcceptedDto)
async def post_checkout(
    project_id: int,
    dto: CheckoutDto,
    session: AsyncSession = Depends(get_session),
) -> AcceptedDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    rc, out = await _git(project_id, repo, "checkout", dto.name)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git checkout failed: {out.strip()}")
    await _publish_status_changed(project_id)
    return AcceptedDto(accepted=True)


@router.post("/{project_id}/git/pull")
async def post_pull(
    project_id: int,
    session: AsyncSession = Depends(get_session),
):
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    req = GitRequest(
        project_id=project_id,
        repo_root=repo,
        args=("pull", "--no-rebase"),
    )

    async def _run():
        async for _ in git_runner.stream(req):
            pass
        await _publish_status_changed(project_id)

    asyncio.create_task(_run())
    return sse_response(f"project:{project_id}")


@router.post("/{project_id}/git/push")
async def post_push(
    project_id: int,
    session: AsyncSession = Depends(get_session),
):
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    req = GitRequest(
        project_id=project_id,
        repo_root=repo,
        args=("push",),
    )

    async def _run():
        async for _ in git_runner.stream(req):
            pass
        await _publish_status_changed(project_id)

    asyncio.create_task(_run())
    return sse_response(f"project:{project_id}")


@router.get("/{project_id}/git/log", response_model=CommitLogDto)
async def get_git_log(
    project_id: int,
    path: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
) -> CommitLogDto:
    project = await _get_project(project_id, session)
    repo = _require_repo(project_id, Path(project.path))

    fmt = "%H%x1f%h%x1f%an%x1f%ai%x1f%s"
    args = ["log", f"--pretty=format:{fmt}", f"--max-count={limit}"]
    if path:
        args += ["--", path]

    rc, out = await _git(project_id, repo, *args)
    if rc != 0:
        raise HTTPException(status_code=500, detail=f"git log failed: {out.strip()}")

    entries: list[CommitLogEntryDto] = []
    for line in out.splitlines():
        parts = line.split("\x1f", 4)
        if len(parts) == 5:
            entries.append(CommitLogEntryDto(
                hash=parts[0],
                short_hash=parts[1],
                author=parts[2],
                date=parts[3],
                message=parts[4],
            ))

    return CommitLogDto(entries=entries)
