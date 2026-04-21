# dbt-ui Architecture

dbt-ui is a local-first web UI that wraps dbt-core. It runs as a single Docker container (or local dev server pair), discovers dbt projects from a mounted workspace directory, and provides a live-updating DAG view with run/build/test controls, an in-browser SQL editor, and a PTY-backed `dbt init` terminal.

---

## High-Level Stack

| Layer | Technology | Why |
|---|---|---|
| Backend | FastAPI (Python 3.11+) | Async, native SSE/streaming, simple subprocess management |
| dbt execution | `subprocess` calling the system `dbt` CLI | Safe — avoids `dbtRunner` global state issues; one process per invocation |
| Manifest parsing | Custom JSON parser over `manifest.json` | Direct, version-agnostic parsing of dbt's output artifacts |
| File watching | `watchfiles` (Rust-backed) | Low-overhead, async-friendly, debounced |
| Live push | Server-Sent Events (SSE) via `sse-starlette` | One-way server→client is sufficient; simpler than WebSockets; built-in browser reconnect |
| Database | SQLite via SQLAlchemy async + `aiosqlite` | Zero-ops, file-based, sufficient for single-user local tool |
| Frontend | React 18 + Vite + TypeScript | Standard SPA stack |
| DAG rendering | `@xyflow/react` + `dagre` | Interactive graph with automatic LR layout |
| SQL editor | `@monaco-editor/react` | Full editor experience in-browser |
| Terminal | `xterm.js` + `xterm-addon-fit` | PTY output rendering for `dbt init` |
| Styling | Tailwind CSS | Utility-first, fast iteration |
| Data fetching | TanStack Query | Cache invalidation on SSE events; no manual refetch logic |
| Interactive init | `ptyprocess` | Full PTY for `dbt init`'s interactive prompts |

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
│   │   │   ├── projects.py          # /api/projects — list, get, rescan
│   │   │   ├── models.py            # /api/projects/{id}/models — DAG, create, compile
│   │   │   ├── runs.py              # /api/projects/{id}/run|build|test
│   │   │   ├── sql.py               # /api/projects/{id}/models/{uid}/sql GET/PUT
│   │   │   ├── init.py              # /api/projects/{id}/init — steps, pipeline, PTY session
│   │   │   ├── events.py            # /api/projects/{id}/events — SSE endpoint
│   │   │   └── health.py            # /api/health
│   │   ├── db/
│   │   │   ├── engine.py            # Async SQLAlchemy engine, SessionLocal, get_session
│   │   │   ├── models.py            # ORM: Project, InitStep, ModelStatus, RunInvocation
│   │   │   └── migrations.py        # create_all on startup
│   │   ├── dbt/
│   │   │   ├── manifest.py          # Parse target/manifest.json → nodes + edges
│   │   │   ├── run_results.py       # Parse target/run_results.json → statuses
│   │   │   ├── runner.py            # Async subprocess wrapper; streams stdout as SSE
│   │   │   ├── select.py            # Build --select strings (only/upstream/downstream/full)
│   │   │   ├── init_scripts.py      # Read/write init/*.sh custom scripts
│   │   │   └── interactive.py       # PTY session manager (create_pending, start_pty, replay buffer)
│   │   ├── events/
│   │   │   ├── bus.py               # In-process pub/sub EventBus
│   │   │   └── sse.py               # SSE response helpers (standard + with-replay)
│   │   ├── projects/
│   │   │   ├── discovery.py         # Walk workspace for dbt_project.yml; infer platform
│   │   │   └── service.py           # list_projects, rescan_projects (upsert to DB)
│   │   └── watcher/
│   │       └── service.py           # watchfiles task per project; routes to bus.publish
│   ├── pyproject.toml
│   ├── Dockerfile                   # Multi-stage: frontend build → backend runtime
│   └── tests/
├── frontend/
│   ├── src/
│   │   ├── main.tsx                 # React entry point
│   │   ├── App.tsx                  # BrowserRouter + route definitions
│   │   ├── lib/
│   │   │   ├── api.ts               # fetch wrappers + typed API helpers
│   │   │   └── sse.ts               # useProjectEvents, useInitSessionEvents hooks
│   │   ├── components/
│   │   │   ├── Header.tsx           # Persistent nav (home link, New project, Project home)
│   │   │   └── StatusBadge.tsx      # Status color chip
│   │   └── routes/
│   │       ├── Home.tsx             # Project list, search, rescan, new project modal
│   │       └── Project/
│   │           ├── index.tsx        # Project home (init steps, open button)
│   │           ├── Models.tsx       # React Flow DAG, side panel, log drawer, compile spinner
│   │           └── components/
│   │               ├── ModelNode.tsx
│   │               ├── SqlEditorModal.tsx
│   │               ├── InitStepsModal.tsx
│   │               ├── NewModelModal.tsx
│   │               └── NewProjectModal.tsx
│   ├── vite.config.ts               # Dev proxy → :8001; prod build output
│   └── tailwind.config.ts
├── docs/
│   └── architecture.md              # This file
├── workspace/                       # dbt projects (git-ignored; volume-mounted in Docker)
├── data/                            # SQLite database (git-ignored; volume-mounted in Docker)
├── docker-compose.yml
└── Taskfile.yml
```

---

## Database Schema

```
projects
  id            INTEGER PK
  name          TEXT(255)        -- from dbt_project.yml "name:"
  path          TEXT(1024) UNIQUE -- absolute path to project directory
  platform      TEXT(64)         -- inferred from profiles.yml (postgres, duckdb, athena, …)
  profile       TEXT(255)        -- value of dbt_project.yml "profile:"
  vscode_cmd    TEXT(255)        -- optional custom VS Code launch command
  created_at    DATETIME

init_steps
  id            INTEGER PK
  project_id    INTEGER FK→projects
  name          TEXT(255)        -- "base: cd", "base: dbt deps", or "custom: <name>"
  order         INTEGER          -- display/execution order
  script_path   TEXT(1024)       -- path to .sh file (custom steps only)
  is_base       BOOLEAN          -- True for built-in steps
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
```

---

## API Routes

```
GET    /api/health

GET    /api/projects
POST   /api/projects/rescan
GET    /api/projects/{id}

GET    /api/projects/{id}/events                         SSE

GET    /api/projects/{id}/models
POST   /api/projects/{id}/models                         creates .sql + triggers dbt compile
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
```

---

## Event System

All real-time updates flow through a single in-process pub/sub bus. Publishers call `bus.publish(Event(topic, type, data))`. SSE endpoints subscribe to a topic and stream events to the browser as they arrive.

### Event Bus (`events/bus.py`)

```
EventBus
  _subscribers: dict[topic → set[asyncio.Queue]]

  subscribe(topic)  → asyncio.Queue   (creates queue, registers it)
  publish(event)    → None            (puts event on every queue for that topic)
  unsubscribe(...)  → None            (removes queue on SSE disconnect)
```

Each SSE client gets its own queue. `publish` is non-blocking (`put_nowait`); events are dropped if a client queue is full (max 1024). There is no persistence — events are lost if the server restarts.

### Topics

| Topic | Subscribers | Publishers |
|---|---|---|
| `project:{id}` | Models page, Project home page | Runner, Watcher, Init pipeline, `_compile_project` |
| `init:{session_id}` | New project terminal modal | PTY reader, pip install stream |

### Project-scoped Event Types

| Type | Published by | Frontend effect |
|---|---|---|
| `run_started` | `runner.py` | Opens log drawer, clears logs |
| `run_log` | `runner.py` | Appends line to log drawer |
| `run_finished` | `runner.py` | — |
| `run_error` | `runner.py` | — |
| `statuses_changed` | `runs.py` | Invalidates models query → DAG tiles update |
| `graph_changed` | `watcher.py`, `models.py` | Invalidates models query → DAG re-renders |
| `files_changed` | `watcher.py` | — (graph_changed handles the visual update) |
| `compile_started` | `models.py` | Shows "Compiling…" spinner in filter bar |
| `compile_finished` | `models.py` | Hides spinner |
| `init_pipeline_started` | `init.py` | Init modal shows step list |
| `init_step` | `init.py` | Init modal updates step status |
| `init_pipeline_finished` | `init.py` | Init modal shows success/error; navigates on success |

### Init Session Event Types

| Type | Published by | Frontend effect |
|---|---|---|
| `init_output` | `interactive.py`, pip install stream | Writes chunk to xterm.js terminal |
| `init_finished` | `interactive.py` | Shows "Done" footer; triggers rescan on close |

### SSE with Replay (`events/sse.py`)

Init session events use a replay buffer. When a subscriber connects, the SSE endpoint first sends all buffered output chunks, then streams live events. This ensures the terminal shows complete output even if the user opens the modal after output has already started (e.g., during a slow pip install).

Standard project events do not replay.

---

## Key Flows

### 1. Project Discovery

On startup and on `POST /api/projects/rescan`:
1. `discovery.py` walks the workspace directory for `dbt_project.yml` files
2. For each project, reads `profile:` from the YAML and looks up the adapter type in `profiles.yml` (checks project dir → parent dir → `~/.dbt/profiles.yml`)
3. `service.py` upserts rows into `projects` — new projects are added, existing rows have `name`/`platform`/`profile` refreshed, removed projects are deleted

### 2. Opening a Project (Init Pipeline)

`POST /api/projects/{id}/open` → background task `_run_init_steps()`:
1. Publishes `init_pipeline_started`
2. For each enabled `InitStep` in order:
   - Publishes `init_step {status: running}`
   - Runs the step: `cd` (existence check), `dbt deps`, or `bash <script_path>`
   - Publishes `init_step {status: success|error, log, return_code}`
   - Stops on first failure
3. Publishes `init_pipeline_finished`

The frontend `InitStepsModal` subscribes to project SSE and renders a live progress list.

### 3. Models DAG

`GET /api/projects/{id}/models`:
1. Loads `target/manifest.json` with the custom parser in `manifest.py`
2. Extracts nodes (models, seeds, snapshots, sources, tests) and parent→child edges from `parent_map`
3. Merges with latest `ModelStatus` rows from SQLite
4. Returns `GraphDto {nodes, edges}`

The frontend runs `dagre` layout on the nodes client-side and renders them with React Flow. Node colors reflect live status. Clicking a node opens the side panel with run controls and "Edit SQL".

### 4. Running dbt

`POST /api/projects/{id}/run` (same pattern for build/test):
1. `select.py` builds the `--select` string from `(model_name, mode)` — e.g. `+my_model+` for full
2. `runner.py` spawns `dbt run --select <selector>` as an async subprocess
3. Each stdout/stderr line is published as `run_log`
4. On exit, `run_results.py` parses `target/run_results.json` and upserts `ModelStatus` rows
5. Publishes `statuses_changed` → frontend invalidates models query → DAG tiles update colors

### 5. Creating a New Model

`POST /api/projects/{id}/models`:
1. Validates name (alphanumeric + `_-`, with `/` for subdirectories)
2. Writes `models/<name>.sql` with the provided SQL (or a default scaffold)
3. Spawns `dbt compile` as a background task
4. Publishes `compile_started` → frontend shows spinner
5. On compile success, publishes `compile_finished` + `graph_changed` → frontend hides spinner and refreshes DAG

### 6. Interactive `dbt init`

1. Frontend shows platform picker (Postgres, DuckDB, Athena, etc.)
2. `POST /api/projects/init-session/start {platform}` creates a pending session and returns `session_id`
3. Background task `_pip_install_and_start_pty()`:
   - Reads shebang of system `dbt` binary to find its Python interpreter
   - Runs `<dbt-python> -m pip install dbt-<platform>` streaming output as `init_output` events
   - On success, spawns `dbt init` in a PTY via `ptyprocess`
   - PTY reader task publishes `init_output` chunks; accumulates them in `replay_buffer`
4. Frontend subscribes to `GET /api/projects/init-session/{id}/events` (SSE with replay)
5. xterm.js renders all output; keyboard/paste input forwarded via `POST .../input`
6. On `init_finished`, frontend calls `api.projects.rescan()` then closes modal — project appears in list

### 7. File Watching

`WatcherManager` runs a supervisor loop that starts one `watchfiles.awatch` task per known project. Watched paths include `models/`, `tests/`, `seeds/`, `snapshots/`, `macros/`, and `target/`.

- `.sql`/`.yml` changes → `files_changed` event
- `manifest.json` or `run_results.json` changes → `graph_changed` event

The supervisor re-syncs every 10 seconds to pick up newly added projects.

---

## Configuration

All settings are via environment variables (with defaults):

| Variable | Default | Description |
|---|---|---|
| `DBT_UI_WORKSPACE` | `/workspace` | Root directory scanned for dbt projects |
| `DBT_UI_DATA_DIR` | `/data` | Directory for SQLite database |
| `DBT_UI_DATABASE_URL` | _(derived from DATA_DIR)_ | Override SQLite path or use a different DB URL |
| `DBT_UI_FRONTEND_DIST` | `/app/frontend_dist` | Path to built React SPA |
| `DBT_UI_LOG_LEVEL` | `INFO` | structlog level |

In local development, `DBT_UI_WORKSPACE` defaults to `./workspace` and `DBT_UI_DATA_DIR` to `./data` (relative to the backend working directory).

---

## Deployment

### Docker (production)

A single multi-stage `Dockerfile`:
1. `node:20-alpine` builds the React SPA (`npm run build`)
2. `python:3.12-slim` installs Python deps and copies the built frontend dist

`docker-compose.yml` mounts the user's dbt projects at `/workspace` and a named volume for SQLite at `/data`. The container binds on `127.0.0.1:8000` — not accessible off-host.

```
docker compose up --build
```

### Local Development

```
task install    # create venv, pip install, npm install
task start      # runs backend (:8001) and frontend Vite dev server (:5173) in parallel
```

The Vite dev server proxies all `/api` requests to `localhost:8001`. The backend serves the built SPA in production but is not involved in frontend HMR during development.

---

## Design Decisions

**Subprocess over dbtRunner** — `dbtRunner` (dbt's Python API) is not safe for concurrent use: it modifies global state and is not re-entrant. Using a subprocess per invocation isolates execution completely and allows streaming stdout line-by-line.

**SSE over WebSockets** — All communication is server→client. SSE is sufficient, simpler, and has built-in browser reconnect. WebSockets would add bidirectional complexity for no benefit.

**In-memory event bus** — A Redis or database-backed queue would add ops overhead for a local-only tool. The in-memory bus is zero-config and fast enough; events lost on restart are acceptable (the next page load re-fetches current state from disk).

**Replay buffer for PTY only** — Run log events are ephemeral (the log file on disk is the durable record). PTY output has no equivalent durable store, so the replay buffer fills that gap for the init terminal.

**SQLite** — Single-user, local tool. No concurrent writes from multiple processes. SQLite with aiosqlite is zero-ops and sufficient.

**Platform inference at rescan** — Platform is derived by reading `profiles.yml` at discovery time and stored in the DB. Checked in order: project dir → parent dir → `~/.dbt/profiles.yml`. Re-evaluated on every rescan (including at startup) so stale values are always refreshed.
