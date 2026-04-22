# Doc Update Rule

## When to Update Docs

After **any code change** that affects the observable behavior of dbt-ui, update the relevant docs before marking work complete. This includes:

- New API endpoints or routes
- New database tables or columns
- New environment variables or global settings
- New init pipeline steps or behaviors
- New global/project-level features (profiles, requirements, etc.)
- Changes to the init pipeline logic
- Changes to configuration defaults

## What to Update

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

## How to Verify

Before marking done:
- [ ] `CLAUDE.md` database tables section matches `backend/app/db/models.py`
- [ ] `docs/architecture.md` API routes match actual FastAPI routers
- [ ] `docs/architecture.md` Configuration table includes all env vars from `backend/app/config.py`
- [ ] `README.md` env var table matches above
- [ ] `README.md` Features list mentions the new feature (if user-facing)

## Scope Rule

Only update what changed. Do not rewrite whole sections for minor additions — add a row, line, or paragraph. Keep docs accurate and concise.
