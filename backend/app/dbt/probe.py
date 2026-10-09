import asyncio
from dataclasses import dataclass
from pathlib import Path

from app.dbt.runner import RunRequest, runner
from app.dbt.show_parser import parse_show_json

PROBE_TIMEOUT_SECONDS = 30


@dataclass(frozen=True)
class ProbeResult:
    columns: tuple[str, ...]
    error: str | None  # set when the probe failed or returned no columns


async def probe_warehouse_columns(
    project_id: int,
    project_path: Path,
    node_name: str,
    env: dict[str, str],
    target: str | None,
) -> ProbeResult:
    """Read a built node's actual column names via `dbt show --limit 1`."""
    inline_sql = f"select * from {{{{ ref('{node_name}') }}}}"
    target_args: tuple[str, ...] = ("--target", target) if target else ()
    req = RunRequest(
        project_id=project_id,
        project_path=project_path,
        command="show",
        extra=("--inline", inline_sql, "--limit", "1", "--output", "json") + target_args,
        env=env,
    )

    try:
        async with asyncio.timeout(PROBE_TIMEOUT_SECONDS):
            _, stdout_bytes, stderr_bytes = await runner.run(req)
    except TimeoutError:
        return ProbeResult(columns=(), error=f"probe timed out after {PROBE_TIMEOUT_SECONDS}s")
    except Exception as exc:
        return ProbeResult(columns=(), error=str(exc))

    cols, _ = parse_show_json(stdout_bytes.decode(errors="replace"))
    if not cols:
        # Some dbt versions write JSON output to stderr
        cols, _ = parse_show_json(stderr_bytes.decode(errors="replace"))
    if not cols:
        return ProbeResult(
            columns=(),
            error="no columns returned — table may be empty or schema not materialized",
        )
    return ProbeResult(columns=tuple(cols), error=None)
