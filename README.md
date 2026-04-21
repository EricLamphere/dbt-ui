# dbt-ui

An open-source, local-first web UI for [dbt-core](https://github.com/dbt-labs/dbt-core).

Gives you an interactive dependency graph, live run/build/test controls with streaming logs, an in-browser SQL editor, and project discovery — all running in Docker against your local dbt projects.

## Features

- **Project discovery** — scans a workspace directory for `dbt_project.yml` files and lists all projects
- **Interactive DAG** — React Flow graph of all models and their lineage with live status badges
- **Run / build / test** — trigger dbt commands from any model tile with upstream / downstream / full selector support; logs stream live
- **SQL editor** — view and edit model SQL in-browser with Monaco (VS Code engine); saves to disk
- **Live updates** — file watcher resets stale model tiles within ~200ms of a file change; manifest/run_results parsed on the fly
- **Init pipeline** — configurable, sortable initialization steps (`dbt deps` + custom shell scripts) shown in a step-status modal
- **Interactive `dbt init`** — create new projects in a full xterm.js terminal modal

## Quickstart

### Prerequisites
- Docker + Docker Compose

### 1. Point it at your dbt projects

```bash
# Default: ~/dbt-projects
export DBT_UI_WORKSPACE_HOST=$HOME/dbt-projects
```

Or edit the volume in `docker-compose.yml`:
```yaml
volumes:
  - /path/to/your/projects:/workspace
```

### 2. Start

```bash
task up
# or: docker compose up --build -d
```

Open [http://localhost:8000](http://localhost:8000).

### 3. Stop

```bash
task down
```

## Development

### Install

```bash
task install        # installs backend venv + frontend node_modules
```

### Run dev servers

```bash
# Terminal 1 — FastAPI with hot reload
task dev:backend

# Terminal 2 — Vite dev server (proxies /api → :8000)
task dev:frontend
```

Open [http://localhost:5173](http://localhost:5173).

### Tests

```bash
task test           # backend pytest + frontend tsc check
task test:backend   # pytest with coverage report
```

### Lint

```bash
task lint
```

### Reset database

```bash
task db:reset
```

## Architecture

```
dbt-ui/
├── backend/          FastAPI, SQLAlchemy/aiosqlite, watchfiles, sse-starlette
│   └── app/
│       ├── api/      REST endpoints + SSE
│       ├── db/       SQLAlchemy models (Project, InitStep, ModelStatus, RunInvocation)
│       ├── dbt/      manifest parser, run_results, subprocess runner, init scripts, PTY
│       ├── events/   in-process pub/sub EventBus, SSE helper
│       └── watcher/  watchfiles per-project task
├── frontend/         React + Vite + TypeScript
│   └── src/
│       ├── routes/   Home, Project/index, Project/Models
│       ├── components/ Header, StatusBadge
│       └── lib/      api.ts, sse.ts (useProjectEvents, useInitSessionEvents)
├── docker-compose.yml
└── Taskfile.yml
```

**Stack highlights:**
- Backend: FastAPI, SQLAlchemy (async), aiosqlite, sse-starlette, watchfiles, ptyprocess
- Frontend: React 18, Vite, TypeScript, React Flow (@xyflow/react), dagre, Monaco, xterm.js, TanStack Query, Tailwind CSS
- DB: SQLite (bind-mounted volume)
- Invocation: `dbt` subprocess (serialized per project) — not `dbtRunner` (not parallel-safe)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DBT_UI_WORKSPACE` | `/workspace` | Path to dbt projects root inside container |
| `DBT_UI_DATA_DIR` | `/data` | SQLite storage directory |
| `DBT_UI_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `DBT_UI_VSCODE_CMD` | `code` | Command used to open VS Code |
| `DBT_UI_WORKSPACE_HOST` | `~/dbt-projects` | Host path bind-mounted at docker compose time |

## License

MIT
