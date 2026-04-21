# dbt-ui

Local web UI for managing dbt projects. No auth, single user, runs on localhost only.
Backend on `:8001`, frontend on `:5173`.

## Stack

| Layer | Tech |
|-------|------|
| Backend | Python 3.11+, FastAPI, SQLAlchemy async (aiosqlite), sse-starlette, structlog |
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, React Router v6, TanStack Query |
| DAG | @xyflow/react + dagre layout |
| Editor | Monaco (@monaco-editor/react) |
| Terminal | xterm.js + ptyprocess (dbt init PTY) |
| DB | SQLite via aiosqlite |
| Deploy | Taskfile (task start) |

## Directory Map

```
backend/app/
  api/            — FastAPI routers, one file per resource (projects, models, runs, files, docs, init, env, sql, terminal, settings)
  db/
    models.py     — All SQLAlchemy models (8 tables)
    engine.py     — get_session dependency
    migrations.py — DDL-on-startup migrations
  dbt/
    runner.py     — DbtRunner singleton; subprocess execution + serialization lock
    select.py     — build_selector(name, mode) → --select string
    manifest.py   — Parse target/manifest.json
    run_results.py — Parse target/run_results.json
    init_scripts.py — Read/write init/{script_path}/*.sh scripts per project
    interactive.py — InteractiveInitManager (ptyprocess PTY sessions; reused for terminal too)
  events/
    bus.py        — EventBus singleton `bus`; in-process pub/sub
    sse.py        — sse_response(), sse_response_with_replay()
  projects/
    discovery.py  — Walk workspace for dbt_project.yml
    service.py    — Upsert projects to DB; _effective_workspace() for DBT_PROJECTS_PATH
  watcher/
    service.py    — WatcherManager (watchfiles, per-project)

frontend/src/
  lib/
    api.ts        — All typed API fetch helpers (use these, never raw fetch in components)
    sse.ts        — useProjectEvents(), useInitSessionEvents(), useTerminalEvents() hooks
  routes/
    Home.tsx      — Project list (respects DBT_PROJECTS_PATH configured banner)
    Project/
      ProjectLayout.tsx  — Shared layout wrapper (BottomPane + <Outlet>)
      index.tsx          — Project homepage tiles
      Models.tsx         — React Flow DAG page
      Docs.tsx           — Native docs browser (folder tree)
      FileExplorer/      — File browser + editor
      Environment.tsx    — Env vars + profiles
      InitScripts.tsx    — Init pipeline management
      components/BottomPane/
        RunPanel.tsx     — Execution DAG (parses run_log to show real-time status)
        TerminalPanel.tsx — xterm.js terminals (multi-instance tabs)
        LogPanel.tsx     — Project and API logs
  components/     — Header, StatusBadge, shared UI
```

## Database Tables

All 8 in `backend/app/db/models.py`:
- `projects` — discovered dbt projects (includes `init_script_path: str` per-project init dir)
- `init_steps` — ordered init pipeline steps per project (includes `script_path` for linked external scripts)
- `model_statuses` — per-model run status (idle/pending/running/success/error/warn/stale)
- `run_invocations` — historical run records
- `env_profiles` — named environment profiles per project
- `profile_env_vars` — key/value vars belonging to a profile
- `project_env_vars` — project-level env vars (not profile-scoped)
- `app_settings` — global app config (key/value); e.g., `dbt_projects_path`

## Critical Architecture Rules

### dbt Execution — SUBPROCESS ONLY

```python
# CORRECT — always go through runner
from app.dbt.runner import runner, RunRequest
req = RunRequest(project_id=id, project_path=path, command="run", select="my_model")
async for kind, line in runner.stream(req):
    ...  # bus already publishes run_started/run_log/run_finished

# WRONG — never do this
import dbt  # dbt Python library not installed
```

- `runner` (`app.dbt.runner.runner`) is a **module-level singleton** — never instantiate another
- Each `project_id` gets its own `asyncio.Lock` — runs are serialized per project, never bypass the lock
- `runner.stream(req)` is an async generator; it publishes `run_started`, `run_log`, `run_finished` to the bus automatically
- After a run: call `_persist_results_after_run(project)` (see `api/runs.py`) to write `model_statuses` and publish `statuses_changed`
- Canonical pattern: `api/runs.py` → `_run_dbt_and_persist()`

### Event Bus

```python
from app.events.bus import bus, Event

# Publish
await bus.publish(Event(topic="project:42", type="my_event", data={"key": "val"}))

# Subscribe (always unsubscribe in finally)
queue = await bus.subscribe("project:42")
try:
    event = await queue.get()
finally:
    await bus.unsubscribe("project:42", queue)
```

- `bus` is a **module singleton** — never instantiate EventBus
- **NOT reset between requests or tests** — subscriber leaks persist across the process lifetime
- Topics: `project:{id}` (all project events) | `init:{session_id}` (dbt init PTY output only) | `terminal:{session_id}` (bash terminal PTY output only)
- SSE helpers (`events/sse.py`) handle subscribe/unsubscribe — prefer them for endpoints
- `sse_response(topic)` — standard stream with 15s keepalive
- `sse_response_with_replay(topic, replay_chunks, already_finished, return_code)` — PTY sessions only (late-subscriber catch-up)

### Event Types

| Type | Topic | Meaning |
|------|-------|---------|
| `run_started` | project | dbt command started |
| `run_log` | project | one line of stdout/stderr; frontend parses to update RunPanel DAG |
| `run_finished` | project | dbt process exited |
| `run_error` | project | dbt executable not found |
| `statuses_changed` | project | model_statuses updated in DB |
| `graph_changed` | project | manifest.json changed on disk |
| `files_changed` | project | .sql/.yml changed on disk |
| `compile_started` | project | compilation starting |
| `compile_finished` | project | compilation done |
| `docs_generating` | project | dbt docs generate started |
| `docs_generated` | project | docs generation finished |
| `init_pipeline_started` | project | init pipeline beginning |
| `init_step` | project | one init step completed |
| `init_pipeline_finished` | project | all init steps done |
| `init_output` | init | PTY terminal chunk (dbt init interactive) |
| `init_finished` | init | PTY process exited (dbt init interactive) |
| `terminal_output` | terminal | PTY terminal chunk (bash terminal) |
| `terminal_finished` | terminal | PTY process exited (bash terminal) |

### Init Pipeline System

**Init Pipeline** — runs dbt deps + custom shell scripts in sequence
- Entry: `POST /api/projects/{id}/open`
- Scripts in `{project_path}/{init_script_path}/*.sh` (default `init/`; managed by `dbt/init_scripts.py`)
- Per-project `init_script_path` column in `projects` table
- Linked external scripts tracked with absolute `script_path` in `init_steps` table
- `_sync_steps_from_disk()` only deletes owned (init-dir) scripts; preserves linked ones
- SSE topic: `project:{id}`
- Events: `init_pipeline_started` → `init_step` (×N) → `init_pipeline_finished`

### Interactive PTY Systems

Both share the **InteractiveInitManager singleton** (two separate use cases):

**1. Interactive dbt init**
- Entry: `POST /api/projects/init-session/start`
- First pip-installs the dbt adapter, then spawns `dbt init` via ptyprocess
- SSE topic: `init:{session_id}`
- Events: `init_output` (chunks), `init_finished`
- Replay buffer in-memory — replayed to late subscribers; **no persistence across restart**

**2. Terminal (bash)**
- Entry: `POST /api/terminal/start` (queries via `api.terminal.start()`)
- Spawns user's shell (bash/zsh) via ptyprocess
- Supports input (`POST /api/terminal/{id}/input`), resize (`POST /api/terminal/{id}/resize`), stop (`POST /api/terminal/{id}/stop`)
- SSE topic: `terminal:{session_id}`
- Events: `terminal_output` (chunks), `terminal_finished`
- Replay buffer in-memory — replayed to late subscribers
- Frontend: `TerminalPanel.tsx` uses xterm.js with multi-instance tabs

### SSE + React Query Pattern (Frontend)

```tsx
// Always use appropriate SSE hook — never poll
useProjectEvents(projectId, useCallback((event) => {
  if (event.type === 'statuses_changed' || event.type === 'graph_changed') {
    qc.invalidateQueries({ queryKey: ['graph', projectId] });
  }
}, [projectId, qc]));

// Terminal: useTerminalEvents
useTerminalEvents(sessionId, onEvent, useCallback(() => { /* on close */ }, []));

// dbt init PTY: useInitSessionEvents
useInitSessionEvents(sessionId, onEvent, useCallback(() => { /* on close */ }, []));
```

- All API calls through `lib/api.ts` typed helpers — never `fetch()` directly in components
- SSE via `useProjectEvents` / `useInitSessionEvents` / `useTerminalEvents` from `lib/sse.ts`
- TanStack Query cache invalidated by SSE events — never rely on polling for freshness
- `RunPanel` is **always mounted** in `ProjectLayout` (never unmounted) so it receives `run_log` SSE events even when bottom pane is closed

### Global Settings

- New `AppSetting` table in DB (key/value pairs)
- `GET /api/settings` returns `{ dbt_projects_path, configured }`
- `PUT /api/settings` updates global config
- `configured: bool` indicates whether `DBT_PROJECTS_PATH` is set (mandatory to show project list)
- Home page shows blocking banner if `configured: false`
- Workspace is resolved from `app_settings` table (key `dbt_projects_path`) with fallback to env var `DBT_PROJECTS_PATH`
- `_effective_workspace()` in `projects/service.py` handles resolution; used by `rescan_projects` and `start_init_session`

### File Watcher

- `WatcherManager` in `watcher/service.py` — Rust-backed watchfiles, ~200ms debounce
- Watches per project: `models/`, `tests/`, `seeds/`, `snapshots/`, `macros/`, `analyses/`, `target/`
- `manifest.json` or `run_results.json` changed → publishes `graph_changed`
- `.sql` / `.yml` / `.yaml` changed → publishes `files_changed`

### Bottom Pane Architecture

- Shared across all Project routes (Home, Models, Docs, etc.)
- Lives in `ProjectLayout` alongside router outlet
- Supports dragging to open/close; snaps closed below 80px threshold
- Multi-tab interface with "Run" (DAG), "Project Logs", "API Logs", and "Terminal"
- Terminal tab allows multiple instances with VSCode-style tabs on the right side
- `RunPanel` always mounted to continuously receive `run_log` SSE events
- `BottomPane` manages `open` state, `activeTab`, and `height`

## Development Commands

```bash
task start           # backend + frontend in parallel (primary)
task dev:backend     # uvicorn on :8001, hot reload
task dev:frontend    # vite on :5173, proxies /api → :8001
task test:backend    # pytest --cov=app -q (run from backend/)
task test            # pytest + tsc build
task lint            # ruff check app tests
task db:reset        # delete data/dbt_ui.sqlite
```

Single test file: `cd backend && .venv/bin/pytest tests/test_x.py -xvs`

## Checklist: Adding a New dbt Feature (Command or Event)

- [ ] API endpoint in `backend/app/api/` — follow `runs.py` `_run_dbt_and_persist()` pattern
- [ ] Use `runner.stream(req)` — never `asyncio.create_subprocess_exec` directly
- [ ] Publish event via `bus.publish()` with correct topic (`project:{id}`)
- [ ] Add event type to `useProjectEvents` handler in the relevant frontend route
- [ ] If event means stale data: `qc.invalidateQueries(...)` in the handler
- [ ] Add typed API helper to `lib/api.ts` if new endpoint
- [ ] Write backend test with `override_db` fixture (autouse — no declaration needed)

## Checklist: Adding a New Global Setting

- [ ] Add key/value to `AppSetting` table via migrations (or upsert in-code if safe)
- [ ] Add `GET` handler to `api/settings.py` that returns the setting
- [ ] Add `PUT` handler to update it
- [ ] Return `configured` flag if it affects workspace visibility (Home page)
- [ ] Call `_effective_workspace()` in `projects/service.py` to resolve final workspace path
- [ ] Update frontend `api.settings.get()` type if response shape changed

## Checklist: Adding a New Terminal Feature

- [ ] Terminal sessions reuse `InteractiveInitManager` in `app.dbt.interactive`
- [ ] Topic: `terminal:{session_id}` (distinct from `init:{session_id}`)
- [ ] Use `sse_response_with_replay()` if adding SSE endpoint (supports late subscribers)
- [ ] Add `useTerminalEvents(sessionId, onEvent, onClose)` call in frontend component
- [ ] Events: `terminal_output` (chunks), `terminal_finished`
- [ ] TerminalPanel multi-instance tabs managed in BottomPane/index.tsx
