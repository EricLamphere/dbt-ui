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
- **Column-level lineage** (dbt-ui Pro) — click any column in the DAG to trace its data flow upstream and downstream across models; edges highlight the exact columns that feed into each transformation. Lineage is derived from each model's compiled SQL (no yml column documentation required) and computed in the background across multiple worker processes, with a live progress indicator. Requires an active dbt-ui Pro license — see the in-app **Upgrade to Pro** page (`/pricing`) for a side-by-side feature comparison and license key activation
- **Column-level test coverage heatmap** — optional overlay on the DAG showing per-column test coverage with visual buckets (untested/1 test/2 tests/3+ tests); model headers show overall coverage percentage with color-coded badges
- **Command palette** — ⌘K / Ctrl+K to open a VS Code-style command palette. On the homepage: open any project by name, create a new project, rescan, or open global settings. Inside a project: quick navigation (go to any page), running dbt commands, and searching models
- **Source control (Git)** — VSCode-style source control panel: view changed files, stage/unstage, Monaco diff viewer, commit, push/pull with live streaming output, branch switch/create, and commit history
- **SQL Workspace** — standalone SQL scratchpad with a file tree, Monaco editor, Compiled SQL tab (via `dbt compile --inline`), and a resizable results pane (via `dbt show --inline`); files are saved under a configurable `workspace/` folder inside the project; Cmd+Enter runs, Cmd+S saves
- **Autocomplete** - Autocomplete on refs, sources, and documented columns to make writing and running jinja SQL easier than ever
- **Health check** — run `dbt debug` from the UI and see a structured pass/fail table per check (connection, profiles.yml, project.yml, etc.) with version info and raw log
- **Schema drift** — scan all materialized models and compare warehouse column schemas against `manifest.json` declarations; shows per-model diffs (added/removed/type-mismatch columns)
- **Column profiling** — run a column profile on any model from the SidePane to see row count, null%, distinct count, min/max, and sample values per column
- **Run history** — paginated log of every dbt invocation with command, selector, duration, and node count; click any run to open a detail panel showing per-node execution times, status, and result messages; expand any node row to see a sparkline trend across its last 20 runs; raw dbt log available on a separate tab; filter by command or status

## Stack highlights
- Backend: FastAPI, SQLAlchemy (async), aiosqlite, sse-starlette, watchfiles, ptyprocess
- Frontend: React 18, Vite, TypeScript, @xyflow/react, dagre, Monaco, xterm.js, TanStack Query, Tailwind CSS
- DB: SQLite (11 tables)
- dbt invocation: subprocess only, always into an isolated venv (serialized per project via asyncio.Lock) — the venv lives at `backend/.venv` in dev mode, or in the OS user-data directory (e.g. `~/Library/Application Support/dbt-ui/dbt-venv` on macOS) for the packaged desktop app

## Quickstart

dbt-ui can be run two ways: as a native desktop app (no Python/Node setup required), or from source for development.

### Desktop app

Download the latest macOS build from [GitHub Releases](https://github.com/EricLamphere/dbt-ui/releases), or build it yourself:

```bash
task package:app
```

This produces `dbt-ui.app` and `dbt-ui_<version>_<arch>.dmg` under `src-tauri/target/release/bundle/`. The app needs `dbt` and `git` to already be reachable — `dbt` gets installed into an isolated venv (created automatically via your system Python) the first time you run **Run global setup** from the app; `git` must already be on `PATH`.

**The build is ad-hoc signed, not notarized** — there's no paid Apple Developer ID behind it yet (Windows/Linux packaging isn't set up either). Because the DMG is downloaded via a browser, macOS quarantines it and Gatekeeper will say **"dbt-ui.app is from an unidentified developer."** To run it: right-click (or Control-click) `dbt-ui.app` in `/Applications` → **Open** → **Open** again in the confirmation dialog. This only needs to be done once per machine, per download.

If you instead see **"dbt-ui is damaged and can't be opened"** (this happens on a build from before ad-hoc signing was added, or if you built it yourself without `signingIdentity` set), that message means Gatekeeper is rejecting a fully unsigned binary — right-click → Open won't help in that case. Clear the quarantine attribute manually instead:

```bash
xattr -cr /Applications/dbt-ui.app
```

### From source

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
```

Open [http://localhost:5173](http://localhost:5173).

### 3. Configure your projects path

On first launch, a banner prompts you to set **DBT_UI_PROJECTS_PATH** — the directory containing your dbt projects. Click **Configure** and enter the path. The project list loads once the path is set.

You can also set it via environment variable instead of the UI:

```bash
export DBT_UI_PROJECTS_PATH=$HOME/dbt-projects
task start
```


## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DBT_UI_PROJECTS_PATH` | _(none)_ | Root directory scanned for dbt projects (overridable via UI) |
| `DBT_UI_GLOBAL_REQUIREMENTS_PATH` | _(none)_ | Path to a `requirements.txt` installed into the dbt venv on every project open |
| `DBT_UI_DATA_DIR` | `data/` (dev) / OS user-data dir (packaged app) | SQLite storage directory |
| `DBT_UI_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `POLAR_USE_SANDBOX` | `true` | Which Polar environment (sandbox/production) license checks talk to |
| `POLAR_SANDBOX_ORGANIZATION_ID` / `POLAR_PRODUCTION_ORGANIZATION_ID` | _(none)_ | Polar org id used to validate license keys (not a secret) |
| `POLAR_SANDBOX_API_KEY` / `POLAR_PRODUCTION_API_KEY` | _(none)_ | Polar API key — **secret**, set in `backend/.env` only, never commit |
| `POLAR_SANDBOX_CHECKOUT_URL` / `POLAR_PRODUCTION_CHECKOUT_URL` | _(none)_ | Checkout link shown in the in-app "Upgrade to Pro" modal |

Per-project settings (stored in `project_env_vars`, injected into every dbt subprocess):

| Key | Set by | Description | Default |
|---|---|---|---|
| `INIT_SCRIPT_PATH` | Environment tab | Directory (relative to project root) scanned for `.sh` init scripts | `init` |
| `REQUIREMENTS_PATH` | Environment tab | Path to a project-specific `requirements.txt`; installed in addition to the global one | _(none)_ |
| `WORKSPACE_PATH` | Environment tab | Directory (relative to project root) where SQL Workspace files are stored | `workspace` |
| `dbt_target` | Target dropdown | Active dbt target; passed as `--target` on every invocation | _(profiles.yml default)_ |
| _(any key)_ | Init scripts (automatic) | Any `export KEY=value` in a custom init script is captured and stored here automatically | — |


## Gallery

#### Homepage
![Homepage](img/home.png)

#### Global Settings
![Global Settings](img/settings.png)

#### Project Homepage
![Project Homepage](img/project_home.png)

#### Environment
![Environment](img/environment.png)

#### Initialization
![Initialization](img/initialization.png)

#### File Explorer
![File Explorer](img/file_explorer.png)

![File Explorer — Data Preview](img/file_explorer_data_preview.png)

![File Explorer — Column Profile](img/file_explorer_profile.png)

#### DAG
![DAG](img/dag_view.png)

#### Column-Level Lineage (Pro)
![Column Lineage](img/column_lineage.png)

#### Docs
![Docs — Model](img/docs_model.png)

![Docs — Macro](img/docs_macro.png)

#### SQL Workspace
![SQL Workspace](img/sql_workspace.png)

#### Run History
![Run History](img/run_history.png)

#### Health
![dbt Health Check](img/health_check.png)

![Schema Drift](img/schema_drift.png)

![Source Freshness](img/source_freshness.png)

#### Source Control
![Source Control](img/source_control.png)

#### Light Theme
![Light Theme](img/light_theme.png)



## License

MIT
