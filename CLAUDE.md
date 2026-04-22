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
  api/            — FastAPI routers, one file per resource (projects, models, runs, files, docs, init, env, sql, terminal, settings, global_profiles)
  db/
    models.py     — All SQLAlchemy models (10 tables)
    engine.py     — get_session dependency
    migrations.py — DDL-on-startup migrations
  dbt/
    runner.py     — DbtRunner singleton; subprocess execution + serialization lock; adds --profiles-dir when project-local profiles.yml exists
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
    service.py    — Upsert projects to DB; _effective_workspace() for DBT_UI_PROJECTS_PATH
  watcher/
    service.py    — WatcherManager (watchfiles, per-project)

frontend/src/
  lib/
    api.ts        — All typed API fetch helpers (use these, never raw fetch in components)
    sse.ts        — useProjectEvents(), useInitSessionEvents(), useTerminalEvents() hooks
  routes/
    Home.tsx      — Project list (respects DBT_UI_PROJECTS_PATH configured banner)
    Project/
      ProjectLayout.tsx  — Shared layout wrapper (outlet + BottomPane; outlet has overflow-auto for scrolling)
      index.tsx          — Project homepage (README, dbt_project.yml, profiles.yml tabbed viewer)
      Models.tsx         — React Flow DAG page (/projects/:projectId/models); supports ?model=<uid> deep-link; uses SidePane(page="dag")
      Docs.tsx           — Native docs browser (folder tree)
      FileExplorer/      — File browser + editor; uses SidePane(page="files") with navigation to DAG
      Environment.tsx    — Env vars + profiles
      InitScripts.tsx    — Init pipeline management
      components/
        SidePane/
          index.tsx      — Right collapsible/draggable panel (horizontal drag); renders PropertiesTab; props: projectId, model, graph, page, navigation callbacks
          PropertiesTab.tsx — Model metadata (name, type, materialization, schema, path, deps, tags, description, status), run controls (run/build/test grid), test failures, action buttons
        BottomPane/
          RunPanel.tsx     — Execution DAG (parses run_log to show real-time status)
          TerminalPanel.tsx — xterm.js terminals (multi-instance tabs); optimized resize with lastSizeRef to prevent spurious SIGWINCH
          LogPanel.tsx     — Project and API logs
        Header.tsx         — Navigation + ProjectSelectors (Profile/Target dropdowns)
        StatusBadge        — Shared UI
  components/     — Other shared UI components
```

## Database Tables

All 10 in `backend/app/db/models.py`:
- `projects` — discovered dbt projects (includes `init_script_path: str` per-project init dir; `ignored: bool` to hide from list)
- `init_steps` — ordered init pipeline steps per project (includes `script_path` for linked external scripts)
- `model_statuses` — per-model run status (idle/pending/running/success/error/warn/stale)
- `run_invocations` — historical run records
- `env_profiles` — named environment profiles per project
- `profile_env_vars` — key/value vars belonging to a profile
- `project_env_vars` — project-level env vars (not profile-scoped); includes `dbt_target` for active target; `REQUIREMENTS_PATH` for per-project requirements
- `app_settings` — global app config (key/value); keys: `dbt_projects_path`, `global_requirements_path`, `data_dir`, `log_level`
- `global_profiles` — named env var sets shared across all projects
- `global_profile_vars` — key/value vars belonging to a global profile

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
- `RunRequest.extra` tuple accepts additional CLI args; dbt target is passed here when set via `/api/projects/{id}/dbt-target`
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

**Init Pipeline** — runs pip install + dbt deps + custom shell scripts in sequence
- Entry: `POST /api/projects/{id}/open`
- Built-in base steps (in order): `base: pip install`, `base: dbt deps`
- Scripts in `{project_path}/{init_script_path}/*.sh` (default `init/`; managed by `dbt/init_scripts.py`)
- Per-project `init_script_path` column in `projects` table
- Linked external scripts tracked with absolute `script_path` in `init_steps` table
- `_sync_steps_from_disk()` only deletes owned (init-dir) scripts; preserves linked ones
- SSE topic: `project:{id}`
- Events: `init_pipeline_started` → `init_step` (×N) → `init_pipeline_finished`

**`base: pip install` step logic:**
1. Reads `global_requirements_path` from `app_settings` (set via Global Settings UI)
2. Reads `REQUIREMENTS_PATH` from project env vars (set in Environment tab)
3. Installs both (global first, project second) into the dbt venv via `_venv_pip()` (pip co-located with the `dbt` binary)
4. Skips silently if neither path is configured; fails fast if a configured path does not exist

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

### dbt Target Configuration

- `GET /api/projects/{id}/dbt-targets` — reads `profiles.yml` (project-local first, falls back to `~/.dbt/`) and returns available target names
- `GET /api/projects/{id}/dbt-target` — returns currently active target from `ProjectEnvVar` table (key: `dbt_target`)
- `PUT /api/projects/{id}/dbt-target` — sets active target; subsequent dbt runs pass `--target {value}` via `RunRequest.extra`
- Frontend Header has Profile and Target dropdowns; Target select calls `api.profiles.setDbtTarget()` on change
- Project-local `profiles.yml` (if exists) takes precedence over `~/.dbt/profiles.yml`

### Global Settings

- `AppSetting` table stores key/value pairs for global config
- `GET /api/settings` returns `{ dbt_projects_path, global_requirements_path, data_dir, log_level, configured }`
- `PUT /api/settings` updates any subset of the above keys
- `configured: bool` indicates whether `DBT_UI_PROJECTS_PATH` is meaningfully set (mandatory to show project list)
- Home page shows blocking banner if `configured: false`
- Workspace is resolved from `app_settings` table (key `dbt_projects_path`) with fallback to env var `DBT_UI_PROJECTS_PATH`
- `_effective_workspace()` in `projects/service.py` handles resolution; used by `rescan_projects` and `start_init_session`
- `global_requirements_path` is read by `_run_init_steps()` in `api/init.py` during `base: pip install`

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

### SidePane Architecture (Right Panel)

- Horizontally draggable/collapsible panel, same pattern as BottomPane
- Unified replacement for old inline `ModelSidePanel` (DAG view) and file explorer metadata
- **Single component**: `SidePane` renders `PropertiesTab` directly (no tab bar)
- Props: `projectId`, `model` (ModelNode or null), `graph`, `page` ('files' | 'dag'), navigation callbacks (`onNavigateToFiles`, `onNavigateToDag`, `onViewDocs`, `onDelete`), `failedTestUid`
- **PropertiesTab** — unified model inspector showing:
  - Metadata: name, type, materialization, schema, database, file path, dependencies, tags, description, current status
  - Run controls: 3×3 grid (run/build/test × upstream/downstream/all) for models; single test button for tests
  - Test failures: rows of failing test metadata (when applicable)
  - Action buttons: Edit in Files / Open in DAG, View Docs, Delete model
- All run state and execution logic lives in PropertiesTab (no lifting to parent)
- Models.tsx mounts SidePane(page="dag"); FileExplorer mounts SidePane(page="files")
- Deep-link support: `Models.tsx` uses `useSearchParams` to read `?model=<unique_id>` and pre-select on load

### Project Files and Configuration

**API Endpoints** (`backend/app/api/projects.py`):
- `GET /api/projects/{id}` — returns `ProjectOut` with `readme`, `dbt_project_yml`, and `profiles_yml` text fields (populated on GET)
- `POST /api/projects/{id}/ensure-profiles-yml` — writes minimal `profiles.yml` to project dir if missing (e.g., after `dbt init`)
- `PATCH /api/projects/{id}/settings` — updates `init_script_path` only

**dbt Targets** (`backend/app/api/env.py`):
- `GET /api/projects/{id}/dbt-targets` — reads `profiles.yml` (project-local first, then `~/.dbt/`) and returns list of available target names
- `GET /api/projects/{id}/dbt-target` — returns currently active target from `ProjectEnvVar` table (key: `dbt_target`)
- `PUT /api/projects/{id}/dbt-target` — sets active target; subsequent runs pass `--target {value}` via `RunRequest.extra`

**Frontend**:
- Project homepage (`index.tsx`) displays README, dbt_project.yml, and profiles.yml in tabbed Monaco viewer using `YamlViewer` component
- Header has Profile and Target selectors; Target dropdown populated from `GET /api/projects/{id}/dbt-targets`
- FileExplorer: Removed old MAIN_TABS (View/Run/Setup); ViewPane always shown; integrated SidePane for navigation

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
- [ ] Add field to `SettingsUpdateDto` and `SettingsDto` in `api/settings.py`
- [ ] Add `_get_override(session, "my_key")` call in `get_settings()`
- [ ] Add `_upsert(session, "my_key", ...)` call in `put_settings()`
- [ ] Return `configured` flag if it affects workspace visibility (Home page)
- [ ] Call `_effective_workspace()` in `projects/service.py` to resolve final workspace path
- [ ] Update frontend `api.settings.get()` type if response shape changed
- [ ] Update `docs/architecture.md` → Configuration table and `README.md` → Environment Variables table

## Checklist: Adding a New Terminal Feature

- [ ] Terminal sessions reuse `InteractiveInitManager` in `app.dbt.interactive`
- [ ] Topic: `terminal:{session_id}` (distinct from `init:{session_id}`)
- [ ] Use `sse_response_with_replay()` if adding SSE endpoint (supports late subscribers)
- [ ] Add `useTerminalEvents(sessionId, onEvent, onClose)` call in frontend component
- [ ] Events: `terminal_output` (chunks), `terminal_finished`
- [ ] TerminalPanel multi-instance tabs managed in BottomPane/index.tsx

## Checklist: Adding dbt Target Support to a New Feature

- [ ] Read dbt target via `GET /api/projects/{id}/dbt-target` in frontend
- [ ] Pass target as `--target {value}` in `RunRequest.extra` tuple in backend
- [ ] Frontend: add target-aware logic to run controls (grid layout, button behavior)
- [ ] If storing per-run metadata: include target in historical record (e.g., run_invocations)
- [ ] Test with multiple profiles.yml scenarios (project-local vs global)
