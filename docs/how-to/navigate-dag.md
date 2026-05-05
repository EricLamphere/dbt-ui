# How to Navigate and Filter the DAG

The **Models** page shows your dbt project as an interactive directed acyclic graph (DAG). This guide explains how to navigate it and use the filter bar.

## Opening the DAG

Click **Models** in the project nav. The DAG renders with all nodes laid out left-to-right using automatic dagre layout. Each node represents a model, source, seed, snapshot, or test.

## Node colors and status

Node colors reflect the last known run status:
- **Gray** — idle / not yet run
- **Blue** — currently running (live overlay)
- **Green** — last run succeeded
- **Red** — last run errored
- **Yellow/orange** — last run warned

Status updates in real time as runs execute — no page refresh needed.

## Selecting a model

Click any node to open the **SidePane** on the right. The SidePane shows:
- Model name, type, materialization, schema, and database
- File path and upstream dependencies
- Tags and description (from schema.yml)
- Current run status and last message
- Run controls (3×3 grid of run/build/test × upstream/only/downstream)
- Action buttons: Edit in Files, Open in DAG, View Docs, Delete

## Navigating the graph

- **Pan** — click and drag the canvas background
- **Zoom** — scroll wheel, or use the zoom controls in the corner
- **Fit to view** — double-click the canvas background, or use the fit button in the controls
- **After filtering** — the camera re-centers automatically on the visible nodes (200ms ease)

## Deep-linking to a model

You can link directly to a model in the DAG using the `?model=<unique_id>` query parameter:

```
http://localhost:5173/projects/1/models?model=model.my_project.my_model
```

The model will be pre-selected and the SidePane will open automatically.

## Using the filter bar

The filter bar sits above the DAG. It has a text selector field and dropdown pills.

### Text selector

The text field uses dbt-style selector syntax:

| Syntax | Selects |
|---|---|
| `my_model` | All nodes whose name contains "my_model" |
| `+my_model` | my_model and all its ancestors (upstream) |
| `my_model+` | my_model and all its descendants (downstream) |
| `+my_model+` | my_model, all ancestors, and all descendants |
| `tag:my_tag` | All nodes with the given tag |
| `source:my_source` | All source nodes from the given source |
| `resource_type:model` | All model nodes |
| `model` | Shorthand for `resource_type:model` |
| `seed` | All seed nodes |
| `snapshot` | All snapshot nodes |
| `test` | All test nodes |

Space-separated tokens are **unioned** — `+my_model my_other_model` shows ancestors of `my_model` plus `my_other_model`.

### Dropdown filters

Four dropdown pills let you filter by:
- **Type** — model, source, seed, snapshot, test
- **Materialization** — table, view, incremental, ephemeral
- **Tag** — any tag defined in schema.yml
- **Status** — idle, running, success, error, warn, stale

Filters within a dropdown are **OR** (any match). Filters between dropdowns are **AND** (all must match). This means "Type: model AND Status: error" shows only failed models.

### Test coverage overlay

Click the **Coverage** button (beaker icon) in the filter bar to toggle an optional overlay showing per-column test coverage.

When the overlay is active:
- **Model headers** display a badge showing the percentage of schema-defined columns with at least one test:
  - Red (0% coverage)
  - Amber (1–66% coverage)
  - Light emerald (67–99% coverage)
  - Bright emerald (100% coverage)
- **Expanded column rows** are color-coded by test count:
  - Gray — untested (0 tests)
  - Light green — low coverage (1 test)
  - Medium green — medium coverage (2 tests)
  - Bright green — high coverage (3+ tests)
- Hover over a column row to see the exact test count and test type names (e.g., "uniqueness", "not_null")
- A **legend** appears in the top-right corner showing all four coverage buckets

Coverage data is derived client-side from the full DAG (not filtered) — the overlay reflects all tests even if you've applied other filters. The toggle state persists across page reloads via sessionStorage.

### Clearing filters

Click **Clear** in the filter bar to reset all filters and return to the full graph.

The node count in the filter bar shows how many nodes are currently visible vs. the total.

## Viewing model details in the SidePane

With a model selected, the SidePane is persistent — it stays open as you click different nodes. Resize it by dragging the left edge. Collapse it by clicking the collapse arrow.

The **Edit in Files** button navigates to the File Explorer with the model's `.sql` file open. The **View Docs** button opens the native docs browser for that model.
