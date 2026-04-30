# Settings Conventions for dbt-ui

## Where Settings Live in the UI

All settings must appear in one of two places in the Environment page (`frontend/src/routes/Project/Environment.tsx`):

| Setting type | UI section | Editable from |
|---|---|---|
| Global (`app_settings` table) | **Global** sub-section under the Settings tile | Global Settings modal only (read-only on Environment page) |
| Project (`projects` table columns or `ProjectEnvVar` rows) | **Project** sub-section under the Settings tile | Inline on the Environment page |

**Never add a setting only to the Global Settings modal without also listing it in the read-only Global section of the Environment page. Never add a project-level setting as a free-form env var without also listing it as a named row in the Project section.**

## Adding a New Global Setting

1. Add it as a named row in the `rows` array in `GlobalSettingsSection` in `Environment.tsx` (read-only display)
2. Add it as a named row in the `rows` array in `GlobalSettingsModal.tsx` (editable)
3. Include an `example` value for the "e.g. …" placeholder shown when unset
4. Follow the checklist in `CLAUDE.md` → "Checklist: Adding a New Global Setting"

## Adding a New Project Setting

1. Add a `ProjectSettingRow` in `ProjectSettingsSection` in `Environment.tsx`
2. Decide the backing store:
   - **`projects` table column** (structural config like `init_script_path`): save via `api.projects.updateSettings()`
   - **`ProjectEnvVar`** (runtime config passed to init scripts like `REQUIREMENTS_PATH`): save via `api.init.setEnvVar()` / `api.init.deleteEnvVar()`
3. If the setting is a `ProjectEnvVar`, clearing it (empty save) should delete the row so it doesn't appear as an empty env var in the Environment Variables section
4. Invalidate the relevant query keys after save

## UX Rules

- **Click-to-edit**: Values are clickable spans — clicking opens an inline input. No pencil buttons.
- **Keyboard**: Enter to save, Escape to cancel.
- **Unset placeholder**: Always show `e.g. <example>` (not "not set", not "default: …") when the value is empty. Every setting must have an example value.
- **Defaults**: Document the default in the example text and enforce it on save when needed (e.g. `INIT_SCRIPT_PATH` falls back to `'init'` when saved empty).
- **Read-only globals**: Show `Lock` icon, muted opacity, no click handler. Direct users to the Global Settings panel.

## Current Project Settings

| Setting | Backing store | Default | Example |
|---|---|---|---|
| `INIT_SCRIPT_PATH` | `projects.init_script_path` | `init` | `init` |
| `REQUIREMENTS_PATH` | `ProjectEnvVar` | (empty) | `/path/to/requirements.txt` |
| `WORKSPACE_PATH` | `ProjectEnvVar` | `workspace` | `analysis/scratch` |

## Current Global Settings

| Setting | Key | Example |
|---|---|---|
| `DBT_UI_PROJECTS_PATH` | `dbt_projects_path` | `/home/user/dbt-projects` |
| `DBT_UI_GLOBAL_REQUIREMENTS_PATH` | `global_requirements_path` | `/home/user/dbt-projects/requirements.txt` |
| `DBT_UI_DATA_DIR` | `data_dir` | `data/` |
| `DBT_UI_LOG_LEVEL` | `log_level` | `INFO` |
