# How to View Run History

The **Run History** page shows a chronological log of every dbt invocation for a project. Use it to audit past runs, diagnose failures, compare execution times across models, and inspect the raw dbt log for any individual run.

## Opening Run History

Click the **Run History** icon in the left nav rail (clock icon). The page lists all recorded invocations, newest first, up to 1,000 total entries.

## The Run List

Each row in the table shows:

| Column | Description |
|---|---|
| Started | Local date and time the run began |
| Cmd | The dbt command: `run`, `build`, `test`, or `seed` |
| Selector | The `--select` value, or *all* if no selector was used |
| Duration | Wall-clock time from start to finish |
| Nodes | Number of models and tests executed |
| Status | `success`, `error`, or `running` |

Click a row to open its **Detail Panel** on the right. Click the same row again to deselect it.

## Filtering and Searching

The filter bar at the top of the list has three controls:

- **Search** — type a selector string and press Enter or click Search. Matches against the selector column (e.g. search `my_model` to find runs that targeted that model).
- **Command** — filter to a single dbt command (`run`, `build`, `test`, `seed`).
- **Status** — filter to `success`, `error`, or `running`.

Changing any filter resets to page 1 and clears the selected row.

## Pagination

When there are more than 50 runs (after applying filters), **Prev** and **Next** buttons appear at the bottom of the list. The current page and total page count are shown on the left.

## The Detail Panel

Clicking a run opens the Detail Panel on the right side of the page. The panel has two tabs:

### Nodes tab

Shows every model and test that executed in the selected run, with:

- **Node** — model or test name; tests are labeled with an amber `test` badge
- **Time (s)** — execution time in seconds; values ≥ 10s are highlighted in amber with a ⚠ prefix
- **Status** — per-node result (`success`, `error`, `warn`, etc.)
- **Message** — the dbt result message (e.g. `Created relation …`)

**Filtering nodes:** Use the search box and the *All kinds* / *All statuses* dropdowns to narrow the node list within a run.

**Per-node trend:** Click any row to expand a sparkline showing that node's execution time across its last 20 runs. Red dots mark errored runs. The panel also shows the min, max, and average execution time across those runs.

### Log tab

Shows the raw stdout captured from dbt for that invocation. Lines containing `OK` or `PASS` are highlighted green; `ERROR` / `FAILED` lines are red; `WARN` lines are amber. This is the same output that appears in the Project Logs tab during a live run.

## The Detail Panel — resizing and collapsing

The Detail Panel works like the SidePane on the DAG and File Explorer pages:

- **Drag** the thin strip on the left edge of the panel to resize it. The width is saved to localStorage and restored on your next visit.
- **Collapse/expand** using the chevron button at the bottom of the drag strip.
- When the panel is collapsed, clicking a run row re-opens it at its last width.

## Session memory

The page restores its state when you navigate away and return within the same browser session:

- The selected run is remembered — the Detail Panel reopens on the same run.
- The panel's open/closed state is remembered.

## Limitations

- Runs are recorded only while the dbt-ui server is running. Runs executed directly in the terminal (outside dbt-ui) are not recorded.
- A maximum of 1,000 invocations are stored per project. Older entries are retained until the limit is reached.
- Log capture is only available for runs triggered through dbt-ui. If a run was recorded before log capture was introduced, the Log tab will show "No log captured for this invocation."
- The per-node trend sparkline covers the last 20 runs in which that specific node appeared, not the last 20 project runs.
