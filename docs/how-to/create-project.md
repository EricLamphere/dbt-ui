# How to Create a Project

This guide walks through creating a new dbt project from scratch using dbt-ui's interactive `dbt init` flow.

## Prerequisites

- dbt-ui is running (`task start` or `task start:bg`)
- `DBT_UI_PROJECTS_PATH` is configured (see the Global Settings modal on the Home page if you see an amber banner)
- You have a dbt adapter installed, or dbt-ui will install it for you

## Step 1: Open the New Project modal

From the Home page, click **New Project** in the top-right corner. A modal will appear with a platform picker.

## Step 2: Choose your adapter

Select the dbt adapter that matches your data warehouse (e.g. BigQuery, Snowflake, DuckDB, Postgres). dbt-ui will pip-install the adapter into the dbt venv before launching the interactive init terminal.

You will see terminal output while the adapter installs. This may take 30–60 seconds the first time.

## Step 3: Complete `dbt init` interactively

Once the adapter is installed, a `dbt init` session starts in the embedded terminal. Answer the prompts:
- Project name
- Database connection details (host, port, credentials, etc.)
- Default target name (usually `dev`)

The terminal is a full PTY — you can type responses, use arrow keys for selections, and press Enter to confirm. If you navigate away, the session continues in the background and you can reopen the modal to see buffered output.

## Step 4: Close the modal

When `dbt init` finishes, click **Close**. dbt-ui automatically:
1. Rescans the workspace for new projects
2. Writes a minimal `profiles.yml` into any newly created project directory that doesn't already have one (so `--profiles-dir` works correctly)

The new project appears in the Home page project list.

## Step 5: Open the project

Click the project card to navigate to the project. dbt-ui will run the **init pipeline** (pip install + `dbt deps` + any custom steps). A modal shows the progress of each step.

Once the pipeline finishes, the project compiles automatically and the DAG becomes visible.

## Troubleshooting

**Adapter install fails** — Check that your internet connection is available and that the adapter name is correct. The terminal will show the pip error. You can retry by closing and reopening the modal.

**`dbt init` prompts seem stuck** — Try pressing Enter. Some adapters have optional prompts that require an explicit confirmation.

**Project doesn't appear after close** — Click **Rescan** on the Home page to re-discover projects. If the project directory is outside `DBT_UI_PROJECTS_PATH`, update the path in Global Settings.

**`profiles.yml` is missing or incorrect** — Navigate to the project's Environment tab to view the active `profiles.yml`. You can edit it directly in the File Explorer.

## Next steps

- [Configure your environment and targets](configure-environment.md) — set env vars, switch targets, install requirements
- [Customize the init pipeline](init-pipeline.md) — add custom setup steps that run every time you open the project
- [Navigate and filter the DAG](navigate-dag.md) — explore your project's model graph
