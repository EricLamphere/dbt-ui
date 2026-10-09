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
- Action buttons: Edit in Files, Open in DAG, View Docs, Generate docs YAML, Delete

**Generate docs YAML** reads the node's actual columns from the warehouse (so it must be built) and adds `- name:` entries for the node and any undocumented columns to its schema YAML — the file it's already documented in, else a YAML in its folder that has a `models:` (or `seeds:`/`snapshots:`) list, else a new `schema.yml`. Only lines are added; existing content, comments and indentation are untouched. The manifest recompiles afterwards so the SidePane picks up the new columns.

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

The URL tracks the selected node as you click around, so the header's back/forward arrows (⌘[ / ⌘] or ⌘← / ⌘→) step through the nodes you've selected.

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

### Column-level lineage

Click **Load column lineage** in the filter bar to compute column-to-column lineage across the whole project. This traces exactly which upstream column each downstream column was derived from, by parsing each model's compiled SQL with sqlglot.

Key points:
- **No yml documentation required.** Lineage is derived from a model's compiled SQL alone — a model with SQL but no `columns:` block in its schema.yml still gets full lineage. yml-documented columns are only used as a fallback for cases the SQL parse can't resolve on its own (for example, a top-level `SELECT *`, or a model that hasn't been compiled yet).
- **Case-insensitive matching.** Warehouses that normalize unquoted identifier casing (e.g. Snowflake uppercases them) still resolve correctly — parent/column matching is case-insensitive, and the resulting column names are always shown in their original, correctly-cased spelling.
- **UNPIVOT-aware.** A model whose outer `SELECT` reads from an `UNPIVOT`'d table still resolves lineage for every column *except* the pivoted output columns themselves (e.g. the metric-name and metric-value columns) — those genuinely have no single upstream column, since they fan in from several source columns at once, so they're correctly shown as having no lineage rather than a wrong or crashed trace.
- **Runs in the background.** The scan is computed server-side across multiple worker processes rather than blocking the UI — the button shows `Column lineage: {checked}/{total}…` while it's running, and the rest of the app (including other DAG interactions) stays responsive the whole time.
- Once loaded, expand a model node to reveal its columns. Click a column to highlight its lineage — connected columns and models are highlighted, everything else dims.
- Cmd/ctrl-click multiple columns to select several traces at once.
- Toggle **Direct lineage** / **Full lineage** (the pill above the canvas, visible once a column is selected) to switch between showing only immediate upstream/downstream columns versus the full transitive closure.
- Click **Refresh column lineage** to re-run the scan after models change — it's skipped automatically (and returns instantly) if `target/manifest.json` hasn't changed since the last successful scan.

### Clearing filters

Click **Clear** in the filter bar to reset all filters and return to the full graph.

The node count in the filter bar shows how many nodes are currently visible vs. the total.

## Viewing a node's lineage in the bottom pane

The **Node DAG** tab in the bottom pane shows the selected node's full upstream and downstream lineage (`+model+`), centered on that node. It follows your selection on the DAG page, and on the Files page it follows the model whose file is open (or the test you're on in a YAML file). 

- Use the **Type**, **Materialization**, and **Status** dropdowns in the tab's header to narrow the lineage (same multi-select behavior as the main DAG's filters; saved per project for the session). The selected node always stays visible. When filtered-out nodes sit between two visible ones, a dashed edge connects them so the lineage stays readable. Type defaults to `seed`, `source`, `model`, and `exposure` (tests hidden); check `test` or click **Clear** to show tests.
- Click the crosshair button in the tab's header to re-center after panning.
- Cmd/ctrl-click any node to open its file in the Files page.

## Viewing model details in the SidePane

With a model selected, the SidePane is persistent — it stays open as you click different nodes. Resize it by dragging the left edge. Collapse it by clicking the collapse arrow.

The **Edit in Files** button navigates to the File Explorer with the model's `.sql` file open. The **View Docs** button opens the native docs browser for that model.
