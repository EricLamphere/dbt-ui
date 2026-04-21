# dbt-ui

An open-source, local-first web UI for [dbt-core](https://github.com/dbt-labs/dbt-core).

Gives you an interactive dependency graph, live run/build/test controls with streaming logs, an integrated terminal, an in-browser SQL editor, and project discovery — all running locally against your dbt projects.

## Features

- **Project discovery** — scans a configured directory for `dbt_project.yml` files and lists all projects
- **Interactive DAG** — React Flow graph of all models and their lineage with live status badges; models turn blue in real time while running
- **Run / build / test** — trigger dbt commands from any model tile with upstream / downstream / full selector support; logs stream live in the bottom pane
- **Execution DAG** — bottom pane shows only the models that ran, with real-time running/success/error status
- **Integrated terminal** — VSCode-style multi-tab terminal in the bottom pane (bash/zsh)
- **SQL editor** — view and edit model SQL in-browser with Monaco (VS Code engine); saves to disk
- **Live updates** — file watcher resets stale model tiles within ~200ms of a file change; manifest/run_results parsed on the fly
- **Init pipeline** — configurable, sortable initialization steps (`dbt deps` + custom shell scripts) shown in a step-status modal
- **Interactive `dbt init`** — create new projects in a full xterm.js terminal modal
- **Global settings** — configure your dbt projects path from within the UI

## Quickstart

### Prerequisites

- Docker + Docker Compose

### 1. Start

```bash
task up
# or: docker compose up --build -d
```

Open [http://localhost:8000](http://localhost:8000).

### 2. Configure your projects path

On first launch, a banner prompts you to set **DBT_PROJECTS_PATH** — the directory containing your dbt projects. Click **Configure** and enter the path. The project list loads once the path is set.

### 3. Stop

```bash
task down
```

## Development

### Prerequisites

- Python 3.11+
- Node.js 20+
- [Task](https://taskfile.dev) (`brew install go-task`)

### Install

```bash
task install        # installs backend venv + frontend node_modules
```

### Run dev servers

```bash
task start          # backend + frontend in parallel
```

Or run separately:

```bash
task dev:backend    # FastAPI with hot reload (:8001)
task dev:frontend   # Vite dev server, proxies /api → :8001 (:5173)
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
├── backend/          FastAPI, SQLAlchemy/aiosqlite, watchfiles, sse-starlette, ptyprocess
│   └── app/
│       ├── api/      REST endpoints + SSE (projects, models, runs, init, terminal, settings, …)
│       ├── db/       SQLAlchemy models (8 tables) + startup migrations
│       ├── dbt/      manifest parser, run_results, subprocess runner, init scripts, PTY manager
│       ├── events/   in-process pub/sub EventBus, SSE helpers
│       ├── projects/ discovery + service (_effective_workspace)
│       └── watcher/  watchfiles per-project task
├── frontend/         React + Vite + TypeScript
│   └── src/
│       ├── routes/   Home, Project/index, Models, Docs, FileExplorer, Environment, InitScripts
│       ├── components/ Header, StatusBadge, shared UI
│       └── lib/      api.ts, sse.ts (useProjectEvents, useInitSessionEvents, useTerminalEvents)
├── docs/
│   └── architecture.md
├── data/             SQLite database (git-ignored; volume-mounted in Docker)
├── docker-compose.yml
└── Taskfile.yml
```

**Stack highlights:**
- Backend: FastAPI, SQLAlchemy (async), aiosqlite, sse-starlette, watchfiles, ptyprocess
- Frontend: React 18, Vite, TypeScript, @xyflow/react, dagre, Monaco, xterm.js, TanStack Query, Tailwind CSS
- DB: SQLite (8 tables; bind-mounted volume in Docker)
- dbt invocation: subprocess only (serialized per project via asyncio.Lock)

## Environment Variables

These are set automatically in Docker. Only needed if running outside Docker without `task dev:backend`.

| Variable | Default | Description |
|---|---|---|
| `DBT_PROJECTS_PATH` | _(none)_ | Root directory scanned for dbt projects (overridable via UI) |
| `DBT_UI_DATA_DIR` | `/data` | SQLite storage directory |
| `DBT_UI_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

## License

MIT
