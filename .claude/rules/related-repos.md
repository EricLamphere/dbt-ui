# Related Repositories

dbt-ui spans three separate git repositories on disk, each with a distinct
purpose and audience. Claude should know which repo owns what before making
changes that might actually belong in a sibling repo.

```
~/Projects/
  dbt-ui/           this repo — public, open source (MIT), the product itself
  dbt-ui-pro/        private — paid Pro feature implementation (sibling checkout)
  lamphere-labs/     private — marketing site (lampherelabs.com), Cloudflare Pages
```

## dbt-ui (this repo) — public product

FastAPI + React app described in the rest of this `.claude/` tree. Free and
open source. Ships as a Tauri desktop app or runs from source.

Contains the **shim side** of the Pro integration:
`backend/app/dbt/column_lineage.py` defines the public, always-importable
`ColumnRef`/`LineageJob` dataclasses and lazily delegates
`prepare_lineage_jobs()` / `trace_job()` / `build_column_lineage()` to the
private `dbt_ui_pro` package, raising `ColumnLineageUnavailable` if it isn't
installed. `backend/app/licensing/` (`polar_client.py`, `entitlements.py`)
handles license-key validation against Polar and the entitlement cache — this
is also public, since gating logic itself isn't the IP worth protecting.

## dbt-ui-pro — private, paid feature implementation

Separate private repo, expected as a **sibling checkout** at `../dbt-ui-pro`
relative to this repo (i.e. `~/Projects/dbt-ui-pro`, not nested inside
`dbt-ui/`). Distributed as a pip package (`dbt_ui_pro`), not a monorepo
package or git submodule.

- Contains the actual sqlglot-based column-lineage tracing algorithm (the
  proprietary part: case-insensitive matching, UNPIVOT stripping, etc.) —
  this is the IP that Pro licensing gates.
- Depends on `dbt-ui`'s backend at dev time for the shared `ColumnRef`/
  `LineageJob` types (`pip install -e ../dbt-ui/backend` before installing
  `dbt-ui-pro` itself — see `dbt-ui-pro/pyproject.toml`'s comment on why this
  isn't a normal package dependency: pip requires an absolute `file://` path
  for local deps, which isn't portable across machines/CI).
- Installed into `dbt-ui`'s **shared backend venv** via `task package:pro`
  (plain `pip install`, deliberately **not** `-e`/editable — PyInstaller's
  static analysis can't see through an editable install's import-finder
  indirection, so an editable install silently produces a build missing
  `dbt_ui_pro` at runtime). See `Taskfile.yml`'s `package:pro` /
  `_package:pro-check` / `package:sandbox:pro` / `package:sandbox:base`
  tasks for the full build matrix (pro vs. base × sandbox vs. production).
- Contributors without access to `dbt-ui-pro` build and test against
  `package:sandbox:base` — column lineage is simply unavailable, identical
  to the entitlement-gated experience a non-Pro user sees.
- If asked to work on the actual lineage tracing algorithm, that code lives
  in `dbt-ui-pro`, not here — this repo only has the shim.

## lamphere-labs — private, marketing site

Static site (plain HTML/CSS/JS, no build step, no framework) for
lampherelabs.com, deployed via Cloudflare Pages Git integration (push to
`main` → live in ~1-2 minutes, no CI/CD workflow file).

- `product-dbt-ui/index.html` is dbt-ui's product page
  (lampherelabs.com/product-dbt-ui) — hero shots, feature grid, screenshot
  gallery with a click-to-enlarge/arrow-key-navigable lightbox, pricing,
  install steps.
- `assets/img/` holds resized copies of screenshots sourced from this repo's
  `img/` directory (hero shots at 1600px wide, gallery tiles at 1200px —
  resized with `sips --resampleWidth`, not committed at full source
  resolution).
- **This repo's `img/*.png` files are the source of truth for screenshots.**
  When updating one, also refresh the corresponding resized copy in
  `lamphere-labs/assets/img/` and check whether `product-dbt-ui/index.html`
  references it by name — the two repos' filenames don't always match
  (e.g. this repo's `home.png` → the site's `homepage_1200.png`,
  `settings.png` → `settings_1200.png`, `dag_view.png` → the hero shot
  `dag_logs_1600.png`, `file_explorer.png` → the hero shot
  `files_model_exec_dag_1600.png`).
- When this repo's `img/` gallery changes (new screenshot, rename, deletion),
  check whether `lamphere-labs/product-dbt-ui/index.html`'s gallery grid and
  README.md's Gallery section need the same update — keep all three in sync
  rather than letting the site or README drift stale. See
  [doc-update.md](./doc-update.md) for this repo's own doc-sync rules;
  lamphere-labs isn't covered by that checklist since it's a separate repo,
  so treat gallery/screenshot changes as needing a manual cross-check here.
- Pricing/feature copy on the product page should stay consistent with this
  repo's README feature list and `frontend/src/routes/Pricing.tsx` — no
  automated check enforces this, so verify by eye when either changes.
