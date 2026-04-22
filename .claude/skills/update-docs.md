---
name: update-docs
description: Update README, CLAUDE.md, and docs/architecture.md to reflect recent code changes in dbt-ui.
---

<command-instructions>
You are updating the dbt-ui documentation to reflect recent code changes. Read the changed files first to understand what actually changed, then update only the sections that need it.

## Step 1: Identify What Changed

Run `git diff HEAD~1..HEAD --name-only` (or use the user-provided context) to find changed files. For each changed file, determine which doc sections it affects using this map:

| Changed File | Doc Section |
|---|---|
| `backend/app/db/models.py` | `CLAUDE.md` → Database Tables; `docs/architecture.md` → Database Schema |
| `backend/app/api/*.py` | `docs/architecture.md` → API Routes |
| `backend/app/api/settings.py` | `docs/architecture.md` → Configuration; `README.md` → Environment Variables |
| `backend/app/api/init.py` | `CLAUDE.md` → Init Pipeline System; `docs/architecture.md` → Key Flows |
| `backend/app/api/global_profiles.py` | `docs/architecture.md` → API Routes; `CLAUDE.md` → Global Settings |
| `frontend/src/routes/*.tsx` | `README.md` → Features (if user-facing) |
| `backend/app/config.py` | `docs/architecture.md` → Configuration; `README.md` → Environment Variables |

## Step 2: Update CLAUDE.md

Open `CLAUDE.md`. Update:
- **Database Tables** section — add/update any new tables or columns
- **Init Pipeline System** — if init behavior changed
- **Global Settings** section — if new app_settings keys were added
- **Checklist: Adding a New Global Setting** — if the pattern changed

Keep the existing format. Add rows/lines to tables rather than rewriting.

## Step 3: Update docs/architecture.md

Open `docs/architecture.md`. Update:
- **Database Schema** — add new tables or columns with types and descriptions
- **API Routes** — add new endpoints in the correct group
- **Configuration** — add new env vars with default and description
- **Key Flows** — add or update flows if init pipeline, settings, or project discovery changed
- **Design Decisions** — add a decision only if a non-obvious architectural choice was made

## Step 4: Update README.md

Open `README.md`. Update:
- **Features** list — add a bullet for any user-visible feature (env profiles, requirements install, global profiles)
- **Environment Variables** table — add any new variables that users may want to set

## Step 5: Verify Consistency

Cross-check:
- All tables in `backend/app/db/models.py` appear in `CLAUDE.md` Database Tables and `docs/architecture.md` Database Schema
- All env vars in `backend/app/api/settings.py` SettingsDto appear in `README.md` env table and `docs/architecture.md` Configuration
- The API routes section in `docs/architecture.md` matches all routes registered in `backend/app/main.py`

## Step 6: Report

Summarize which doc files were updated and what was added or changed in each.
</command-instructions>
