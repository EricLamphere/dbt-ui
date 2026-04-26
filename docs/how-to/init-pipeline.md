# How to Customize the Init Pipeline

The init pipeline runs automatically every time you open a project. It handles dependency installation, `dbt deps`, and any custom setup steps your project requires.

## What runs by default

Every project has two built-in steps that always run first (in order):

1. **`base: pip install`** — installs requirements from `global_requirements_path` (global setting) and `REQUIREMENTS_PATH` (project env var) into the dbt venv. Skipped if neither is configured.
2. **`base: dbt deps`** — runs `dbt deps` to install dbt packages from `packages.yml`.

These steps cannot be deleted or reordered past custom steps.

## Adding a custom step

Custom steps run shell scripts (`.sh` files) after the base steps.

### Method 1: Place scripts in the init directory

Drop `.sh` files into the project's init directory (default: `<project_path>/init/`). On the next project open, they are discovered automatically and run in alphabetical order.

You can change the init directory path in the **Settings** section of the Environment tab (the `INIT_SCRIPT_PATH` setting).

### Method 2: Link an external script

1. Navigate to **Init Scripts** in the project nav.
2. Click **+ Add Step**.
3. Enter a name and an absolute path to an existing `.sh` script.
4. Click **Save**.

Linked scripts are tracked in the database independently of the init directory. They survive directory changes and can live anywhere on the filesystem.

## Reordering steps

In the **Init Scripts** page, drag steps to reorder them. Base steps (`base: pip install`, `base: dbt deps`) always run first and cannot be moved below custom steps.

## Enabling and disabling steps

Click the toggle on any step to enable or disable it without deleting it. Disabled steps are skipped during the pipeline but remain in the list.

## Capturing env vars from a script

Any variable exported by a custom init script is automatically captured and stored as a project env var. This means:

- No extra code needed in your scripts — just use `export MY_VAR=value`
- Captured vars persist across server restarts (stored in the database)
- Subsequent init steps and all dbt commands see the captured vars automatically

**Example script (`init/00_set_credentials.sh`):**
```bash
#!/bin/bash
export SNOWFLAKE_ACCOUNT=$(cat ~/.snowflake_account)
export SNOWFLAKE_PASSWORD=$(cat ~/.snowflake_password)
```

After this step runs, `SNOWFLAKE_ACCOUNT` and `SNOWFLAKE_PASSWORD` appear in the Environment Variables section and are injected into every dbt subprocess.

## Watching pipeline progress

When you open a project (clicking a project card from the Home page), a modal shows the init pipeline running in real time:

- Each step appears as a row with a spinner while running
- Green check = success, red X = failure
- On failure, the modal shows the step's output so you can debug

## Re-running the pipeline manually

You can re-open the project at any time to re-run the pipeline:
1. Go to the Home page.
2. Click the project card again.

Alternatively, use the integrated terminal to run individual steps manually.

## Troubleshooting

**`dbt deps` fails** — Check that `packages.yml` is valid and that the package registry is reachable. The error output appears in the init modal.

**Custom script fails** — The script runs with `bash -euo pipefail`, so any non-zero exit stops the pipeline. Check your script for errors. The full output is shown in the modal.

**Variables are not captured** — Make sure the variable is actually `export`ed (not just `set`). The capture mechanism only picks up exported variables.

**Script is not discovered** — Verify the script is in the correct directory (`init/` by default, or the path set in `INIT_SCRIPT_PATH`). Scripts must have a `.sh` extension.
