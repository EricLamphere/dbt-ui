import asyncio
import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.events.bus import Event, bus
from app.logging_setup import get_logger

# Dedicated pool for blocking PTY reads — keeps them off the default executor
# so send_input, manifest loads, and log writes aren't starved.
_pty_read_executor = ThreadPoolExecutor(max_workers=32, thread_name_prefix="pty-reader")

log = get_logger(__name__)

try:
    import ptyprocess  # type: ignore

    HAVE_PTY = True
except Exception:  # pragma: no cover
    HAVE_PTY = False


@dataclass
class InitSession:
    session_id: str
    cwd: Path
    process: Any
    reader_task: asyncio.Task | None = None
    finished: bool = False
    return_code: int | None = None
    # All output chunks accumulated so new SSE subscribers can replay what they missed
    replay_buffer: list[str] = field(default_factory=list)


class InteractiveInitManager:
    def __init__(self) -> None:
        self._sessions: dict[str, InitSession] = {}
        self._lock = asyncio.Lock()

    def _topic(self, session_id: str) -> str:
        return f"init:{session_id}"

    async def create_pending(self, cwd: Path) -> "InitSession":
        """Register a session with no PTY yet. Call start_pty() once ready."""
        session_id = uuid.uuid4().hex[:12]
        session = InitSession(session_id=session_id, cwd=cwd, process=None)
        async with self._lock:
            self._sessions[session_id] = session
        log.info("init_session_pending", session_id=session_id, cwd=str(cwd))
        return session

    async def start_pty(self, session: "InitSession", args: tuple[str, ...] | None = None) -> None:
        """Spawn the PTY process for an existing pending session."""
        if not HAVE_PTY:
            raise RuntimeError("ptyprocess is not installed")
        if args is None:
            from app.dbt.venv import venv_dbt
            args = (str(venv_dbt()), "init")
        env = os.environ.copy()
        env.setdefault("TERM", "xterm-256color")
        proc = ptyprocess.PtyProcess.spawn(
            list(args), cwd=str(session.cwd), env=env, dimensions=(30, 100)
        )
        session.process = proc
        session.reader_task = asyncio.create_task(self._reader(session))
        log.info("init_session_pty_started", session_id=session.session_id, args=args)

    async def start(self, cwd: Path, args: tuple[str, ...] | None = None) -> "InitSession":
        """Create a session and immediately spawn a PTY. Legacy helper."""
        session = await self.create_pending(cwd)
        await self.start_pty(session, args)
        return session

    async def _reader(self, session: InitSession) -> None:
        topic = self._topic(session.session_id)
        loop = asyncio.get_running_loop()
        try:
            while True:
                try:
                    chunk = await loop.run_in_executor(_pty_read_executor, self._read_chunk, session.process)
                except EOFError:
                    break
                if chunk is None:
                    continue
                if chunk == "":
                    break
                session.replay_buffer.append(chunk)
                await bus.publish(
                    Event(topic=topic, type="init_output", data={"data": chunk})
                )
        finally:
            session.finished = True
            try:
                session.return_code = session.process.wait()
            except Exception:
                session.return_code = -1
            await bus.publish(
                Event(
                    topic=topic,
                    type="init_finished",
                    data={"return_code": session.return_code},
                )
            )

    @staticmethod
    def _read_chunk(process: Any) -> str | None:
        try:
            data = process.read(1024)
        except EOFError:
            return ""
        if isinstance(data, bytes):
            return data.decode(errors="replace")
        return data

    async def send_input(self, session_id: str, data: str) -> None:
        session = self._sessions.get(session_id)
        if session is None or session.finished:
            raise KeyError("session not found or finished")
        if session.process is None:
            # PTY not yet started (pip install still running) — silently drop input
            return
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(_pty_read_executor, session.process.write, data.encode())

    async def stop(self, session_id: str) -> None:
        session = self._sessions.get(session_id)
        if session is None:
            return
        if session.process is not None:
            try:
                session.process.terminate(force=True)
            except Exception:
                pass
        if session.reader_task:
            session.reader_task.cancel()
        async with self._lock:
            self._sessions.pop(session_id, None)

    def get(self, session_id: str) -> InitSession | None:
        return self._sessions.get(session_id)


manager = InteractiveInitManager()
