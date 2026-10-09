"""Collect the files changed in a repo — uncommitted, or on a branch vs. a base.

All git calls go through a ``GitCall`` (the API passes one bound to
``git_runner`` for the project), so this module stays free of HTTP concerns.
Paths come back repo-relative; ``to_project_files`` narrows them to one dbt
project inside the repo.
"""
from __future__ import annotations

import re
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass

from app.dbt.changes import ChangedFile, ChangeKind
from app.git.repo import FileChange, parse_name_status_z, parse_porcelain_v2

GitCall = Callable[..., Awaitable[tuple[int, str]]]

# Tried in order when no base is given (after origin/HEAD).
DEFAULT_BASE_CANDIDATES = ("main", "master", "origin/main", "origin/master")

# Branch/ref names only — rejects option-looking values and whitespace.
_SAFE_REF = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@{}^~-]*$")


class ChangeSetError(Exception):
    """A user-correctable problem (bad base ref, no merge base, git failure)."""


@dataclass(frozen=True)
class RepoChange:
    path: str  # repo-relative
    change: ChangeKind


def _kind_from_status(c: FileChange) -> ChangeKind:
    if c.is_untracked or c.index_status == "A":
        return "added"
    if "D" in (c.index_status, c.worktree_status):
        return "deleted"
    if c.renamed_from:
        return "renamed"
    return "modified"


def _kind_from_letter(letter: str) -> ChangeKind:
    return {"A": "added", "D": "deleted"}.get(letter, "modified")  # type: ignore[return-value]


def _dedupe(changes: Iterable[RepoChange]) -> list[RepoChange]:
    seen: dict[str, RepoChange] = {}
    for c in changes:
        seen.setdefault(c.path, c)
    return list(seen.values())


async def _status(git: GitCall) -> list[FileChange]:
    rc, out = await git("status", "--porcelain=v2", "-z", "--untracked-files=all")
    if rc != 0:
        raise ChangeSetError(f"git status failed: {out.strip()}")
    _, changes = parse_porcelain_v2(out)
    return changes


async def working_changes(git: GitCall) -> list[RepoChange]:
    """Staged, unstaged and untracked changes. A rename also reports its old path as deleted."""
    result: list[RepoChange] = []
    for c in await _status(git):
        result.append(RepoChange(c.path, _kind_from_status(c)))
        if c.renamed_from:
            result.append(RepoChange(c.renamed_from, "deleted"))
    return _dedupe(result)


async def current_branch(git: GitCall) -> str | None:
    rc, out = await git("rev-parse", "--abbrev-ref", "HEAD")
    name = out.strip()
    return name if rc == 0 and name and name != "HEAD" else None


async def _ref_exists(git: GitCall, ref: str) -> bool:
    rc, _ = await git("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}")
    return rc == 0


async def resolve_base(git: GitCall, requested: str | None) -> str:
    """The requested base if valid, else origin/HEAD's target, else main/master."""
    if requested:
        if not _SAFE_REF.match(requested) or not await _ref_exists(git, requested):
            raise ChangeSetError(f"Unknown base ref: {requested!r}")
        return requested

    rc, out = await git("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD")
    candidates = ([out.strip()] if rc == 0 and out.strip() else []) + list(DEFAULT_BASE_CANDIDATES)
    for ref in candidates:
        if _SAFE_REF.match(ref) and await _ref_exists(git, ref):
            return ref
    raise ChangeSetError("Couldn't find a base branch (main/master); pick one to compare against")


async def branch_changes(git: GitCall, base: str) -> tuple[str, list[RepoChange]]:
    """Everything that differs from the merge base with ``base`` — commits, staged,
    unstaged and untracked. Returns (merge base sha, changes)."""
    rc, out = await git("merge-base", base, "HEAD")
    merge_base = out.strip()
    if rc != 0 or not merge_base:
        raise ChangeSetError(f"No common history between {base!r} and HEAD")

    rc, diff_out = await git("diff", "--name-status", "-z", "--no-renames", merge_base, "--")
    if rc != 0:
        raise ChangeSetError(f"git diff failed: {diff_out.strip()}")
    committed = [RepoChange(path, _kind_from_letter(letter)) for letter, path in parse_name_status_z(diff_out)]
    untracked = [RepoChange(c.path, "added") for c in await _status(git) if c.is_untracked]
    return merge_base, _dedupe([*committed, *untracked])


def to_project_files(changes: Iterable[RepoChange], project_subpath: str) -> list[ChangedFile]:
    """Keep changes inside the project directory, with paths relative to it."""
    prefix = f"{project_subpath.strip('/')}/" if project_subpath.strip("/") else ""
    return [
        ChangedFile(c.path[len(prefix):], c.change)
        for c in changes
        if c.path.startswith(prefix)
    ]
