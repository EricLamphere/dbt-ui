# dbt-ui Architecture

dbt-ui is a local-first web UI that wraps dbt-core. It runs as a local dev server pair (FastAPI + Vite), discovers dbt projects from a configured workspace directory, and provides a live-updating DAG view with run/build/test controls, an integrated terminal, an in-browser SQL editor, and a PTY-backed `dbt init` terminal.

---

## High-Level Stack

| Layer | Technology | Why |
|---|---|---|
| Backend | FastAPI (Python 3.11+) | Async, native SSE/streaming, simple subprocess management |
| dbt execution | `subprocess` calling the system `dbt` CLI | Safe — avoids dbt Python API global state issues; one process per invocation |
| Manifest parsing | Custom JSON parser over `manifest.json` | Direct, version-agnostic parsing of dbt's output artifacts |
| File watching | `watchfiles` (Rust-backed) | Low-overhead, async-friendly, debounced |
| Live push | Server-Sent Events (SSE) via `sse-starlette` | One-way server→client is sufficient; simpler than WebSockets; built-in browser reconnect |
| Database | SQLite via SQLAlchemy async + `aiosqlite` | Zero-ops, file-based, sufficient for single-user local tool |
| Frontend | React 18 + Vite + TypeScript | Standard SPA stack |
| DAG rendering | `@xyflow/react` + `dagre` | Interactive graph with automatic LR layout |
| SQL editor | `@monaco-editor/react` | Full editor experience in-browser |
| Terminal | `xterm.js` + `xterm-addon-fit` | PTY output rendering for integrated terminal and `dbt init` |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Data fetching | TanStack Query | Cache invalidation on SSE events; no manual refetch logic |
| Interactive init / terminal | `ptyprocess` | Full PTY for `dbt init`'s interactive prompts and integrated bash terminal |

---

## Repository Layout

```
dbt-ui/
├── backend/
│   ├── app/
│   │   ├── main.py                  # FastAPI app, lifespan, SPA mount
│   │   ├── config.py                # Pydantic settings (env vars, paths)
│   │   ├── logging_setup.py         # structlog configuration
│   │   ├── api/
│   │   │   ├── projects.py          # /api/projects — list, get, rescan, ensure-profiles-yml; returns dbt_project_yml + profiles_yml
│   │   │   ├── models.py            # /api/projects/{id}/models — DAG, create, compile
│   │   │   ├── runs.py              # /api/projects/{id}/run|build|test (loads dbt_target from project_env_vars → --target)
│   │   │   ├── sql.py               # /api/projects/{id}/models/{uid}/sql GET/PUT
│   │   │   ├── files.py             # /api/projects/{id}/files — file browser
│   │   │   ├── docs.py              # /api/projects/{id}/docs — native docs browser
│   │   │   ├── env.py               # /api/projects/{id}/profiles + dbt-targets + dbt-target (R/W)
│   │   │   ├── init.py              # /api/projects/{id}/init — steps, pipeline, PTY session
│   │   │   ├── terminal.py          # /api/terminal — integrated bash PTY sessions
│   │   │   ├── settings.py          # /api/settings — global app config (dbt_projects_path)
│   │   │   ├── events.py            # /api/projects/{id}/events — SSE endpoint
│   │   │   └── health.py            # /api/health
│   │   ├── db/
│   │   │   ├── engine.py            # Async SQLAlchemy engine, SessionLocal, get_session
│   │   │   ├── models.py            # ORM: 8 tables (see Database Schema below)
│   │   │   └── migrations.py        # DDL-on-startup migrations
│   │   ├── dbt/
│   │   │   ├── manifest.py          # Parse target/manifest.json → nodes + edges
│   │   │   ├── run_results.py       # Parse target/run_results.json → statuses
│   │   │   ├── runner.py            # DbtRunner singleton; subprocess + asyncio.Lock per project
│   │   │   ├── select.py            # Build --select strings (only/upstream/downstream/full)
│   │   │   ├── init_scripts.py      # Read/write init/*.sh custom scripts
│   │   │   └── interactive.py       # InteractiveInitManager singleton (PTY sessions; reused for terminal)
│   │   ├── events/
│   │   │   ├── bus.py               # In-process pub/sub EventBus singleton
│   │   │   └── sse.py               # SSE response helpers (standard + with-replay)
│   │   ├── projects/
│   │   │   ├── discovery.py         # Walk workspace for dbt_project.yml; infer platform
│   │   │   └── service.py           # list_projects, rescan_projects; _effective_workspace()
│   │   └── watcher/
│   │       └── service.py           # watchfiles task per project; routes to bus.publish
│   ├── pyproject.toml
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── main.tsx                 # React entry point
│   │   ├── App.tsx                  # BrowserRouter + route definitions
│   │   ├── lib/
│   │   │   ├── api.ts               # fetch wrappers + typed API helpers
│   │   │   └── sse.ts               # useProjectEvents, useInitSessionEvents, useTerminalEvents
│   │   ├── components/
│   │   │   ├── Header.tsx           # Persistent nav; Profile + Target dropdowns on project pages (reads projectId from pathname)
│   │   │   └── StatusBadge.tsx      # Status color chip
│   │   └── routes/
│   │       ├── Home.tsx             # Project list, search, rescan, new project modal, global settings modal
│   │       └── Project/
│   │           ├── ProjectLayout.tsx    # Shared layout (BottomPane + <Outlet overflow-auto>)
│   │           ├── index.tsx            # Project home: tiles + tabbed README/dbt_project.yml/profiles.yml viewer
│   │           ├── Models.tsx           # React Flow DAG with real-time run overlays; ?model= deep-link; SidePane
│   │           ├── Docs.tsx             # Native docs browser (folder tree)
│   │           ├── Environment.tsx      # Env vars + profiles
│   │           ├── InitScripts.tsx      # Init pipeline management
│   │           ├── FileExplorer/        # File browser + Monaco editor; SidePane replaces old tab bar
│   │           └── components/
│   │               ├── BottomPane/
│   │               │   ├── index.tsx        # Drag-to-resize pane; tab management; terminal instances
│   │               │   ├── RunPanel.tsx     # Execution DAG (real-time run_log parsing)
│   │               │   ├── TerminalPanel.tsx # xterm.js multi-instance terminal; only resizes PTY when dims change
│   │               │   └── LogPanel.tsx     # Project and API logs
│   │               ├── SidePane/
│   │               │   ├── index.tsx        # Right-side collapsible panel (drag/collapse); renders PropertiesTab
│   │               │   └── PropertiesTab.tsx # Model metadata + run controls + action buttons (unified, no tabs)
│   │               ├── ModelNode.tsx
│   │               └── NewProjectModal.tsx  # dbt init PTY terminal; writes profiles.yml after rescan
│   ├── vite.config.ts               # Dev proxy → :8001; prod build output
│   └── tailwind.config.ts
├── docs/
│   └── architecture.md              # This file
├── data/                            # SQLite database (git-ignored)
└── Taskfile.yml
```

---

## Database Schema

8 tables, all in `backend/app/db/models.py`:

```
projects
  id                INTEGER PK
  name              TEXT(255)          -- from dbt_project.yml "name:"
  path              TEXT(1024) UNIQUE  -- absolute path to project directory
  platform          TEXT(64)           -- inferred from profiles.yml (postgres, duckdb, …)
  profile           TEXT(255)          -- value of dbt_project.yml "profile:"
  vscode_cmd        TEXT(255)          -- optional custom VS Code launch command
  init_script_path  TEXT(255)          -- subdirectory for init scripts (default "init/")
  ignored           BOOLEAN            -- when true, project is hidden from the project list
  created_at        DATETIME

init_steps
  id            INTEGER PK
  project_id    INTEGER FK→projects
  name          TEXT(255)        -- display name
  order         INTEGER          -- execution order
  script_path   TEXT(1024)       -- absolute path for linked external scripts
  is_base       BOOLEAN          -- True for built-in steps (dbt deps)
  enabled       BOOLEAN
  UNIQUE (project_id, name)

model_statuses
  id            INTEGER PK
  project_id    INTEGER FK→projects
  unique_id     TEXT(512)        -- dbt unique_id (model.project.name)
  kind          TEXT(32)         -- "model" or "test"
  status        TEXT(32)         -- idle | pending | running | success | error | warn | stale
  message       TEXT             -- error message if applicable
  started_at    DATETIME
  finished_at   DATETIME
  UNIQUE (project_id, unique_id)

run_invocations
  id            INTEGER PK
  project_id    INTEGER FK→projects
  command       TEXT(64)         -- run, build, test
  selector      TEXT(1024)       -- dbt --select string
  status        TEXT(32)         -- pending | success | error
  log_path      TEXT(1024)
  started_at    DATETIME
  finished_at   DATETIME

env_profiles
  id            INTEGER PK
  project_id    INTEGER FK→projects
  name          TEXT(255)

profile_env_vars
  id            INTEGER PK
  profile_id    INTEGER FK→env_profiles
  key           TEXT(255)
  value         TEXT

project_env_vars
  id            INTEGER PK
  project_id    INTEGER FK→projects
  key           TEXT(255)
  value         TEXT

app_settings
  key           TEXT PK          -- e.g. "dbt_projects_path", "global_requirements_path"
  value         TEXT

global_profiles
  id            INTEGER PK
  name          TEXT(255) UNIQUE -- display name
  created_at    DATETIME

global_profile_vars
  id            INTEGER PK
  profile_id    INTEGER FK→global_profiles
  key           TEXT(255)
  value         TEXT
  UNIQUE (profile_id, key)
```

---

## API Routes

```
GET    /api/health

GET    /api/settings
PUT    /api/settings

GET    /api/projects
POST   /api/projects/rescan
GET    /api/projects/{id}                                includes readme, dbt_project_yml, profiles_yml
POST   /api/projects/{id}/ensure-profiles-yml            writes minimal profiles.yml if absent
PATCH  /api/projects/{id}/settings

GET    /api/projects/{id}/events                         SSE

GET    /api/projects/{id}/models
POST   /api/projects/{id}/models
GET    /api/projects/{id}/models/{unique_id}
GET    /api/projects/{id}/models/{unique_id}/sql
PUT    /api/projects/{id}/models/{unique_id}/sql

POST   /api/projects/{id}/run
POST   /api/projects/{id}/build
POST   /api/projects/{id}/test

POST   /api/projects/{id}/open                           runs init pipeline
GET    /api/projects/{id}/init/steps
POST   /api/projects/{id}/init/steps
DELETE /api/projects/{id}/init/steps/{name}
POST   /api/projects/{id}/init/reorder

POST   /api/projects/init-session/start                  pip install adapter + spawn PTY
POST   /api/projects/init-session/{session_id}/input
POST   /api/projects/init-session/{session_id}/stop
GET    /api/projects/init-session/{session_id}/events    SSE with replay buffer

POST   /api/terminal/start                               spawn bash/zsh PTY
POST   /api/terminal/{id}/input
POST   /api/terminal/{id}/resize
POST   /api/terminal/{id}/stop
GET    /api/terminal/{id}/events                         SSE with replay buffer

GET    /api/projects/{id}/profiles
POST   /api/projects/{id}/profiles
PATCH  /api/projects/{id}/profiles/{profile_id}
DELETE /api/projects/{id}/profiles/{profile_id}
POST   /api/projects/{id}/profiles/{profile_id}/activate
PUT    /api/projects/{id}/profiles/{profile_id}/vars/{key}
DELETE /api/projects/{id}/profiles/{profile_id}/vars/{key}

GET    /api/projects/{id}/dbt-targets                    list outputs from profiles.yml
GET    /api/projects/{id}/dbt-target                     current target (from project_env_vars)
PUT    /api/projects/{id}/dbt-target                     set active target

GET    /api/global-profiles
POST   /api/global-profiles
DELETE /api/global-profiles/{profile_id}
PUT    /api/global-profiles/{profile_id}/vars/{key}
DELETE /api/global-profiles/{profile_id}/vars/{key}
```

---

## Event System

All real-time updates flow through a single in-process pub/sub bus. Publishers call `bus.publish(Event(topic, type, data))`. SSE endpoints subscribe to a topic and stream events to the browser as they arrive.

### Event Bus (`events/bus.py`)

```
EventBus (module singleton: bus)
  _subscribers: dict[topic → set[asyncio.Queue]]

  subscribe(topic)  → asyncio.Queue   (creates queue, registers it)
  publish(event)    → None            (puts event on every queue for that topic)
  unsubscribe(...)  → None            (removes queue on SSE disconnect)
```

Each SSE client gets its own queue. `publish` is non-blocking (`put_nowait`); events are dropped if a client queue is full (max 1024). There is no persistence — events are lost if the server restarts.

### Topics

| Topic | Subscribers | Publishers |
|---|---|---|
| `project:{id}` | All project routes (RunPanel always mounted) | Runner, Watcher, Init pipeline, compile |
| `init:{session_id}` | New project terminal modal | PTY reader, pip install stream |
| `terminal:{session_id}` | TerminalPanel | PTY reader (bash/zsh) |

### Project-scoped Event Types

| Type | Published by | Frontend effect |
|---|---|---|
| `run_started` | `runner.py` | RunPanel begins tracking new run |
| `run_log` | `runner.py` | RunPanel parses line → updates Execution DAG + Models DAG in real time |
| `run_finished` | `runner.py` | RunPanel stops timer |
| `run_error` | `runner.py` | RunPanel shows error |
| `statuses_changed` | `runs.py` | Invalidates models query → DAG tiles update; clears live overlays |
| `graph_changed` | `watcher.py`, `models.py` | Invalidates models query → DAG re-renders |
| `files_changed` | `watcher.py` | — (graph_changed handles visual update) |
| `compile_started` | `models.py` | Shows "Compiling…" spinner |
| `compile_finished` | `models.py` | Hides spinner |
| `docs_generating` | `docs.py` | — |
| `docs_generated` | `docs.py` | Invalidates docs-status query |
| `init_pipeline_started` | `init.py` | Init modal shows step list |
| `init_step` | `init.py` | Init modal updates step status |
| `init_pipeline_finished` | `init.py` | Init modal shows success/error |

### Init Session Event Types

| Type | Published by | Frontend effect |
|---|---|---|
| `init_output` | `interactive.py`, pip install stream | Writes chunk to xterm.js terminal |
| `init_finished` | `interactive.py` | Shows "Done" footer; triggers rescan on close |

### Terminal Event Types

| Type | Published by | Frontend effect |
|---|---|---|
| `terminal_output` | `interactive.py` PTY reader | Writes chunk to xterm.js |
| `terminal_finished` | `interactive.py` PTY reader | Shows restart bar in TerminalPanel |

### SSE with Replay (`events/sse.py`)

PTY session events (init and terminal) use a replay buffer. When a subscriber connects, the SSE endpoint first sends all buffered output chunks, then streams live events. This ensures the terminal shows complete output even if the user navigates away and back, or opens the modal after output has started.

Standard project events do not replay.

---

## Key Flows

### 1. Project Discovery

On startup and on `POST /api/projects/rescan`:
1. `_effective_workspace()` in `service.py` resolves the active projects path: checks `app_settings` DB table first, falls back to `DBT_UI_PROJECTS_PATH` env var, returns `None` if unconfigured
2. If `None`, rescan is a no-op; Home page shows a blocking banner
3. `discovery.py` walks the workspace for `dbt_project.yml` files
4. For each project, reads `profile:` from the YAML and looks up the adapter type in `profiles.yml`
5. `service.py` upserts rows into `projects`

### 2. Global Settings

- `GET /api/settings` returns `{ dbt_projects_path, configured }` where `configured: bool` indicates whether the path is meaningfully set
- `PUT /api/settings` saves the path to `app_settings` and returns `configured: true`
- Home page gates the project list on `configured` and shows an amber banner when false
- `_effective_workspace()` is the single source of truth for path resolution across the backend

### 3. Opening a Project (Init Pipeline)

`POST /api/projects/{id}/open` → background task `_run_init_steps()`:
1. Publishes `init_pipeline_started`
2. Builds env dict: process env + project env vars + active profile vars (via `load_project_env()`)
3. For each enabled `InitStep` in order:
   - `base: pip install` — installs `global_requirements_path` (from `app_settings`) and `REQUIREMENTS_PATH` (from project env vars) into the dbt venv; skips if neither is set
   - `base: dbt deps` — runs `dbt deps` in the project directory
   - custom steps — runs `bash -euo pipefail <script_path>` in the script's parent directory
   - Publishes `init_step` with status after each step
4. Publishes `init_pipeline_finished`
5. On success, fires `_compile_project` in the background to populate the DAG immediately

### 4. Models DAG

`GET /api/projects/{id}/models`:
1. Loads `target/manifest.json` via `manifest.py`
2. Extracts nodes and edges from `parent_map`
3. Merges with latest `ModelStatus` rows from SQLite
4. Returns `GraphDto {nodes, edges}`

The frontend runs `dagre` layout client-side and renders with React Flow. `Models.tsx` overlays a live `liveStatuses` map (populated from `run_log` SSE parsing) so models turn blue while running without waiting for `statuses_changed`.

### 5. Running dbt

`POST /api/projects/{id}/run` (same pattern for build/test):
1. `select.py` builds the `--select` string from `(model_name, mode)`
2. `runs.py` reads `project_env_vars` for key `dbt_target`; if set, appends `--target <value>` to `RunRequest.extra`
3. `runner.py` acquires the per-project `asyncio.Lock` and spawns `dbt run --select <selector> [--target <target>]`
4. If `profiles.yml` exists in the project root, `build_args()` also adds `--profiles-dir <project_path>`
5. Each stdout line is published as `run_log`
6. `RunPanel.tsx` (always mounted) parses `run_log` lines with regex to identify START/result events, updates the Execution DAG in real time — models appear blue (running) as they start
7. On exit, `run_results.py` parses `target/run_results.json`, upserts `ModelStatus`, publishes `statuses_changed`
8. Frontend invalidates the graph query → final statuses applied

### 6. Execution DAG (RunPanel)

`RunPanel.tsx` is always mounted (height=0 when the pane is closed) so it never misses SSE events:
- On `run_started`: builds a `name → unique_id` lookup map from current graph; sets a `newRunPending` flag
- On `run_log` START line: clears previous run's nodes on first hit (lazy clear), adds node with `running` status
- On `run_log` result line (OK/ERROR/WARN/PASS/FAIL): updates node status optimistically
- `buildDisplayGraph` includes ancestor nodes so edges are visible even for single-model runs
- On `statuses_changed`: final states confirmed from DB

### 7. Integrated Terminal

`TerminalPanel.tsx` hosts multiple xterm.js instances (VSCode-style tabs):
- `POST /api/terminal/start` spawns a login shell (`$SHELL -l`, falling back to zsh/bash/sh)
- `InteractiveInitManager` singleton manages the PTY session (reused from `dbt init`)
- `ResizeObserver` + `xterm-addon-fit` handle dynamic resize; a 30ms timeout ensures fit runs after the container is visible
- `lastSizeRef` tracks last sent `{cols, rows}`; `setwinsize` is only called when dimensions actually change — prevents spurious `SIGWINCH` signals that would cause zsh to redraw the prompt on every click
- Sessions persist until explicitly closed; switching tabs keeps the session alive

### 8. Interactive `dbt init`

1. Frontend shows platform picker
2. `POST /api/projects/init-session/start {platform}` creates a pending session
3. Background: pip-installs the adapter, then spawns `dbt init` via ptyprocess
4. Frontend subscribes to SSE with replay buffer; xterm.js renders all output
5. On `init_finished`, frontend calls `POST /api/projects/rescan` then `POST /api/projects/{id}/ensure-profiles-yml` on each project — writes a minimal `profiles.yml` into any newly created project that doesn't have one
6. Project appears in list with a working `profiles.yml` ready for `--profiles-dir`

### 9. File Watching

`WatcherManager` runs one `watchfiles.awatch` task per project. Watched paths: `models/`, `tests/`, `seeds/`, `snapshots/`, `macros/`, `analyses/`, `target/`.

- `manifest.json` / `run_results.json` changes → `graph_changed`
- `.sql` / `.yml` / `.yaml` changes → `files_changed`

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DBT_UI_PROJECTS_PATH` | _(none)_ | Root directory scanned for dbt projects; overridable via Global Settings UI |
| `DBT_UI_DATA_DIR` | `data/` | Directory for SQLite database |
| `DBT_UI_DATABASE_URL` | _(derived from DATA_DIR)_ | Override SQLite path |
| `DBT_UI_LOG_LEVEL` | `INFO` | structlog level |

Global settings (stored in `app_settings` table, set via UI):

| Setting key | Description |
|---|---|
| `dbt_projects_path` | Overrides `DBT_UI_PROJECTS_PATH` |
| `global_requirements_path` | Absolute path to a `requirements.txt` installed into the dbt venv on every project open |
| `data_dir` | Overrides `DBT_UI_DATA_DIR` |
| `log_level` | Overrides `DBT_UI_LOG_LEVEL` |

Per-project env var (set in the Environment tab, stored in `project_env_vars`):

| Key | Description |
|---|---|
| `REQUIREMENTS_PATH` | Path to a project-specific `requirements.txt`; installed in addition to the global one during `base: pip install` |
| `dbt_target` | Active dbt target; passed as `--target` on every dbt invocation |

---

## Running Locally

```bash
task install    # create venv, pip install, npm install
task start      # backend (:8001) + Vite dev server (:5173) in parallel
```

The Vite dev server proxies all `/api` requests to `localhost:8001`. Open [http://localhost:5173](http://localhost:5173).

---

## Design Decisions

**Subprocess over dbt Python API** — the dbt Python API is not safe for concurrent use; it modifies global state and is not re-entrant. Using a subprocess per invocation isolates execution completely and allows streaming stdout line-by-line.

**SSE over WebSockets** — All real-time communication is server→client. SSE is sufficient, simpler, and has built-in browser reconnect.

**In-memory event bus** — A Redis or database-backed queue would add ops overhead for a local-only tool. The in-memory bus is zero-config and fast enough; events lost on restart are acceptable (the next page load re-fetches current state from disk).

**Replay buffer for PTY sessions only** — Run log events are ephemeral (run_results.json is the durable record). PTY output has no equivalent durable store, so the replay buffer fills that gap for both the init terminal and the integrated bash terminal.

**RunPanel always mounted** — The bottom pane can be collapsed, but `RunPanel` must always receive `run_log` SSE events. It renders with `height: 0` when hidden rather than unmounting, so no events are lost mid-run.

**Lazy clear on new run** — `runNodeIds` is not cleared on `run_started`. It clears when the first `START` log line of the new run arrives. This keeps the previous run's Execution DAG visible until actual execution begins.

**SQLite** — Single-user, local tool. No concurrent writes from multiple processes. SQLite with aiosqlite is zero-ops and sufficient.

**`_effective_workspace()` as single source of truth** — The projects path can come from the `app_settings` DB table (set via UI) or `settings.dbt_projects_path` (the `DBT_UI_PROJECTS_PATH` env var). All backend code that needs the workspace path calls this one function.

**SidePane as a unified panel** — The right-side panel (DAG and File Explorer) intentionally has no tab bar. Model metadata and run controls live in one scrollable view. Separating them into tabs added navigation friction with no benefit since both are used together during a typical run-and-inspect workflow.

**Project-local `profiles.yml`** — Each project carries its own `profiles.yml` rather than relying on `~/.dbt/profiles.yml`. This makes projects self-contained and portable. `DbtRunner.build_args()` adds `--profiles-dir` automatically when the file is present, so existing projects without one continue to use the global fallback. `ensure-profiles-yml` writes a minimal stub after `dbt init` so new projects are immediately usable.

**dbt target stored in `project_env_vars`** — The active dbt target (`dev`, `prod`, etc.) is persisted as a `project_env_vars` row with key `dbt_target`, passed as `--target` on every invocation. This keeps target selection durable across sessions without adding a new DB column or migration.

**Global profiles as reusable env var templates** — `global_profiles` / `global_profile_vars` store named env var sets that are not tied to any project. They serve as templates that can be imported into project profiles, enabling teams to share common variable sets (e.g., a "prod credentials" profile) without duplicating them per project.

**Requirements install in the dbt venv** — `pip install -r <requirements.txt>` targets the pip binary co-located with the `dbt` executable (`_venv_pip()`). This ensures packages install into whichever Python environment dbt actually runs in, not the app's own venv. A global path (for shared adapters or tools) and a per-project path (for project-specific packages) are both supported and installed in sequence.
