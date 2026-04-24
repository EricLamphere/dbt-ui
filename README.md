# dbt-ui

An open-source, local-first web UI for [dbt-core](https://github.com/dbt-labs/dbt-core).

Gives you an interactive dependency graph, live run/build/test controls with streaming logs, an integrated terminal, an in-browser SQL editor, and project discovery — all running locally against your dbt projects.

Built with <img src="img/claude-code.png" width="30" height="30" align="center">

## Features

- **Project discovery** — scans a configured directory for `dbt_project.yml` files and lists all projects
- **Interactive DAG** — React Flow graph of all models and their lineage with live status badges; models turn blue in real time while running; dbt-style filter bar (`+model`, `tag:x`, type/materialization/tag/status dropdowns) with upstream/downstream graph traversal
- **Run / build / test** — trigger dbt commands from any model tile with upstream / downstream / full selector support; logs stream live in the bottom pane
- **Execution DAG** — bottom pane shows only the models that ran, with real-time running/success/error status
- **Side panel** — collapsible right-side panel on both the DAG and File Explorer pages; shows model metadata, run controls, and action buttons in a single unified view
- **Profile & target selectors** — header dropdowns to switch environment profiles and dbt targets on any project page; target is passed as `--target` on every dbt invocation
- **Project homepage files** — README, `dbt_project.yml`, and `profiles.yml` rendered in a tabbed Monaco viewer on the project homepage
- **Integrated terminal** — VSCode-style multi-tab terminal in the bottom pane (bash/zsh)
- **SQL editor** — view and edit model SQL in-browser with Monaco (VS Code engine); saves to disk
- **Live updates** — file watcher resets stale model tiles within ~200ms of a file change; manifest/run_results parsed on the fly
- **Init pipeline** — configurable, sortable initialization steps (`dbt deps` + custom shell scripts) shown in a step-status modal
- **Interactive `dbt init`** — create new projects in a full xterm.js terminal modal; writes `profiles.yml` into the new project directory automatically
- **Project-local profiles** — `profiles.yml` co-located in the project directory; dbt invocations use `--profiles-dir` automatically when the file is present
- **Global settings** — configure your dbt projects path, global requirements file, and other options from within the UI
- **Requirements install** — init pipeline installs a global `requirements.txt` and an optional per-project `REQUIREMENTS_PATH` into the dbt venv automatically before running `dbt deps`
- **Global env profiles** — define named environment variable sets globally and import them into any project as a starting point
- **Project ignore** — mark projects as ignored so they are hidden from the project list without being deleted
- **Init-script env var capture** — `export KEY=value` statements in init scripts are automatically captured and stored per-project; injected into all dbt commands (e.g. `SNOWFLAKE_ACCOUNT`) without manual configuration
- **Headless mode** — `task start:bg` daemonizes both servers and opens the browser; `task stop` frees the ports

## Quickstart

### Prerequisites

- Python 3.11+
- Node.js 20+
- [Task](https://taskfile.dev) (`brew install go-task`)

### 1. Install dependencies

```bash
task install
# or pin a specific Python version:
task install PYTHON=python3.12
```

### 2. Start

```bash
task start       # foreground — logs stream to terminal
task start:bg    # headless — daemonizes both servers, opens browser automatically
```

Open [http://localhost:5173](http://localhost:5173).

To stop a headless session:

```bash
task stop
```

### 3. Configure your projects path

On first launch, a banner prompts you to set **DBT_UI_PROJECTS_PATH** — the directory containing your dbt projects. Click **Configure** and enter the path. The project list loads once the path is set.

You can also set it via environment variable instead of the UI:

```bash
export DBT_UI_PROJECTS_PATH=$HOME/dbt-projects
task start
```

## Development

### Run dev servers

```bash
task start          # backend + frontend in parallel (foreground)
task start:bg       # headless daemon mode; logs → data/logs/
task stop           # kill headless daemons
```

Or run separately:

```bash
task dev:backend    # FastAPI with hot reload (:8001)
task dev:frontend   # Vite dev server, proxies /api → :8001 (:5173)
```

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
│       ├── api/      REST endpoints + SSE (projects, models, runs, init, terminal, docs, settings, …)
│       ├── db/       SQLAlchemy models (10 tables) + idempotent startup migrations
│       ├── dbt/      manifest parser, run_results, subprocess runner, venv binary helpers, init scripts, PTY manager
│       ├── events/   in-process pub/sub EventBus, SSE helpers
│       ├── projects/ discovery + service (_effective_workspace)
│       └── watcher/  watchfiles per-project task
├── frontend/         React + Vite + TypeScript
│   └── src/
│       ├── routes/   Home, Project/index, Models (DAG + filter), Docs, FileExplorer, Environment, InitScripts
│       ├── components/ Header, StatusBadge, GlobalSetupModal, shared UI
│       └── lib/      api.ts, sse.ts (useProjectEvents, useInitSessionEvents, useTerminalEvents)
├── docs/
│   └── architecture.md
├── data/             SQLite database + daemon pid files + logs (git-ignored)
└── Taskfile.yml
```

**Stack highlights:**
- Backend: FastAPI, SQLAlchemy (async), aiosqlite, sse-starlette, watchfiles, ptyprocess
- Frontend: React 18, Vite, TypeScript, @xyflow/react, dagre, Monaco, xterm.js, TanStack Query, Tailwind CSS
- DB: SQLite (10 tables)
- dbt invocation: subprocess only via `backend/.venv/bin/dbt` (serialized per project via asyncio.Lock)

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DBT_UI_PROJECTS_PATH` | _(none)_ | Root directory scanned for dbt projects (overridable via UI) |
| `DBT_UI_DATA_DIR` | `data/` | SQLite storage directory |
| `DBT_UI_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |

The following are stored in the DB via the Global Settings UI and override the environment variables above:

| Setting key | Description |
|---|---|
| `dbt_projects_path` | Overrides `DBT_UI_PROJECTS_PATH` |
| `global_requirements_path` | Path to a `requirements.txt` installed into the dbt venv on every project open |
| `data_dir` | Overrides `DBT_UI_DATA_DIR` |
| `log_level` | Overrides `DBT_UI_LOG_LEVEL` |

Per-project settings (stored in `project_env_vars`, injected into every dbt subprocess):

| Key | Set by | Description | Default |
|---|---|---|---|
| `INIT_SCRIPT_PATH` | Environment tab | Directory (relative to project root) scanned for `.sh` init scripts | `init` |
| `REQUIREMENTS_PATH` | Environment tab | Path to a project-specific `requirements.txt`; installed in addition to the global one | _(none)_ |
| `dbt_target` | Target dropdown | Active dbt target; passed as `--target` on every invocation | _(profiles.yml default)_ |
| _(any key)_ | Init scripts (automatic) | Any `export KEY=value` in a custom init script is captured and stored here automatically | — |


## Gallery

#### Homepage
![Homepage](img/home.png)

#### Project Homepage
![Project Homepage](img/project_home.png)

#### File Explorer
![File Explorer](img/files_model.png)

#### DAG
![DAG](img/dag_logs.png)

#### Docs
![Docs Overview](img/docs_overview.png)

![Docs Model](img/docs_model.png)





## License

MIT
