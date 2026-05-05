# dbt-ui Architecture

dbt-ui is a local-first web UI that wraps dbt-core. It runs as a local dev server pair (FastAPI + Vite), discovers dbt projects from a configured workspace directory, and provides a live-updating DAG view with run/build/test controls, an integrated terminal, an in-browser SQL editor, a PTY-backed `dbt init` terminal, and a native docs browser.

---

## High-Level Stack

| Layer | Technology | Why |
|---|---|---|
| Backend | FastAPI (Python 3.11+) | Async, native SSE/streaming, simple subprocess management |
| dbt execution | `subprocess` calling the venv `dbt` binary | Safe — avoids dbt Python API global state issues; one process per invocation; always uses `backend/.venv/bin/dbt` |
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
│   │   │   ├── models.py            # /api/projects/{id}/models — DAG, create, compile, show, profile
│   │   │   ├── runs.py              # /api/projects/{id}/run|build|test (loads dbt_target from project_env_vars → --target)
│   │   │   ├── sql.py               # /api/projects/{id}/models/{uid}/sql GET/PUT
│   │   │   ├── files.py             # /api/projects/{id}/files — file browser
│   │   │   ├── docs.py              # /api/projects/{id}/docs — native docs browser
│   │   │   ├── env.py               # /api/projects/{id}/profiles + dbt-targets + dbt-target (R/W)
│   │   │   ├── init.py              # /api/projects/{id}/init — steps, pipeline, PTY session
│   │   │   ├── workspace.py         # /api/projects/{id}/workspace — SQL scratchpad compile/run/path
│   │   │   ├── terminal.py          # /api/terminal — integrated bash PTY sessions
│   │   │   ├── settings.py          # /api/settings — global app config (dbt_projects_path)
│   │   │   ├── events.py            # /api/projects/{id}/events — SSE endpoint
│   │   │   ├── debug.py             # /api/projects/{id}/debug — runs dbt debug, parses output into structured checks
│   │   │   ├── drift.py             # /api/projects/{id}/drift — schema drift check (dbt show per model vs manifest columns)
│   │   │   └── health.py            # /api/health
│   │   ├── db/
│   │   │   ├── engine.py            # Async SQLAlchemy engine, SessionLocal, get_session
│   │   │   ├── models.py            # ORM: 11 tables (see Database Schema below)
│   │   │   └── migrations.py        # DDL-on-startup migrations (idempotent; no Alembic)
│   │   ├── dbt/
│   │   │   ├── manifest.py          # Parse target/manifest.json → nodes + edges
│   │   │   ├── run_results.py       # Parse target/run_results.json → statuses
│   │   │   ├── runner.py            # DbtRunner singleton; subprocess + asyncio.Lock per project; .run() for silent invocations
│   │   │   ├── select.py            # Build --select strings (only/upstream/downstream/full)
│   │   │   ├── venv.py              # venv_dbt/venv_pip/venv_python — resolve binaries in backend/.venv/bin/
│   │   │   ├── init_scripts.py      # Read/write init/*.sh custom scripts
│   │   │   ├── debug_parser.py      # Parse dbt debug stdout → structured DebugResult with per-check status
│   │   │   ├── drift.py             # diff_columns / is_eligible_for_drift_check — column drift helpers
│   │   │   ├── profile.py           # Parse dbt show --output json output into column profile stats
│   │   │   ├── show_parser.py       # parse_show_json() — handles dbt 1.5+ and 1.11+ show output formats
│   │   │   └── interactive.py       # InteractiveInitManager singleton (PTY sessions; reused for terminal)
│   │   ├── git/
│   │   │   ├── runner.py            # GitRunner singleton; subprocess + asyncio.Lock per project
│   │   │   └── repo.py              # find_repo_root, parse_porcelain_v2, BranchInfo / FileChange dataclasses
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
│   │           ├── ProjectLayout.tsx    # Shared layout (BottomPane + <Outlet overflow-auto>); global ⌘K listener; CommandPaletteContext
│   │           ├── lib/
│   │           │   └── commandPaletteContext.tsx # React context (CommandPaletteContext) + useCommandPalette() hook
│   │           ├── components/
│   │           │   └── CommandPalette.tsx # VS Code-style palette (z-[60]); nav + project actions + model search
│   │           ├── index.tsx            # Project home: tiles + tabbed README/dbt_project.yml/profiles.yml viewer
│   │           ├── Models.tsx           # React Flow DAG with real-time run overlays; ?model= deep-link; SidePane; DagFilterBar
│   │           │                        #   DagFilterBar: text selector (+model, tag:x), Type/Materialization/Tag/Status dropdowns
│   │           ├── Docs.tsx             # Native docs browser (folder tree)
│   │           ├── Environment.tsx      # Env vars + profiles
│   │           ├── InitScripts.tsx      # Init pipeline management
│   │           ├── Health.tsx           # Health page: two tabs — dbt Health Check + Schema Drift
│   │           ├── FileExplorer/        # File browser + Monaco editor; SidePane replaces old tab bar
│   │           ├── Git/                 # Source Control page (VSCode-style SCM)
│   │           ├── Workspace/           # SQL Workspace — file tree + Monaco editor + results pane + autocomplete
│   │           └── components/
│   │               ├── BottomPane/
│   │               │   ├── index.tsx        # Drag-to-resize pane; tab management; terminal instances
│   │               │   ├── RunPanel.tsx     # Execution DAG (real-time run_log parsing); shows full-run notice when no model selected
│   │               │   ├── TerminalPanel.tsx # xterm.js multi-instance terminal; only resizes PTY when dims change
│   │               │   └── LogPanel.tsx     # Project and API logs
│   │               ├── NavRail.tsx          # Collapsible left nav sidebar (persists collapsed state in localStorage; resizable when expanded)
│   │               ├── ProjectNav.tsx       # Nav items (DAG/Files/Docs/Workspace/Git/Environment/Init/Health); icon-only mode when collapsed
│   │               ├── HealthCheckPanel.tsx # dbt debug runner — shows per-check status table, version info, raw log
│   │               ├── DriftPanel.tsx       # Schema drift UI — triggers drift scan, shows per-model column diff table
│   │               ├── SidePane/
│   │               │   ├── index.tsx        # Right-side collapsible panel (drag/collapse); tabs: Properties, Profile
│   │               │   ├── PropertiesTab.tsx # Model metadata; Refs/Sources + Referenced By as cmd+clickable chips; run controls; action buttons
│   │               │   └── ProfilePanel.tsx  # Column profile stats for a model via dbt show (min/max/nulls/distinct/sample)
│   │               ├── ModelNode.tsx
│   │               ├── NewProjectModal.tsx  # dbt init PTY terminal; writes profiles.yml after rescan
│   │               └── DagFilterBar.tsx     # filter bar: text selector + dropdown pills + Clear + node count
│   ├── vite.config.ts               # Dev proxy → :8001; prod build output
│   └── tailwind.config.ts
├── docs/
│   └── architecture.md              # This file
├── data/                            # SQLite database (git-ignored)
└── Taskfile.yml
```

---

## Database Schema

11 tables, all in `backend/app/db/models.py`:

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
  -- Well-known keys:
  --   dbt_target        active dbt target; passed as --target on every invocation
  --   REQUIREMENTS_PATH path to project-specific requirements.txt
  --   WORKSPACE_PATH    relative path to SQL workspace dir (default "workspace")
  --   Any KEY=value exported by an init script is upserted here automatically

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

drift_snapshots
  id              INTEGER PK
  project_id      INTEGER FK→projects (CASCADE)
  started_at      DATETIME
  finished_at     DATETIME (nullable)
  status          TEXT(32)   -- running | done | error
  target          TEXT(255) (nullable)  -- dbt target used during the scan
  total_models    INTEGER    -- number of eligible models
  checked_models  INTEGER    -- models processed so far (progress)
  results_json    TEXT       -- JSON array of ModelDriftResult objects
  error_message   TEXT (nullable)
  -- Interrupted snapshots (status='running') are reset to 'error' on server restart

freshness_snapshots
  id              INTEGER PK
  project_id      INTEGER FK→projects (CASCADE)
  started_at      DATETIME
  finished_at     DATETIME (nullable)
  status          TEXT(32)   -- running | done | error
  target          TEXT(255) (nullable)  -- dbt target used during the scan
  results_json    TEXT       -- JSON array of SourceFreshnessResult objects
  error_message   TEXT (nullable)
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
DELETE /api/projects/{id}/models/{unique_id}
POST   /api/projects/{id}/compile
GET    /api/projects/{id}/models/{unique_id}/compiled    on-demand compile + return compiled SQL
POST   /api/projects/{id}/models/{unique_id}/show        run dbt show, return rows
POST   /api/projects/{id}/models/{unique_id}/profile    run dbt show (full table), return column profile stats
GET    /api/projects/{id}/models/{unique_id}/sql
PUT    /api/projects/{id}/models/{unique_id}/sql
GET    /api/projects/{id}/column-lineage                 column-level lineage graph parsed from manifest.json

POST   /api/projects/{id}/debug                          run dbt debug, return structured check results + raw log
GET    /api/projects/{id}/debug/last                     get result of the most recent debug run (from cache)

POST   /api/projects/{id}/drift                          start async schema drift scan (202); returns DriftSnapshot
GET    /api/projects/{id}/drift                          get the latest DriftSnapshot for a project
GET    /api/projects/{id}/drift/{snapshot_id}            get a specific DriftSnapshot by id

POST   /api/projects/{id}/freshness                      start async source freshness check (202); returns FreshnessSnapshot
GET    /api/projects/{id}/freshness                      get the latest FreshnessSnapshot for a project

POST   /api/projects/{id}/run
POST   /api/projects/{id}/build
POST   /api/projects/{id}/test

GET    /api/projects/{id}/docs/status                    timestamp of last generated docs
POST   /api/projects/{id}/docs/generate                  runs dbt compile --write-catalog (≥1.9) or dbt docs generate
GET    /api/projects/{id}/docs/data                      merged manifest+catalog JSON for native docs browser
GET    /api/projects/{id}/docs/view                      patched index.html for iframe-based dbt docs viewer

GET    /api/projects/{id}/env-vars                       list project_env_vars rows
PUT    /api/projects/{id}/env-vars/{key}                 upsert a project env var
DELETE /api/projects/{id}/env-vars/{key}                 delete a project env var

POST   /api/projects/{id}/open                           runs init pipeline
GET    /api/projects/{id}/init/steps
POST   /api/projects/{id}/init/steps
DELETE /api/projects/{id}/init/steps/{name}
POST   /api/projects/{id}/init/reorder

POST   /api/init/global-setup                            run global pip install (global_requirements_path)
POST   /api/init/global-setup/cancel                     cancel a running global setup
GET    /api/init/global-setup/events                     SSE stream for global setup output

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

GET    /api/projects/{id}/workspace/path              workspace dir path + relative path (creates dir if missing)
POST   /api/projects/{id}/workspace/compile          compile SQL with dbt compile --inline; returns compiled SQL
POST   /api/projects/{id}/workspace/run              run SQL with dbt show --inline; returns columns + rows (max 5000)

GET    /api/projects/{id}/git/status                 repo root, current branch, ahead/behind, changes list
GET    /api/projects/{id}/git/diff                   unified diff for one file (?path=&staged=)
GET    /api/projects/{id}/git/file-at-head           HEAD blob for Monaco DiffEditor original (?path=)
POST   /api/projects/{id}/git/stage                  git add -- <paths>
POST   /api/projects/{id}/git/unstage                git restore --staged -- <paths>
POST   /api/projects/{id}/git/discard                git restore -- <paths>
POST   /api/projects/{id}/git/commit                 git commit -m <message>
GET    /api/projects/{id}/git/branches               list local + remote branches
POST   /api/projects/{id}/git/branches               create branch
POST   /api/projects/{id}/git/checkout               switch branch
POST   /api/projects/{id}/git/pull                   SSE-streamed git pull
POST   /api/projects/{id}/git/push                   SSE-streamed git push
GET    /api/projects/{id}/git/log                    commit history (?path= &limit=)
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
| `git_status_changed` | `git/api.py`, `watcher.py` | Invalidates git status + branches queries |
| `git_started` | `git/runner.py` | Source Control shows sync in progress |
| `git_log` | `git/runner.py` | Appends push/pull output line to sync log |
| `git_finished` | `git/runner.py` | Source Control re-fetches status after push/pull |
| `git_error` | `git/runner.py` | Source Control shows error (e.g. git not on PATH) |
| `health_check_started` | `debug.py` | Health page shows spinner |
| `health_check_finished` | `debug.py` | Health page renders check results table |
| `drift_started` | `drift.py` | Drift panel shows progress bar |
| `drift_progress` | `drift.py` | Drift panel updates checked/total counter |
| `drift_finished` | `drift.py` | Drift panel renders column diff results |
| `freshness_started` | `freshness.py` | Freshness panel shows running state |
| `freshness_finished` | `freshness.py` | Freshness panel invalidates query, renders results |

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
   - custom steps — runs `bash -euo pipefail <script_path>` in the script's parent directory; on success, sources the script again with `set -a` and `export -p` to capture any exported env vars (e.g. `SNOWFLAKE_ACCOUNT`); new/changed vars are upserted into `project_env_vars` and merged into the running env so subsequent steps see them immediately
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

DAG filtering (`dagFilter.ts`) is purely client-side — no backend involvement:
- **Text selector**: supports dbt-style syntax — `+model` (ancestors), `model+` (descendants), `+model+` (both), `tag:x`, `source:x`, `resource_type:model`, bare type names (`model`, `seed`, `snapshot`, `test`, `source`), and plain substring on name; space-separated tokens are unioned
- **Dropdown filters**: Type, Materialization, Tag, Status — AND between categories, OR within each
- BFS graph traversal builds ancestor/descendant sets using pre-computed adjacency maps
- After filter changes, `fitView()` is called with a 200ms ease so the camera re-centers on the visible subset

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

### 9. Docs Generation

`POST /api/projects/{id}/docs/generate` → background task `_generate_docs()`:
1. Publishes `docs_generating`
2. Tries `dbt compile --write-catalog` (dbt ≥ 1.9); if the flag is unrecognised, falls back to `dbt docs generate`
3. All output is streamed to Project Logs via `append_project_log()` — does **not** use `runner.stream()`, so no `run_started` event is emitted and the Run tab does not activate
4. On success, copies `manifest.json`, `catalog.json` (and `index.html` if produced) to `data/docs/{project_id}/`
5. Publishes `docs_generated {ok, generated_at}`
6. Frontend invalidates `['docs-status', projectId]`; the native docs browser (`Docs.tsx`) re-fetches `GET /api/projects/{id}/docs/data`

### 10. Column-Level Lineage

`GET /api/projects/{id}/column-lineage`:
1. Reads `target/manifest.json` in a thread pool executor (non-blocking)
2. `dbt/column_lineage.py` → `build_column_lineage()` parses each node's `columns` and `depends_on.nodes` to build a `{downstream_node: {column: [ColumnRef(node, column)]}}` map
3. Returns `ColumnLineageDto { lineage }` — a nested dict from downstream node → column → list of upstream `{node, column}` refs

In the frontend (`Models.tsx`):
- `useQuery(['column-lineage', id])` fetches the lineage map on load; the query runs as a background task on the backend so the DAG is usable before it completes
- A loading banner ("Column lineage loading…") is shown while the query is in flight
- Expanding a model node in the DAG reveals its columns; clicking a column toggles it in `activeColumnSels`
- `traceColumn()` walks the lineage map bidirectionally (upstream via `reverseLineageIndex`, downstream via forward traversal) to collect all `{node, column}` pairs in the trace
- Highlighted `{node, column}` pairs are passed as props into each `ModelNode`; nodes and edges outside the trace are dimmed
- `graph_changed` SSE event invalidates `['column-lineage', id]` so the trace updates after recompilation

### 11. SQL Workspace

`WorkspacePage` (`routes/Project/Workspace/`) is a standalone SQL scratchpad with its own file tree, editor, and results pane. It does **not** use `DbtRunner` — it calls `asyncio.create_subprocess_exec` directly to avoid publishing `run_started`/`run_finished` events and keep the Run panel quiet.

**Compile** (`POST /api/projects/{id}/workspace/compile`):
1. Calls `dbt compile --inline "<sql>" --output json`
2. Parses the JSON response — handles dbt 1.10+ `{"compiled": "..."}` and older `{"results":[{"node":{"compiled_code":"..."}}]}` formats
3. Returns `{ compiled_sql }` to the frontend

**Run** (`POST /api/projects/{id}/workspace/run`):
1. Calls `dbt show --inline "<sql>" --limit <n> --output json`
2. `_parse_show_output()` tries multiple JSON shapes (`results[0].table`, `show[*]`) for cross-version compatibility
3. Returns `{ columns, rows }` (limit clamped 1–5000; existing `LIMIT` clause in SQL is respected and takes precedence)
4. Results persist in `sessionStorage` so they survive navigation within the session

**Workspace path** (`GET /api/projects/{id}/workspace/path`):
- Reads `WORKSPACE_PATH` from `project_env_vars`; defaults to `"workspace"`
- Creates the directory if it does not exist; returns both absolute and relative paths
- All SQL files are enforced to have a `.sql` extension on creation

**Frontend layout** (three resizable panels):
- Left: file tree (add/delete/rename files and folders; filter bar) + Database Explorer (resizable vertical split)
- Center: Monaco editor with Code / Compiled SQL tabs; Cmd+S saves, Cmd+Enter runs; SQL formatter (Jinja-aware)
- Right: query results pane (drag to open/resize/close); shows row count and query timestamp

**Autocomplete** (`Monaco registerCompletionItemProvider` on `'sql'`):
- `ref('` → lists all models/seeds/snapshots with materialization + schema detail
- `source('schema',` → lists source table names for the given schema
- `source('` → lists all source schema names
- `FROM`/`JOIN <word>` → lists models as `{{ ref('...') }}` and sources as `{{ source('...', '...') }}`
- Column names after `SELECT`, `WHERE`, `ON`, etc. — scoped to models referenced in the current SQL statement
- Completions are prefix-filtered and ranked (exact match first, then alphabetical)

**Cmd+click navigation** — `ref('model')` and `source('schema', 'table')` spans are underlined when Cmd/Ctrl is held. Clicking navigates to `/projects/:id/files?model=<unique_id>`, which the File Explorer deep-link handler resolves to the model's source file.

Session state (`sessionStorage`) persists open file path, expanded tree nodes, active tab, and last query results across navigation within a browser session.

### 12. Health Check (dbt debug)

`POST /api/projects/{id}/debug` → `debug.py`:
1. Loads project env via `load_project_env()` and reads active dbt target
2. Runs `dbt debug` via `runner.stream(req)` — streams stdout into a buffer
3. Publishes `health_check_started`; stores raw log output
4. `dbt/debug_parser.py` → `parse_debug_output()` extracts:
   - dbt/Python/adapter version strings
   - Active profiles dir, profile name, target name
   - Per-check status rows (`ok | fail | warn | info`) for connection, profile YAML, project YAML, etc.
5. Publishes `health_check_finished` with the full result payload
6. Result is stored in-memory in a `_cache` dict keyed by project_id; `GET /api/projects/{id}/debug/last` returns the cached result without re-running

`HealthCheckPanel.tsx` (Health → "dbt Health Check" tab):
- Shows per-check status table (green tick / red x / amber warn / info)
- Displays version info block and raw log accordion

### 13. Schema Drift

`POST /api/projects/{id}/drift` (202 Accepted) → `drift.py`:
1. Creates a `DriftSnapshot` DB row with `status=running`
2. Launches `_run_drift_check()` as a background asyncio task (one per project; concurrent requests return 409)
3. Reads manifest via `load_manifest()` and filters to eligible models (`is_eligible_for_drift_check` — materialized views and tables only)
4. For each model:
   - Runs `dbt show --select <uid> --limit 0 --output json` via `runner.run()` (silent — no bus events)
   - `parse_show_json()` returns the warehouse column schema
   - `diff_columns()` compares manifest-declared columns against warehouse columns
   - Publishes `drift_progress` with `checked / total` counts
5. Writes all results to `drift_snapshots.results_json` and sets `status=done`; publishes `drift_finished`
6. `GET /api/projects/{id}/drift` returns the latest snapshot; `GET /api/projects/{id}/drift/{id}` returns a specific one

`DriftPanel.tsx` (Health → "Schema Drift" tab):
- Triggers scan and polls via SSE for `drift_progress` / `drift_finished`
- Shows per-model accordion: green (no drift) or red (has drift), with a column-level diff table inside each row
- Interrupted snapshots (server restart mid-scan) are reset to `status=error` on startup

### 14. Model Column Profile

`POST /api/projects/{id}/models/{unique_id}/profile` → `models.py`:
1. Runs `dbt show --select <uid> --output json` against the full materialized table via `runner.run()` (silent)
2. `dbt/profile.py` → `build_column_profile()` computes per-column stats: row count, null count/pct, distinct count, min, max, and up to 5 sample values
3. Returns `ProfileResponseDto { columns: [ProfileColumnDto] }`

`ProfilePanel.tsx` (SidePane → "Profile" tab):
- Appears alongside the Properties tab when a model is selected in the SidePane
- Shows a compact stats table per column (rows, nulls%, distinct, min, max, sample)
- Only available for models that are materialized (not ephemeral/view on unsupported adapters)

### 15. File Watching

`WatcherManager` runs one `watchfiles.awatch` task per project. Watched paths: `models/`, `tests/`, `seeds/`, `snapshots/`, `macros/`, `analyses/`, `target/`.

- `manifest.json` / `run_results.json` changes → `graph_changed`
- `.sql` / `.yml` / `.yaml` changes → `files_changed`

### 16. Command Palette

`ProjectLayout.tsx` listens for ⌘K / Ctrl+K globally and opens `CommandPalette.tsx` (portal-rendered at z-[60]). The palette provides:

**Navigation commands** (always visible when query is empty):
- Go to [page name] for each project route (DAG, Files, Docs, Workspace, Git, Environment, Init, Health)

**Project actions** (always visible):
- Run / Build / Test all models
- Generate docs
- Check health → navigates to `/health?tab=health-check` and runs `dbt debug`
- Check source freshness → navigates to `/health?tab=source-freshness` and triggers freshness scan
- Check schema drift → navigates to `/health?tab=schema-drift` and triggers drift scan

**Model commands** (appear when searching):
- Show DAG, Open file, View docs, Run, Run upstream/downstream, Build, Test [model name]

Behavior:
- ⌘K with empty query shows Navigation + Project sections only (50 results max)
- Typing filters all sections with substring match, ranked: nav → project → model
- Arrow keys navigate, Enter executes, Escape or backdrop click closes
- Re-pressing ⌘K while open closes the palette

**Health page `?tab=` deep-link**:
- `/health?tab=health-check` activates the dbt Health Check tab
- `/health?tab=source-freshness` activates the Source Freshness tab
- `/health?tab=schema-drift` activates the Schema Drift tab
- Links from the command palette use these params to pre-select the tab even if the page is already mounted

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

Per-project env vars (stored in `project_env_vars`, injected into every dbt subprocess via `load_project_env()`):

| Key | Set by | Description |
|---|---|---|
| `REQUIREMENTS_PATH` | Environment tab (UI) | Path to a project-specific `requirements.txt`; installed during `base: pip install` |
| `dbt_target` | Target dropdown (UI) | Active dbt target; passed as `--target` on every dbt invocation |
| `WORKSPACE_PATH` | Environment tab (UI) | Relative path to the SQL workspace directory inside the project (default `workspace`) |
| _(any exported var)_ | Init scripts automatically | Any `export KEY=value` in a custom init script is captured and upserted here after the step succeeds; persists across restarts |

`load_project_env()` builds the subprocess env as: `os.environ` + `project_env_vars` rows + active profile vars (from `env_profiles` / `profile_env_vars`).

---

## Running Locally

```bash
task install          # create venv, pip install, npm install
task start            # backend (:8001) + Vite dev server (:5173) in parallel (foreground, logs to terminal)
task start:bg         # same but daemonized; opens browser automatically; logs to data/logs/
task stop             # kill background daemons started by task start:bg
```

The Vite dev server proxies all `/api` requests to `localhost:8001`. Open [http://localhost:5173](http://localhost:5173).

To choose a specific Python interpreter:

```bash
task install PYTHON=python3.12
```

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

**SidePane upstream/downstream chips** — "Refs / Sources" (upstream nodes) and "Referenced By" (downstream nodes) are shown as chips derived from graph edges at render time. Cmd+clicking a chip calls `onNavigateToFile(path)`, which in FileExplorer expands the tree and opens the file. Chips without a navigable `original_file_path` render in muted style with no hover effect.

**NavRail collapse state in localStorage** — The left sidebar collapse state persists in `localStorage` under `nav-rail-collapsed`. Navigating between pages or clicking a nav icon while collapsed never re-opens the rail; the collapsed state is only changed by clicking the toggle chevron at the bottom of the rail.

**Project-local `profiles.yml`** — Each project carries its own `profiles.yml` rather than relying on `~/.dbt/profiles.yml`. This makes projects self-contained and portable. `DbtRunner.build_args()` adds `--profiles-dir` automatically when the file is present, so existing projects without one continue to use the global fallback. `ensure-profiles-yml` writes a minimal stub after `dbt init` so new projects are immediately usable.

**dbt target stored in `project_env_vars`** — The active dbt target (`dev`, `prod`, etc.) is persisted as a `project_env_vars` row with key `dbt_target`, passed as `--target` on every invocation. This keeps target selection durable across sessions without adding a new DB column or migration.

**Global profiles as reusable env var templates** — `global_profiles` / `global_profile_vars` store named env var sets that are not tied to any project. They serve as templates that can be imported into project profiles, enabling teams to share common variable sets (e.g., a "prod credentials" profile) without duplicating them per project.

**Requirements install in the dbt venv** — `pip install -r <requirements.txt>` targets the pip binary co-located with the `dbt` executable (`venv_pip()`). This ensures packages install into whichever Python environment dbt actually runs in, not the app's own venv. A global path (for shared adapters or tools) and a per-project path (for project-specific packages) are both supported and installed in sequence.

**`runner.run()` for silent invocations** — `DbtRunner.stream()` publishes `run_started`/`run_log`/`run_finished` events to the bus, which opens the Run tab and activates the Execution DAG. Operations like schema drift checks and column profiling run `dbt show` repeatedly and should not appear as user-visible runs. `runner.run()` uses the same per-project lock and env setup but returns `(returncode, stdout, stderr)` without emitting any bus events.

**Schema drift stored in SQLite** — `drift_snapshots` persists the full results_json so the last drift report survives server restarts. A single in-memory `_running` dict (project_id → asyncio.Task) prevents concurrent drift scans per project. Interrupted snapshots are auto-corrected to `status=error` on startup.

**dbt debug result cached in memory** — `dbt debug` is quick (~1s) but re-running it on every page load is unnecessary. The last result is stored in `_cache[project_id]` and served by `GET /debug/last` until explicitly re-triggered. The cache is process-local (no persistence across restarts).

**All dbt commands use the venv binary** — `venv_dbt()` / `venv_pip()` / `venv_python()` in `dbt/venv.py` resolve binaries relative to `backend/.venv/bin/`. This ensures adapter packages installed during setup (e.g. `dbt-snowflake`) are available to every dbt invocation regardless of what's on `$PATH`.

**Docs generation bypasses `runner.stream()`** — `dbt compile --write-catalog` and `dbt docs generate` are invoked directly (not via `DbtRunner`) so they emit `compile_started`/`compile_finished` or `docs_generating`/`docs_generated` events but never `run_started`. This prevents the frontend from switching to the Run tab when docs are generated.

**Init-script env var capture** — exported shell vars are captured by sourcing each script a second time in a `set -a` subshell and diffing `export -p` output against the parent env. Captured vars are upserted into `project_env_vars` so they survive server restarts and are injected into all future dbt subprocesses via `load_project_env()`. This requires no changes to the shell scripts themselves.
