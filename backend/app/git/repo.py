from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass
class FileChange:
    path: str
    index_status: str   # single char: M A D R C U ? !
    worktree_status: str
    renamed_from: str | None = None
    is_conflict: bool = False

    @property
    def staged(self) -> bool:
        return self.index_status not in (".", "?", "!")

    @property
    def is_untracked(self) -> bool:
        return self.index_status == "?" and self.worktree_status == "?"


@dataclass
class BranchInfo:
    name: str | None        # None when HEAD is detached
    upstream: str | None
    ahead: int
    behind: int
    oid: str | None         # current commit hash


def find_repo_root(start: Path) -> Path | None:
    """Walk upward from start looking for a .git directory or file."""
    current = start.resolve()
    while True:
        if (current / ".git").exists():
            return current
        parent = current.parent
        if parent == current:
            return None
        current = parent


def parse_porcelain_v2(output: str) -> tuple[BranchInfo, list[FileChange]]:
    """Parse `git status --porcelain=v2 --branch` output into structured data.

    Uses NUL-delimited output (`-z` flag) so paths with spaces work.
    """
    branch = BranchInfo(name=None, upstream=None, ahead=0, behind=0, oid=None)
    changes: list[FileChange] = []

    # Split on NUL; porcelain v2 -z uses NUL as record separator (renames get two fields)
    tokens = output.split("\0")
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if not token:
            i += 1
            continue

        if token.startswith("# branch.head "):
            val = token[len("# branch.head "):]
            branch.name = None if val == "(detached)" else val
        elif token.startswith("# branch.upstream "):
            branch.upstream = token[len("# branch.upstream "):]
        elif token.startswith("# branch.ab "):
            parts = token[len("# branch.ab "):].split()
            if len(parts) == 2:
                branch.ahead = abs(int(parts[0]))
                branch.behind = abs(int(parts[1]))
        elif token.startswith("# branch.oid "):
            oid = token[len("# branch.oid "):]
            branch.oid = None if oid == "(initial)" else oid

        elif token.startswith("1 "):
            # ordinary changed entry: "1 XY sub mH mI mW hH hI path"
            parts = token.split(" ", 8)
            xy = parts[1] if len(parts) > 1 else ".."
            path = parts[8] if len(parts) > 8 else ""
            ix, wt = (xy[0], xy[1]) if len(xy) >= 2 else (".", ".")
            conflict = ix == "U" or wt == "U" or (ix == "A" and wt == "A") or (ix == "D" and wt == "D")
            changes.append(FileChange(
                path=path,
                index_status=ix,
                worktree_status=wt,
                is_conflict=conflict,
            ))

        elif token.startswith("2 "):
            # renamed/copied entry: "2 XY sub mH mI mW hH hI X score path\0origPath"
            parts = token.split(" ", 9)
            xy = parts[1] if len(parts) > 1 else ".."
            path = parts[9] if len(parts) > 9 else ""
            ix, wt = (xy[0], xy[1]) if len(xy) >= 2 else (".", ".")
            # The original path is the next NUL-delimited token
            orig = tokens[i + 1] if i + 1 < len(tokens) else None
            i += 1  # consume the extra token
            changes.append(FileChange(
                path=path,
                index_status=ix,
                worktree_status=wt,
                renamed_from=orig,
            ))

        elif token.startswith("u "):
            # unmerged entry: "u XY sub m1 m2 m3 mW h1 h2 h3 path"
            parts = token.split(" ", 10)
            xy = parts[1] if len(parts) > 1 else ".."
            path = parts[10] if len(parts) > 10 else ""
            ix, wt = (xy[0], xy[1]) if len(xy) >= 2 else ("U", "U")
            changes.append(FileChange(
                path=path,
                index_status=ix,
                worktree_status=wt,
                is_conflict=True,
            ))

        elif token.startswith("? "):
            # untracked
            path = token[2:]
            changes.append(FileChange(path=path, index_status="?", worktree_status="?"))

        elif token.startswith("! "):
            # ignored — skip
            pass

        i += 1

    return branch, changes
