# dbt-ui

An open-source, local-first web UI for [dbt-core](https://github.com/dbt-labs/dbt-core).

Gives you an interactive dependency graph, live run/build/test controls with streaming logs, an integrated terminal, an in-browser SQL editor, and project discovery — all running locally against your dbt projects.

Built with <img src="img/claude-code.png" width="30" height="30" align="center">

## Features

- **Project discovery** — scans a directory for `dbt_project.yml` files and lists all projects; rescan on demand
- **Interactive functional DAG** — dependency graph with live status badges, dbt-style selector syntax (`+model`, `tag:x`), upstream/downstream traversal, and real-time status updates while models run. Multi-select nodes to run, build, and test multiple models at once
- **Run / build / test** — trigger any dbt command from the side panel with upstream/downstream/full selector support; logs stream live
- **Docs browser** — native dbt docs viewer with searchable column list and cross-navigation to the DAG and file editor
- **File explorer & SQL editor** — browse your project tree and edit model SQL, YAML, and config files in-browser with Monaco (the VS Code editor engine)
- **Integrated terminal** — multi-tab bash/zsh terminal in the bottom pane for running dbt commands directly
- **Init pipeline** — configurable initialization steps (`pip install`, `dbt deps`, custom shell scripts) that run automatically when a project is opened; env vars exported from scripts are captured and injected into all dbt invocations
- **Environment profiles** — define named env var sets globally and apply them per-project; switch profiles and dbt targets from the header
- **Interactive project creation** — `dbt init` runs in a full in-browser terminal; adapter install, profiles.yml setup, and project discovery all handled automatically

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
![File Explorer](img/files_model_exec_dag.png)

#### DAG
![DAG](img/dag_logs.png)

#### Docs
![Docs Overview](img/docs_overview.png)

![Docs Model](img/docs_model_terminal.png)

#### Light Theme
![Light Theme](img/light_theme.png)



## License

MIT
