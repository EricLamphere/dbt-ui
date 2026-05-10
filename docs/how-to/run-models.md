# How to Run, Build, and Test Models

This guide explains how to execute dbt commands against your models using dbt-ui.

## Overview

dbt-ui exposes three dbt commands:
- **run** — executes model SQL and materializes results
- **build** — runs models, tests, seeds, and snapshots together
- **test** — executes tests without building models

All three support the same selection modes and use the active dbt target.

## Running from the DAG (SidePane)

1. Navigate to **Models** in the project nav.
2. Click any node in the DAG to open the **SidePane** on the right.
3. The SidePane shows a 3×3 run grid with rows (run / build / test) and columns (upstream / only / downstream).
4. Click a button to start the command. The button highlights and the Run panel opens at the bottom.

**Selection modes:**
- **upstream** (`+model`) — runs the model and all its ancestors
- **only** (`model`) — runs just the selected model
- **downstream** (`model+`) — runs the model and all its descendants

## Running from the File Explorer

1. Navigate to **Files** in the project nav.
2. Open any `.sql` model file. The SidePane appears on the right with the same run grid.
3. Use the same buttons to trigger runs.

## Watching the run in real time

The **Run panel** at the bottom of the screen shows an **Execution DAG** — a live mini-graph of the models involved in the current run:
- **Blue** — model is currently executing
- **Green** — model succeeded
- **Red** — model errored
- **Yellow/orange** — model warned or partially failed

The panel updates line-by-line as dbt emits output. You don't need to wait for the full run to finish to see results.

Click any node in the Execution DAG to jump to that model in the main DAG and see its details.

## Reading run output

The **Project Logs** tab (next to the Run tab in the bottom panel) shows full stdout/stderr from dbt. This is useful for debugging failing models.

## Switching dbt targets before a run

Use the **Target** dropdown in the top-right header to switch between targets defined in `profiles.yml` (e.g. `dev`, `prod`). The selected target is stored per-project and applied automatically to every dbt command.

## Running all models

To run all models in the project, click the top node in the DAG (or use the DAG selection bar) to run without a `--select` filter. Alternatively, use the terminal to run `dbt run` directly.

## Viewing model status after a run

After a run completes, the main DAG tiles update to show the final status:
- **Green** — success
- **Red** — error
- **Yellow** — warn
- **Gray** — not run / stale

Click any tile to see the model's last run message in the SidePane.

## Test failures

When tests fail, the SidePane shows a **Test Failures** section listing each failing test with its name and failure message. The **test** run controls in the SidePane let you re-run tests in isolation.

## Reviewing past runs

Every invocation is recorded in **Run History** (clock icon in the left nav). From there you can browse past runs, inspect per-node execution times and trends, and view the raw dbt log. See [View run history](view-run-history.md) for details.

## Troubleshooting

**Run button does nothing** — Check the Project Logs tab for errors. The dbt binary may not be found, or there may be a configuration issue.

**Model stays blue** — The run is still executing. Long-running models may take time. Check Project Logs for progress.

**`--target` is wrong** — Verify the Target dropdown in the header matches your intended environment.
