# Doc Update Rule

## MANDATORY: Update docs after every code change

After **any code change** that affects the observable behavior of dbt-ui, you MUST update the relevant docs before marking work complete. This is not optional — skipping doc updates is a bug.

Changes that require doc updates:
- New API endpoints or routes
- New database tables or columns
- New environment variables or global settings
- New init pipeline steps or behaviors
- New global/project-level features (profiles, requirements, etc.)
- Changes to the init pipeline logic
- Changes to configuration defaults
- New user-facing features or flows

## What to Update

### Core docs

| Changed | Update |
|---------|--------|
| New API endpoint | `docs/architecture.md` → API Routes section |
| New DB table/column | `docs/architecture.md` → Database Schema section; `CLAUDE.md` → Database Tables section |
| New env var or setting | `docs/architecture.md` → Configuration table; `README.md` → Environment Variables table; `CLAUDE.md` → Global Settings section |
| New feature with user-facing impact | `README.md` → Features list |
| New key flow or architectural pattern | `docs/architecture.md` → Key Flows or Design Decisions |
| New init step type | `docs/architecture.md` → Init Pipeline section; `CLAUDE.md` → Init Pipeline System |
| New event type | `.claude/rules/event-bus-and-sse.md` event table (use `/new-event` skill instead) |
| New global profile behavior | `docs/architecture.md`; `CLAUDE.md` → Global Settings |

### How-to docs (`docs/how-to/`)

Update or create a how-to guide when a user-facing flow changes:

| Changed | How-to to update |
|---------|-----------------|
| Project creation flow (`NewProjectModal`, `init-session`, `ensure-profiles-yml`) | `docs/how-to/create-project.md` |
| Run/build/test controls, SidePane run grid, RunPanel | `docs/how-to/run-models.md` |
| Environment tab, env vars, profiles, targets, requirements | `docs/how-to/configure-environment.md` |
| Init pipeline steps, init scripts, env var capture | `docs/how-to/init-pipeline.md` |
| DAG view, filter bar, SidePane, deep-link | `docs/how-to/navigate-dag.md` |
| File Explorer, Monaco editor, file tree, model create/delete | `docs/how-to/use-file-explorer.md` |
| TerminalPanel, terminal sessions, multi-tab | `docs/how-to/use-terminal.md` |
| New major user flow (no existing how-to covers it) | Create `docs/how-to/<new-topic>.md`; add to `docs/how-to/README.md` index |

## Verification Checklist

Before marking work complete:
- [ ] `CLAUDE.md` database tables section matches `backend/app/db/models.py`
- [ ] `docs/architecture.md` API routes match actual FastAPI routers
- [ ] `docs/architecture.md` Configuration table includes all env vars from `backend/app/config.py`
- [ ] `README.md` env var table matches above
- [ ] `README.md` Features list mentions the new feature (if user-facing)
- [ ] Relevant `docs/how-to/` guide updated if a user-facing flow changed
- [ ] `docs/how-to/README.md` index updated if a new how-to was created

## Scope Rule

Only update what changed. Do not rewrite whole sections for minor additions — add a row, line, or paragraph. Keep docs accurate and concise.

## On-demand: use `/update-docs`

To trigger a full doc audit and update based on the current git diff, run `/update-docs`. This invokes the `update-docs` skill which reads the diff, identifies affected docs, and updates them.
