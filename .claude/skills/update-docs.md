---
name: update-docs
description: Update README, CLAUDE.md, docs/architecture.md, and docs/how-to/ guides to reflect recent code changes in dbt-ui.
---

<command-instructions>
You are updating the dbt-ui documentation to reflect recent code changes. Read the changed files first to understand what actually changed, then update only the sections that need it.

## Step 1: Identify What Changed

Run `git diff HEAD~1..HEAD --name-only` to find changed files. If there are uncommitted changes, also check `git diff --name-only` (unstaged) and `git diff --cached --name-only` (staged).

For each changed file, determine which docs are affected using the maps below.

## Step 2: Core doc trigger map

| Changed File | Doc Section to Update |
|---|---|
| `backend/app/db/models.py` | `CLAUDE.md` → Database Tables; `docs/architecture.md` → Database Schema |
| `backend/app/api/*.py` | `docs/architecture.md` → API Routes |
| `backend/app/api/settings.py` | `docs/architecture.md` → Configuration; `README.md` → Environment Variables |
| `backend/app/api/init.py` | `CLAUDE.md` → Init Pipeline System; `docs/architecture.md` → Key Flows |
| `backend/app/api/global_profiles.py` | `docs/architecture.md` → API Routes; `CLAUDE.md` → Global Settings |
| `frontend/src/routes/*.tsx` | `README.md` → Features (if user-facing) |
| `backend/app/config.py` | `docs/architecture.md` → Configuration; `README.md` → Environment Variables |

## Step 3: How-to doc trigger map

| Changed File / Area | How-to to Update |
|---|---|
| `NewProjectModal.tsx`, `api/init.py` init-session routes, `ensure-profiles-yml` | `docs/how-to/create-project.md` |
| `api/runs.py`, `SidePane/PropertiesTab.tsx`, `BottomPane/RunPanel.tsx` | `docs/how-to/run-models.md` |
| `Environment.tsx`, `api/env.py`, `api/profiles.py` | `docs/how-to/configure-environment.md` |
| `InitScripts.tsx`, `api/init.py` steps/pipeline routes, `dbt/init_scripts.py` | `docs/how-to/init-pipeline.md` |
| `Models.tsx`, `DagFilterBar.tsx`, `SidePane/`, `lib/dagFilter.ts` | `docs/how-to/navigate-dag.md` |
| `FileExplorer/`, `api/files.py`, `api/sql.py`, `api/models.py` (create/delete) | `docs/how-to/use-file-explorer.md` |
| `BottomPane/TerminalPanel.tsx`, `api/terminal.py`, `dbt/interactive.py` | `docs/how-to/use-terminal.md` |

If a change introduces a brand-new user-facing flow not covered by any existing how-to:
1. Create `docs/how-to/<topic>.md` with a step-by-step guide
2. Add a row to `docs/how-to/README.md`

## Step 4: Update CLAUDE.md

Open `CLAUDE.md`. Update:
- **Database Tables** section — add/update any new tables or columns
- **Init Pipeline System** — if init behavior changed
- **Global Settings** section — if new app_settings keys were added
- **Checklist: Adding a New Global Setting** — if the pattern changed

Keep the existing format. Add rows/lines to tables rather than rewriting.

## Step 5: Update docs/architecture.md

Open `docs/architecture.md`. Update:
- **Database Schema** — add new tables or columns with types and descriptions
- **API Routes** — add new endpoints in the correct group
- **Configuration** — add new env vars with default and description
- **Key Flows** — add or update flows if init pipeline, settings, or project discovery changed
- **Design Decisions** — add a decision only if a non-obvious architectural choice was made

## Step 6: Update README.md

Open `README.md`. Update:
- **Features** list — add a bullet for any user-visible feature
- **Environment Variables** table — add any new variables that users may want to set

## Step 7: Update how-to guides

For each how-to identified in Step 3:
1. Open the file
2. Find the section(s) that describe the changed behavior
3. Update the relevant steps, options, or examples to match the new behavior
4. If the feature is new (not mentioned at all), add a new section

Keep how-to docs step-oriented and user-focused. Describe what the user does, not how the code works.

## Step 8: Verify Consistency

Cross-check:
- All tables in `backend/app/db/models.py` appear in `CLAUDE.md` Database Tables and `docs/architecture.md` Database Schema
- All env vars in `backend/app/api/settings.py` SettingsDto appear in `README.md` env table and `docs/architecture.md` Configuration
- The API routes section in `docs/architecture.md` matches all routes registered in `backend/app/main.py`
- `docs/how-to/README.md` index matches the actual files in `docs/how-to/`

## Step 9: Report

Summarize which doc files were updated and what was added or changed in each. Flag any how-to guides that may need attention but could not be updated without more context.
</command-instructions>
