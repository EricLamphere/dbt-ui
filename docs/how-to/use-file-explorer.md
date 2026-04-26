# How to Use the File Explorer and Editor

The **Files** page provides a file browser for your dbt project with an integrated Monaco editor for editing SQL and YAML files directly in the browser.

## Opening the File Explorer

Click **Files** in the project nav. The left panel shows the project directory tree.

## Browsing files

The file tree shows all files in your dbt project. Click any file to open it in the editor.

- Folders can be expanded/collapsed by clicking them
- The currently selected file is highlighted
- `.sql`, `.yml`, and `.yaml` files open in the editor
- Other file types (e.g. `.md`, `.txt`) open read-only

## Editing a file

Click any `.sql` or `.yml` file to open it in the Monaco editor. The editor supports:
- Syntax highlighting for SQL and YAML
- Auto-indentation
- Find/replace (`Cmd+F` / `Ctrl+F`)
- Multi-cursor editing
- Undo/redo

**To save changes:** Press `Cmd+S` (macOS) or `Ctrl+S` (Windows/Linux). Changes are written to disk immediately.

The file watcher detects saved changes and publishes a `files_changed` event, which may trigger the DAG to re-render if a manifest change follows.

## Navigating to the DAG from a file

When a model is open in the editor, the **SidePane** on the right shows the model's DAG metadata:
- Model name, type, materialization, schema
- Upstream dependencies and tags
- Run controls (3×3 grid)

Click **Open in DAG** in the SidePane to navigate to the Models page with that model pre-selected.

## Running a model from the File Explorer

With a model open, use the SidePane run grid to execute `dbt run`, `dbt build`, or `dbt test` with upstream/only/downstream selection. This is identical to running from the DAG.

The Run panel at the bottom updates in real time.

## Creating a new model

1. Click **+ New Model** (if available in the header or file tree context).
2. Enter the model name and optional folder path.
3. The model is created as an empty `.sql` file and opened in the editor.

## Deleting a model

1. Select the model in the file tree or open it in the editor.
2. Click **Delete** in the SidePane action buttons.
3. Confirm deletion.

The model file is deleted from disk and removed from the DAG on the next graph refresh.

## The SQL editor modal

Some views (e.g. the SidePane "SQL" action) open the SQL editor in a fullscreen modal for a larger editing surface. This is the same Monaco editor but with more screen space.

## Compiled SQL preview

For models with `{{ ref() }}` and Jinja expressions, you can view the compiled SQL:
- Click **Compile** (or the compiled SQL button) in the SidePane or editor toolbar
- dbt-ui runs `dbt compile` for that specific model and shows the rendered SQL

This is useful for debugging Jinja templating and verifying macro output without running a full build.

## File watcher integration

dbt-ui watches your project directory for changes. If you edit files outside dbt-ui (e.g. in VS Code), the UI updates automatically:
- SQL/YAML changes trigger a `files_changed` event
- Manifest changes (after a compile or run) trigger a `graph_changed` event and re-render the DAG

No manual refresh is needed.
