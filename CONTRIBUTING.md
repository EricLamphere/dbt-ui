# Contributing to dbt-ui

Thanks for helping out. This guide covers setting up a dev environment, the project's conventions, and how the desktop app is built and released. For what dbt-ui is and how to download it, see the [README](README.md).

## Getting set up

**Prerequisites:** Python 3.11+, Node.js 20+, [Task](https://taskfile.dev) (`brew install go-task`). Building the desktop app also needs Rust and the Tauri CLI (`cargo install tauri-cli`).

```bash
task install                    # create backend/.venv, pip install, npm install
task install PYTHON=python3.12  # or pin a specific Python interpreter
task start                      # backend on :8001 + Vite on :5173, hot reload; auto-installs missing/stale deps
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to the backend on `:8001`.

On first launch a banner asks for your dbt projects folder (**DBT_UI_PROJECTS_PATH**). Set it in the UI, or with an environment variable:

```bash
export DBT_UI_PROJECTS_PATH=$HOME/dbt-projects
task start
```

## Everyday commands

| Command | What it does |
|---|---|
| `task start` | Run the app in the browser with hot reload |
| `task test` | Backend tests + frontend type-check and build |
| `task test:backend` | `pytest --cov=app` only |
| `task test:frontend` | `tsc` + `vite build` only |
| `task lint` | `ruff` on the backend |
| `task db:reset` | Delete the local SQLite database |
| `task reset` | Full reset: wipe the DB, delete the venv, reinstall |
| `task package:app` | Build the desktop app (free features) and install it to `/Applications` |

Run a single backend test file with `cd backend && .venv/bin/pytest tests/test_x.py -xvs`.

## How the code is organized

- **[docs/architecture.md](docs/architecture.md)** — stack, repository layout, database schema, API routes, events, and the key flows. Start here.
- **[docs/how-to/](docs/how-to/README.md)** — user-facing guides for each part of the app.
- **[CLAUDE.md](CLAUDE.md)** and **[.claude/rules/](.claude/rules/)** — the project's conventions in detail. They're written for AI coding assistants but are just as useful for people.

**Stack:** FastAPI, async SQLAlchemy + SQLite (aiosqlite), sse-starlette, watchfiles, and ptyprocess on the backend; React 18, TypeScript, Vite, Tailwind, TanStack Query, @xyflow/react + dagre, Monaco, and xterm.js on the frontend; Tauri for the desktop shell.

The rules that matter most:

- **dbt and git run as subprocesses only**, through the `runner` / `git_runner` singletons, which serialize commands per project. Never `import dbt`.
- **Frontend API calls go through the typed helpers in `frontend/src/lib/api.ts`**, never raw `fetch()`.
- **Server changes reach the UI over SSE** (`useProjectEvents` and friends in `lib/sse.ts`), which invalidates TanStack Query caches. Don't poll.
- **Database migrations are idempotent DDL** in `backend/app/db/migrations.py`, run on startup. There's no Alembic.
- **Tabular data uses the shared `DataTable` component.**

## Configuration

| Variable | Default | Description |
|---|---|---|
| `DBT_UI_PROJECTS_PATH` | _(none)_ | Root directory scanned for dbt projects (overridable in the UI) |
| `DBT_UI_GLOBAL_REQUIREMENTS_PATH` | _(none)_ | `requirements.txt` installed into the dbt venv on every project open |
| `DBT_UI_DATA_DIR` | `data/` (dev) / OS user-data dir (desktop app) | SQLite storage directory |
| `DBT_UI_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `POLAR_USE_SANDBOX` | `true` | Which Polar environment (sandbox/production) license checks talk to |
| `POLAR_SANDBOX_ORGANIZATION_ID` / `POLAR_PRODUCTION_ORGANIZATION_ID` | _(none)_ | Polar org id used to validate license keys (not a secret) |
| `POLAR_SANDBOX_API_KEY` / `POLAR_PRODUCTION_API_KEY` | _(none)_ | Polar API key — **secret**, set in `backend/.env` only, never commit |
| `POLAR_SANDBOX_CHECKOUT_URL` / `POLAR_PRODUCTION_CHECKOUT_URL` | _(none)_ | Checkout link behind the in-app **Upgrade to Pro** button |

You don't need any of the Polar variables to work on dbt-ui. Without them, Pro features simply stay locked.

Per-project settings are stored in `project_env_vars` and injected into every dbt subprocess:

| Key | Set by | Description | Default |
|---|---|---|---|
| `INIT_SCRIPT_PATH` | Environment tab | Directory (relative to the project root) scanned for `.sh` init scripts | `dbtui/init` |
| `REQUIREMENTS_PATH` | Environment tab | Project-specific `requirements.txt`, installed after the global one | _(none)_ |
| `WORKSPACE_PATH` | Environment tab | Directory (relative to the project root) for SQL Workspace files | `dbtui/workspace` |
| `dbt_target` | Target dropdown | Active dbt target, passed as `--target` on every invocation | _(profiles.yml default)_ |
| _(any key)_ | Init scripts | Any `export KEY=value` in a custom init script is captured automatically | — |

## dbt-ui Pro and the open-core split

Pro features (currently column-level lineage) are gated by a license check in this repo, but the actual lineage algorithm lives in a separate private package, `dbt-ui-pro`. `backend/app/dbt/column_lineage.py` is a thin public shim that raises `ColumnLineageUnavailable` when the package isn't installed.

**You don't need `dbt-ui-pro` to contribute.** Everything else builds and runs without it. Pro features just show as unavailable, exactly as they do for a free user.

## Building the desktop app

The desktop app is a Tauri shell around the PyInstaller-bundled backend and the built frontend.

| Task | Builds | Who it's for |
|---|---|---|
| `task package:app` | Free features, no licensing config | Anyone — the one to use when contributing |
| `task package:sandbox:base` | Free features, Polar sandbox | Maintainers (needs `backend/.env.sandbox`) |
| `task package:sandbox:pro` | Pro features, Polar sandbox | Maintainers (needs `dbt-ui-pro` + `backend/.env.sandbox`) |
| `task package:production` | Pro features, Polar production | Maintainers — the real release build |

Each one builds the app and installs it to `/Applications/dbt-ui.app`. The build output (`.app` and `.dmg`) lands in `src-tauri/target/release/bundle/`. Local builds are ad-hoc signed, which is fine for running on your own Mac.

## Releasing (maintainers)

Releases are Developer ID signed and notarized by Apple.

1. Put your Apple credentials in `.env.signing` (gitignored; copy `.env.signing.example`). You need a **Developer ID Application** certificate in your keychain and an app-specific password.
2. Run `/release` in Claude Code, which bumps the version everywhere and runs the release, or bump the version yourself and run `task release`.

`task release` builds with `package:production`, signs the backend binaries and the app, notarizes and staples the `.dmg`, checks it with `spctl`, and creates GitHub release `v<version>`. It uploads the `.dmg` twice: with its versioned name, and as `dbt-ui_aarch64.dmg`, which the website's Download buttons link to via `releases/latest/download/`.

## Submitting changes

- Branch off `main` and open a pull request.
- Use conventional commit messages: `feat: …`, `fix: …`, `refactor: …`, `docs: …`, `test: …`, `chore: …`.
- Add or update tests for behavior changes, and make sure `task test` and `task lint` pass.
- Update the docs your change affects: `docs/architecture.md` for routes, tables, and flows, the relevant `docs/how-to/` guide for user-facing changes, and the README's feature list for new features.
