"""Column-level lineage — dbt-ui Pro feature.

The actual sqlglot-based tracing algorithm lives in the private `dbt_ui_pro`
package (not in this public repo — see the dbt-ui-pro repo, and the
open-core split discussed when this feature was added). This module is a
thin shim: it exposes the same names the API layer imports
(LineageJob, prepare_lineage_jobs, trace_job) and raises a clear error if
dbt_ui_pro isn't installed, so:

  - a contributor building from this public repo alone gets a working
    dbt-ui with column lineage simply unavailable, not a broken import;
  - the entitlement check (api/column_lineage.py, app/licensing/) still
    lives in the public repo, since it must run inside the distributed app
    regardless of who can read the source.

dbt_ui_pro is only installed into the builds the maintainer distributes —
see backend/pyproject.toml's comment near the pro extra, and the packaging
Taskfile target that installs it from the private repo.
"""

from dataclasses import dataclass, field
from pathlib import Path


class ColumnLineageUnavailable(Exception):
    """dbt_ui_pro isn't installed — column lineage can't run in this build."""


@dataclass(frozen=True)
class ColumnRef:
    """Public so api/column_lineage.py (imported unconditionally at server
    startup) can reference it without requiring dbt_ui_pro to be installed —
    only the tracing algorithm that PRODUCES these is private, not the shape
    of the result. dbt_ui_pro imports this definition rather than defining
    its own, so a job built here and one built there are the same type."""
    node: str    # unique_id of the upstream model
    column: str  # column name in the upstream model


@dataclass(frozen=True)
class LineageJob:
    """Everything trace_job() needs to compute lineage for one model's
    columns. Public for the same reason as ColumnRef above — api/column_lineage.py
    imports this as a type annotation unconditionally at server startup, and
    prepare_lineage_jobs() (dbt_ui_pro, gated) must return real instances of
    it. Kept flat and made of only plain str/tuple/dict values so instances
    can be pickled across a ProcessPoolExecutor boundary cheaply.
    """
    uid: str
    columns: tuple[str, ...]
    sql: str
    dialect: str | None
    parent_short_names: tuple[str, ...]
    name_to_uid: dict[str, str]
    sources: dict[str, str]
    parent_columns: dict[str, tuple[str, ...]] = field(default_factory=dict)
    name: str = field(default="")


def _pro():
    try:
        from dbt_ui_pro import column_lineage as pro_column_lineage
    except ImportError as exc:
        raise ColumnLineageUnavailable(
            "Column-level lineage requires the dbt-ui Pro package, which isn't "
            "installed in this build."
        ) from exc
    return pro_column_lineage


def prepare_lineage_jobs(manifest_path: Path) -> list:
    return _pro().prepare_lineage_jobs(manifest_path)


def trace_job(job) -> tuple:
    """Module-level so it can be pickled and submitted to a
    ProcessPoolExecutor — see api/column_lineage.py. Delegates to
    dbt_ui_pro.column_lineage.trace_job, which is itself a plain
    module-level function in an installed package, so it pickles/imports
    correctly in worker subprocesses the same way this shim does.
    """
    return _pro().trace_job(job)


def build_column_lineage(manifest_path: Path) -> dict:
    return _pro().build_column_lineage(manifest_path)
