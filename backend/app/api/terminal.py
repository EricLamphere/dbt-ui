import asyncio
import os
import shutil

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.dbt.interactive import _pty_read_executor, manager as init_manager
from app.events.sse import sse_response_with_replay
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/terminal", tags=["terminal"])


class TerminalStartDto(BaseModel):
    cwd: str
    cols: int = 220
    rows: int = 50


class TerminalInputDto(BaseModel):
    data: str


class TerminalResizeDto(BaseModel):
    cols: int
    rows: int


class TerminalSessionDto(BaseModel):
    session_id: str


def _user_shell() -> str:
    """Return the user's login shell, falling back to sh."""
    shell = os.environ.get("SHELL")
    if shell and shutil.which(shell):
        return shell
    for candidate in ("/bin/zsh", "/bin/bash", "/bin/sh"):
        if shutil.which(candidate):
            return candidate
    return "sh"


@router.post("/start", response_model=TerminalSessionDto)
async def start_terminal(dto: TerminalStartDto) -> TerminalSessionDto:
    from pathlib import Path
    cwd = Path(dto.cwd)
    if not cwd.exists():
        raise HTTPException(status_code=400, detail=f"directory does not exist: {cwd}")

    shell = _user_shell()
    session = await init_manager.create_pending(cwd)

    # Patch dimensions before spawning so the PTY is sized correctly
    async def _start() -> None:
        import ptyprocess  # type: ignore
        env = os.environ.copy()
        env.setdefault("TERM", "xterm-256color")
        proc = ptyprocess.PtyProcess.spawn(
            [shell, "-l"],
            cwd=str(cwd),
            env=env,
            dimensions=(dto.rows, dto.cols),
        )
        session.process = proc
        session.reader_task = asyncio.create_task(
            init_manager._reader(session)  # noqa: SLF001
        )
        log.info("terminal_started", session_id=session.session_id, shell=shell, cwd=str(cwd))
        # Activate the backend venv so dbt and project tools are on PATH
        venv_activate = Path(__file__).resolve().parents[2] / ".venv" / "bin" / "activate"
        if venv_activate.exists():
            await asyncio.sleep(0.3)  # let the shell finish its init before sending input
            proc.write(f"source {venv_activate}\n".encode())

    asyncio.create_task(_start())
    return TerminalSessionDto(session_id=session.session_id)


@router.post("/{session_id}/input")
async def terminal_input(session_id: str, dto: TerminalInputDto) -> dict[str, bool]:
    try:
        await init_manager.send_input(session_id, dto.data)
    except KeyError:
        raise HTTPException(status_code=404, detail="session not found")
    return {"ok": True}


@router.post("/{session_id}/resize")
async def terminal_resize(session_id: str, dto: TerminalResizeDto) -> dict[str, bool]:
    session = init_manager.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    if session.process is not None:
        try:
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(
                _pty_read_executor, session.process.setwinsize, dto.rows, dto.cols
            )
        except Exception as exc:
            log.warning("terminal_resize_failed", error=str(exc))
    return {"ok": True}


@router.post("/{session_id}/stop")
async def stop_terminal(session_id: str) -> dict[str, bool]:
    await init_manager.stop(session_id)
    return {"ok": True}


@router.get("/{session_id}/events")
async def terminal_events(session_id: str):
    session = init_manager.get(session_id)
    replay = list(session.replay_buffer) if session else []
    finished = session.finished if session else False
    return_code = session.return_code if session else None
    return sse_response_with_replay(
        f"init:{session_id}",
        replay_chunks=replay,
        already_finished=finished,
        return_code=return_code,
    )
