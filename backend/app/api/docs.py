import asyncio
import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.engine import get_session
from app.db.models import Project
from app.events.bus import Event, bus
from app.logging_setup import get_logger

log = get_logger(__name__)

router = APIRouter(prefix="/api/projects", tags=["docs"])


class DocsStatusDto(BaseModel):
    generated_at: str | None


def _docs_dir(project_id: int) -> Path:
    return settings.data_dir / "docs" / str(project_id)


def _patch_index_html(content: str, project_id: int) -> str:
    """Inject a <base href> so Angular's pushState stays within the iframe."""
    base_href = f'<base href="/static/docs/{project_id}/">'
    if re.search(r'<base\b[^>]*>', content):
        return re.sub(r'<base\b[^>]*>', base_href, content, count=1)
    return content.replace('<head>', f'<head>{base_href}', 1)


@router.get("/{project_id}/docs/data")
async def get_docs_data(project_id: int) -> dict[str, Any]:
    """Return merged manifest + catalog as a clean JSON blob for native rendering."""
    docs_dir = _docs_dir(project_id)
    manifest_path = docs_dir / "manifest.json"
    catalog_path = docs_dir / "catalog.json"

    if not manifest_path.exists():
        raise HTTPException(status_code=404, detail="docs not generated yet")

    try:
        manifest: dict[str, Any] = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"failed to read manifest: {exc}")

    catalog_nodes: dict[str, Any] = {}
    if catalog_path.exists():
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            catalog_nodes = catalog.get("nodes", {})
        except (OSError, json.JSONDecodeError):
            pass

    child_map: dict[str, list[str]] = manifest.get("child_map") or {}
    parent_map: dict[str, list[str]] = manifest.get("parent_map") or {}

    # Build a lookup: test uid → {attached_node, column_name, test_name}
    nodes_raw: dict[str, Any] = manifest.get("nodes", {})
    sources_raw: dict[str, Any] = manifest.get("sources", {})
    macros_raw: dict[str, Any] = manifest.get("macros", {})

    # index tests by attached_node + column_name for column-level test badges
    tests_by_node: dict[str, list[dict[str, Any]]] = {}
    for uid, raw in nodes_raw.items():
        if raw.get("resource_type") != "test":
            continue
        attached = raw.get("attached_node") or ""
        col = raw.get("column_name") or ""
        test_meta = raw.get("test_metadata") or {}
        tests_by_node.setdefault(attached, []).append({
            "uid": uid,
            "name": test_meta.get("name") or raw.get("name") or "",
            "column_name": col,
            "kwargs": test_meta.get("kwargs") or {},
        })

    def _merge_node(uid: str, raw: dict[str, Any]) -> dict[str, Any]:
        resource_type = raw.get("resource_type", "")
        config = raw.get("config") or {}

        # Catalog entry for this node
        catalog_entry = catalog_nodes.get(uid, {})
        cat_meta = catalog_entry.get("metadata") or {}
        catalog_cols: dict[str, Any] = catalog_entry.get("columns") or {}

        # Merge manifest + catalog columns; prefer catalog order (index-sorted)
        manifest_cols: dict[str, Any] = raw.get("columns") or {}
        # Use catalog column order when available, fall back to manifest order
        if catalog_cols:
            ordered_cols = sorted(catalog_cols.keys(), key=lambda c: catalog_cols[c].get("index", 0))
        else:
            ordered_cols = list(manifest_cols.keys())

        # Node-level tests indexed by column
        node_tests = tests_by_node.get(uid, [])
        tests_by_col: dict[str, list[str]] = {}
        node_level_tests: list[str] = []
        for t in node_tests:
            col = t["column_name"]
            if col:
                tests_by_col.setdefault(col, []).append(t["name"])
            else:
                node_level_tests.append(t["name"])

        merged_columns: list[dict[str, Any]] = []
        for col_name in ordered_cols:
            mc = manifest_cols.get(col_name) or {}
            cc = catalog_cols.get(col_name) or {}
            merged_columns.append({
                "name": col_name,
                "description": mc.get("description") or "",
                "data_type": cc.get("type") or mc.get("data_type") or "",
                "meta": mc.get("meta") or {},
                "tags": mc.get("tags") or [],
                "constraints": mc.get("constraints") or [],
                "tests": tests_by_col.get(col_name, []),
            })

        # children split into models and tests
        children = child_map.get(uid, [])
        child_models = [c for c in children if not c.startswith("test.")]
        child_tests = [c for c in children if c.startswith("test.")]
        parents = parent_map.get(uid, [])

        return {
            "unique_id": uid,
            "name": raw.get("name") or uid.split(".")[-1],
            "resource_type": resource_type,
            "schema": raw.get("schema"),
            "database": raw.get("database"),
            "package_name": raw.get("package_name"),
            "path": raw.get("original_file_path") or raw.get("path"),
            "language": raw.get("language"),
            "materialized": config.get("materialized") if isinstance(config, dict) else None,
            "access": config.get("access") if isinstance(config, dict) else None,
            "group": config.get("group") if isinstance(config, dict) else None,
            "contract": (config.get("contract") or {}).get("enforced", False) if isinstance(config, dict) else False,
            "relation_name": raw.get("relation_name"),
            "owner": cat_meta.get("owner"),
            "catalog_type": cat_meta.get("type"),  # BASE TABLE, VIEW, etc.
            "tags": raw.get("tags") or [],
            "description": raw.get("description") or "",
            "meta": raw.get("meta") or {},
            "columns": merged_columns,
            "node_level_tests": node_level_tests,
            "raw_code": raw.get("raw_code") or raw.get("raw_sql") or "",
            "compiled_code": raw.get("compiled_code") or raw.get("compiled_sql") or "",
            "depends_on_nodes": (raw.get("depends_on") or {}).get("nodes") or [],
            "depends_on_macros": (raw.get("depends_on") or {}).get("macros") or [],
            "refs": [r.get("name") if isinstance(r, dict) else r for r in (raw.get("refs") or [])],
            "sources": raw.get("sources") or [],
            "child_models": child_models,
            "child_tests": child_tests,
            "parents": parents,
            # test-specific
            "attached_node": raw.get("attached_node"),
            "column_name": raw.get("column_name"),
            "test_metadata": raw.get("test_metadata"),
        }

    result_nodes: list[dict[str, Any]] = []
    for uid, raw in {**nodes_raw, **sources_raw}.items():
        resource_type = raw.get("resource_type", "")
        if resource_type not in {"model", "seed", "snapshot", "test", "source", "analysis"}:
            continue
        result_nodes.append(_merge_node(uid, raw))

    # Macros — only those with docs.show = true (default) and include all packages
    result_macros: list[dict[str, Any]] = []
    for uid, raw in macros_raw.items():
        docs_cfg = (raw.get("docs") or raw.get("config", {}).get("docs") or {})
        if docs_cfg.get("show") is False:
            continue
        children = child_map.get(uid, [])
        parents = parent_map.get(uid, [])
        result_macros.append({
            "unique_id": uid,
            "name": raw.get("name") or uid.split(".")[-1],
            "resource_type": "macro",
            "package_name": raw.get("package_name"),
            "path": raw.get("original_file_path") or raw.get("path"),
            "description": raw.get("description") or "",
            "meta": raw.get("meta") or {},
            "arguments": raw.get("arguments") or [],
            "macro_sql": raw.get("macro_sql") or "",
            "depends_on_macros": (raw.get("depends_on") or {}).get("macros") or [],
            "child_models": [c for c in children if not c.startswith("test.")],
            "child_tests": [c for c in children if c.startswith("test.")],
            "parents": parents,
            "tags": [],
        })

    # Sort nodes: models first, then seeds/snapshots/sources/tests, then by name
    order = {"model": 0, "seed": 1, "snapshot": 2, "source": 3, "analysis": 4, "test": 5}
    result_nodes.sort(key=lambda n: (order.get(n["resource_type"], 9), n["name"]))
    result_macros.sort(key=lambda n: (n["package_name"] or "", n["name"]))

    project_name: str = (manifest.get("metadata") or {}).get("project_name") or ""

    # Extract project overview from the docs block (may be project-specific or dbt default)
    docs_blocks: dict[str, Any] = manifest.get("docs") or {}
    project_overview_uid = f"doc.{project_name}.__overview__"
    overview_block = docs_blocks.get(project_overview_uid) or docs_blocks.get("doc.dbt.__overview__") or {}
    project_description: str = overview_block.get("block_contents") or ""

    return {
        "nodes": result_nodes,
        "macros": result_macros,
        "project_name": project_name,
        "project_description": project_description,
    }


@router.get("/{project_id}/docs/view", response_class=HTMLResponse)
async def view_docs(project_id: int) -> HTMLResponse:
    """Serve the patched docs index.html so Angular routing stays in the iframe."""
    index = _docs_dir(project_id) / "index.html"
    if not index.exists():
        raise HTTPException(status_code=404, detail="docs not generated yet")
    content = index.read_text(encoding="utf-8")
    return HTMLResponse(_patch_index_html(content, project_id))


@router.get("/{project_id}/docs/status", response_model=DocsStatusDto)
async def get_docs_status(project_id: int) -> DocsStatusDto:
    # catalog.json is the canonical output — present whether we used
    # `compile --write-catalog` (dbt >= 1.9) or `docs generate` (older).
    catalog = _docs_dir(project_id) / "catalog.json"
    if not catalog.exists():
        return DocsStatusDto(generated_at=None)
    mtime = catalog.stat().st_mtime
    generated_at = datetime.fromtimestamp(mtime, tz=timezone.utc).isoformat()
    return DocsStatusDto(generated_at=generated_at)


@router.post("/{project_id}/docs/generate")
async def generate_docs(
    project_id: int,
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    asyncio.create_task(_generate_docs(project_id, project.path))
    return {"status": "started"}


async def _generate_docs(project_id: int, project_path: str, env: dict | None = None) -> bool:
    from app.api.init import load_project_env
    from app.dbt.venv import venv_dbt
    from app.logs.project_logger import append_project_log  # noqa: PLC0415

    topic = f"project:{project_id}"
    if env is None:
        env = await load_project_env(project_id)
    await bus.publish(Event(topic=topic, type="docs_generating", data={}))

    dbt = str(venv_dbt())
    project = Path(project_path)
    # --profiles-dir must come AFTER the subcommand, not between `dbt` and `docs`/`compile`
    profiles_args = ["--profiles-dir", project_path] if (project / "profiles.yml").exists() else []

    async def _run_and_log(args: list[str]) -> tuple[bool, list[str]]:
        append_project_log(project_path, f">>> {' '.join(args[1:])}", project_id)
        try:
            proc = await asyncio.create_subprocess_exec(
                *args,
                cwd=project_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
        except Exception as exc:
            append_project_log(project_path, f"error: {exc}", project_id)
            return False, []
        lines: list[str] = []
        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").rstrip("\n")
            append_project_log(project_path, line, project_id)
            lines.append(line)
        rc = await proc.wait()
        status = "OK" if rc == 0 else f"FAILED (rc={rc})"
        append_project_log(project_path, f"<<< {' '.join(args[1:])} {status}", project_id)
        combined = "\n".join(lines).lower()
        unrecognised = any(kw in combined for kw in ("unrecognized", "no such option", "invalid value"))
        return rc == 0 and not unrecognised, lines

    # dbt >= 1.9: compile --write-catalog [--profiles-dir ...]
    ok, output_lines = await _run_and_log([dbt, "compile", "--write-catalog"] + profiles_args)
    if not ok and any(kw in "\n".join(output_lines).lower() for kw in ("unrecognized", "no such option", "invalid value")):
        # Older dbt fallback: docs generate [--profiles-dir ...]
        ok, output_lines = await _run_and_log([dbt, "docs", "generate"] + profiles_args)

    log.info("docs_generate_result", ok=ok, last_lines=output_lines[-10:])

    if not ok:
        await bus.publish(Event(topic=topic, type="docs_generated", data={"ok": False}))
        return False

    # Copy target artifacts to data_dir/docs/{project_id}/
    target_dir = Path(project_path) / "target"
    dest_dir = _docs_dir(project_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("manifest.json", "catalog.json"):
        src = target_dir / filename
        if src.exists():
            shutil.copy2(src, dest_dir / filename)

    # index.html is produced by `docs generate` but not `compile --write-catalog`.
    # Copy and patch it when present (used by the iframe-based viewer).
    index_src = target_dir / "index.html"
    if index_src.exists():
        content = index_src.read_text(encoding="utf-8")
        (dest_dir / "index.html").write_text(
            _patch_index_html(content, project_id), encoding="utf-8"
        )

    generated_at = datetime.now(timezone.utc).isoformat()
    await bus.publish(
        Event(topic=topic, type="docs_generated", data={"ok": True, "generated_at": generated_at})
    )
    return True
