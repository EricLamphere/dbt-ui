import json
import re


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


def parse_show_json(stdout: str) -> tuple[list[str], list[list]]:
    """Parse dbt show --output json stdout into (columns, rows).

    Handles two formats:
    - dbt 1.5+: {"results": [{"table": {"column_names": [...], "rows": [...]}}]}
    - dbt 1.11+: {"show": [{"col": val, ...}, ...]}

    Returns ([], []) when output is empty or unparseable.
    """
    clean = _ANSI_RE.sub("", stdout)

    json_candidates: list[str] = []
    buffer: list[str] = []
    depth = 0
    for line in clean.splitlines():
        stripped = line.strip()
        if not buffer and not stripped.startswith("{"):
            continue
        buffer.append(stripped)
        depth += stripped.count("{") - stripped.count("}")
        if depth <= 0 and buffer:
            json_candidates.append("\n".join(buffer))
            buffer = []
            depth = 0

    for candidate in json_candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue

        # Format 1: {"results": [{"table": {"column_names": [...], "rows": [...]}}]}
        results = parsed.get("results") or []
        if results:
            result = results[0]
            table = result.get("table") or result.get("agate_table") or {}
            columns: list[str] = table.get("column_names") or []
            rows: list[list] = table.get("rows") or []
            return columns, rows

        # Format 2: {"node": "...", "show": [{"col": val}, ...]}
        show_rows = parsed.get("show")
        if isinstance(show_rows, list) and show_rows:
            columns = list(show_rows[0].keys())
            rows = [[row.get(c) for c in columns] for row in show_rows]
            return columns, rows

        # Format 2 with empty result set: {"show": []}
        if "show" in parsed and isinstance(parsed["show"], list):
            return [], []

    return [], []
