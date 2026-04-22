import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import docs as docs_api
from app.api import env as env_api
from app.api import events as events_api
from app.api import files as files_api
from app.api import global_profiles as global_profiles_api
from app.api import health as health_api
from app.api import init as init_api
from app.api import logs as logs_api
from app.api import models as models_api
from app.api import projects as projects_api
from app.api import runs as runs_api
from app.api import settings as settings_api
from app.api import sql as sql_api
from app.api import terminal as terminal_api
from app.config import settings
from app.db.engine import SessionLocal
from app.db.migrations import init_db
from app.logs.api_logger import append_api_log, configure_api_log
from app.logging_setup import configure_logging, get_logger
from app.projects.service import rescan_projects
from app.watcher.service import watcher_manager

_api_log_path = configure_api_log(settings.data_dir)
configure_logging(settings.log_level)
log = get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with SessionLocal() as session:
        await rescan_projects(session)
    log.info("startup", workspace=str(settings.dbt_projects_path), db=settings.resolved_database_url())
    await watcher_manager.start()
    try:
        yield
    finally:
        await watcher_manager.stop()
        log.info("shutdown")


app = FastAPI(title="dbt-ui", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:5174"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_api.router)
app.include_router(settings_api.router)
app.include_router(projects_api.router)
app.include_router(models_api.router)
app.include_router(runs_api.router)
app.include_router(sql_api.router)
app.include_router(init_api.router)
app.include_router(env_api.router)
app.include_router(docs_api.router)
app.include_router(events_api.router)
app.include_router(files_api.router)
app.include_router(files_api.fs_router)
app.include_router(global_profiles_api.router)
app.include_router(logs_api.router)
app.include_router(terminal_api.router)


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    elapsed_ms = int((time.monotonic() - start) * 1000)
    # Skip SSE streams and noisy health checks from the log file
    if not request.url.path.endswith("/events") and request.url.path != "/api/health":
        line = f"{request.method} {request.url.path} → {response.status_code} ({elapsed_ms}ms)"
        append_api_log(line)
    return response


def _mount_spa() -> None:
    # Mount static docs directory (created on demand when docs are generated)
    docs_dir = settings.data_dir / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    app.mount("/static/docs", StaticFiles(directory=docs_dir), name="static_docs")

    dist = settings.frontend_dist
    if not dist.exists():
        log.warning("frontend_dist_missing", path=str(dist))
        return
    assets = dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    index_file = dist / "index.html"

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa_fallback(full_path: str):
        candidate = dist / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)


_mount_spa()
