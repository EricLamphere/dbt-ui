# How to Configure Environment and Targets

This guide covers environment variables, dbt targets, profiles, and requirements in dbt-ui.

## Opening the Environment tab

Navigate to a project and click **Environment** in the project nav. The page is divided into sections:

- **Environment Variables** — free-form key/value pairs injected into every dbt subprocess
- **Profiles** — named sets of env vars you can activate as a group
- **Settings** — project-specific and global settings

> dbt-ui Pro subscription management (license key, cancellation) lives in the **Global Settings** modal, not here — see below.

---

## Environment Variables

Environment variables are injected into every dbt command and init pipeline step for this project.

**Add a variable:**
1. Click the **+** button in the Environment Variables section.
2. Enter the key and value.
3. Press Enter or click **Save**.

**Edit a variable:**
Click the value cell to open it for editing. Press Enter to save or Escape to cancel.

**Delete a variable:**
Click the trash icon on the variable row.

Variables set here override process-level env vars of the same name. They are persisted in the database and survive server restarts.

> Some well-known keys have special meaning:
> - `dbt_target` — the active dbt target (managed by the Target dropdown, not directly here)
> - `REQUIREMENTS_PATH` — path to a project-specific `requirements.txt` (see Settings section below)
> - Any key exported by an init script is automatically captured here after the step runs

---

## dbt Targets

The **Target** dropdown in the top-right header controls which dbt target is active. Targets come from your `profiles.yml`.

**To switch targets:**
1. Click the Target dropdown in the header.
2. Select a target (e.g. `dev`, `prod`, `staging`).

The selection is stored per-project and applied to every subsequent dbt run as `--target <value>`.

**Where targets come from:**
dbt-ui reads `profiles.yml` from the project directory first. If none is found there, it falls back to `~/.dbt/profiles.yml`. The available targets reflect the `outputs:` section of the active profile.

---

## Profiles (per-project)

Profiles are named sets of environment variables that can be activated as a group. This is useful for quickly switching between sets of credentials (e.g. "dev credentials" vs "staging credentials").

**Create a profile:**
1. Click **+ New Profile** in the Profiles section.
2. Enter a name.
3. Add key/value pairs to the profile.

**Activate a profile:**
Click **Activate** on any profile. Its variables are merged into the subprocess env for dbt runs and init pipeline steps (on top of project env vars).

Only one profile can be active at a time. Deactivating clears the overlay without deleting the profile.

---

## Global Profiles

Global profiles work the same as per-project profiles but are shared across all projects. They are managed from the **Global Settings** modal (click the gear icon on the Home page).

Use global profiles for credentials or env vars that apply to multiple projects (e.g. warehouse credentials shared across a team workspace).

---

## Settings

### Project settings

**INIT_SCRIPT_PATH** — the subdirectory within the project where init scripts are stored. Defaults to `init/`. Click the value to edit.

**REQUIREMENTS_PATH** — an absolute path to a `requirements.txt` file. When set, this file is pip-installed into the dbt venv during every project open (the `base: pip install` init step). Click the value to edit; clear it to remove.

**WORKSPACE_PATH** — the subdirectory within the project where SQL Workspace files are stored. Defaults to `workspace/`. The directory is created automatically if it does not exist. Click the value to edit; clear it to reset to the default.

Use this to point the SQL Workspace at a different folder — for example `analysis/scratch` if you want workspace files committed alongside your models, or a path outside the project root for throwaway queries.

### Global settings (read-only here)

Global settings are shown for reference but can only be edited in the Global Settings modal:

- **DBT_UI_PROJECTS_PATH** — the workspace directory scanned for dbt projects
- **DBT_UI_GLOBAL_REQUIREMENTS_PATH** — a global `requirements.txt` installed for every project
- **DBT_UI_DATA_DIR** — where the SQLite database is stored
- **DBT_UI_LOG_LEVEL** — logging verbosity

To change these, click the lock icon area or open Global Settings from the Home page.

---

## Subscription

Click the gear icon on the Home page to open **Global Settings**, then the **Subscription** tab. This shows the status of your dbt-ui Pro license and lets you manage it without leaving the app. It's installation-wide, not per-project — the same license covers every project you open.

**If you have an active subscription:**
- Your license key is shown masked (`••••••••…`) by default. Click the eye icon to reveal it, and again to hide it. **Don't share this key** — anyone who has it can activate their own device on it, using up your device slots (and there's no other protection against this).
- A **Devices** row shows how many devices are currently activated against your key (e.g. "1 of 2 devices activated"). If you see more devices than you own, your key may have been shared or leaked — deactivate the extra device from your Polar customer portal (linked from your purchase receipt email). Click the refresh icon to re-check the count.
- Click **Cancel subscription** to cancel. You'll be asked to confirm — cancelling takes effect at the end of your current billing period, so Pro features keep working until then. There's no separate "resubscribe" step needed if you change your mind before the period ends; use your Polar customer portal (linked from your purchase receipt email) to undo a pending cancellation.

**If you don't have an active subscription:**
- Click **Subscribe to Pro** to open the checkout page.
- If you already have a license key (e.g. from a previous install or another device), click **Have a license key?** and paste it in, then click **Activate**.

---

## Requirements installation

dbt-ui installs Python requirements into the same venv as the `dbt` binary (not into the app's own venv). Two sources are supported:

1. **Global** (`global_requirements_path`) — installed first, applies to all projects
2. **Per-project** (`REQUIREMENTS_PATH`) — installed second, applies to this project only

Both are installed during the `base: pip install` step every time you open a project. If neither is configured, the step is skipped.

Use this to install dbt packages, adapters, or other Python dependencies that your models or macros require.
