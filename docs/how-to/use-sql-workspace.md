# Use the SQL Workspace

The SQL Workspace is a standalone SQL scratchpad inside each project. It lets you write ad-hoc queries with Jinja and dbt refs, see the compiled SQL, and run the query against your database — without creating a model file.

Navigate to **SQL Workspace** in the project sidebar.

---

## Layout

The page has three resizable panels:

| Panel | Purpose |
|---|---|
| File tree (left) | Create, browse, rename, and delete `.sql` files in the workspace folder |
| Editor (center) | Monaco editor with Code and Compiled SQL tabs |
| Results pane (right) | Query output — columns and rows; drag the handle to open/close |

---

## Writing SQL

Open or create a `.sql` file in the file tree. The editor supports full SQL syntax highlighting, bracket colorization, and auto-indent.

Jinja expressions (`{{ ref('my_model') }}`, `{{ var('x') }}`, `{% if ... %}`) are supported — the compile step resolves them using dbt's templating engine.

**Keyboard shortcuts:**
- `Cmd+S` (Mac) / `Ctrl+S` (Windows/Linux) — save the current file
- `Cmd+Enter` / `Ctrl+Enter` — run the query
- **Format** button — pretty-prints the SQL (Jinja-aware; preserves `{{ }}` blocks)

---

## Autocomplete

The editor provides context-aware completions sourced from the project's `manifest.json`:

| Trigger | Completions |
|---|---|
| `{{ ref('` | All models, seeds, and snapshots — with materialization and schema as detail |
| `{{ source('schema',` | Source table names for the typed schema |
| `{{ source('` | All source schema names |
| `FROM ` / `JOIN ` | Models as `{{ ref('...') }}` and sources as `{{ source('...', '...') }}` |
| After `SELECT`, `WHERE`, `ON`, column position | Column names, scoped to models referenced in the current SQL statement |

Suggestions are prefix-filtered and ranked (exact match first, then alphabetical). Trigger autocomplete manually with `Ctrl+Space`.

---

## Navigating to a Ref or Source

Hold **Cmd** (Mac) or **Ctrl** (Windows/Linux) over any `ref(...)` or `source(...)` expression — it becomes underlined as a clickable link. **Cmd+click** opens the referenced model's source file in the File Explorer.

This works the same way as the cmd+click navigation in the File Explorer editor.

---

## Running a Query

Click **Run** or press `Cmd+Enter`. The backend calls `dbt show --inline "<sql>" --limit <n>`. Results appear in the right pane with a row count and timestamp.

- Default limit: 100 rows (configurable up to 5000 by including a `LIMIT` clause in your SQL)
- If your SQL ends with `LIMIT <n>`, that value is used and the default is ignored
- Results persist in `sessionStorage` so they survive navigation within the browser session

---

## Compiled SQL Tab

Click **Compiled SQL** in the tab bar to see the SQL after dbt's Jinja engine has resolved all macros, refs, and sources. The backend calls `dbt compile --inline "<sql>"`.

- The compiled view is read-only
- Click **Refresh** to re-compile after editing the source SQL
- The compiled result is cleared automatically when you edit the code

---

## Managing Files

### Create a file

Click the **+** icon in the file tree header, or right-click a folder and choose **New File**. Files are always saved with a `.sql` extension — you don't need to type it.

### Create a folder

Click the folder icon in the file tree header, or right-click a folder and choose **New Folder**.

### Rename or delete

Right-click any file or folder to rename or delete it. Deleting the currently open file closes the editor.

---

## Workspace Directory

By default workspace files are stored at `<project_path>/workspace/`. To use a different path, set the `WORKSPACE_PATH` project env var on the **Environment** page to a relative path inside the project (e.g. `analysis/scratch`).

The directory is created automatically if it does not exist.

---

## Filtering Files

Type in the **Filter** input above the file tree to narrow the list by filename (case-insensitive substring match).
