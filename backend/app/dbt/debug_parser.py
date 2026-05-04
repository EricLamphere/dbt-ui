import re
from dataclasses import dataclass, field


_ANSI_RE = re.compile(r"\x1b\[[0-9;]*m")


@dataclass(frozen=True)
class DebugCheck:
    key: str  # dbt_version | profiles_yml | dbt_project_yml | connection | adapter | python
    label: str
    status: str  # ok | fail | warn | info
    detail: str = ""


@dataclass(frozen=True)
class DebugResult:
    overall_ok: bool
    dbt_version: str | None
    python_version: str | None
    adapter_name: str | None
    adapter_version: str | None
    profiles_dir: str | None
    profile_name: str | None
    target_name: str | None
    checks: tuple[DebugCheck, ...]
    raw_log: str


def parse_debug_output(text: str) -> DebugResult:
    clean = _ANSI_RE.sub("", text)
    lines = clean.splitlines()

    dbt_version: str | None = None
    python_version: str | None = None
    adapter_name: str | None = None
    adapter_version: str | None = None
    profiles_dir: str | None = None
    profile_name: str | None = None
    target_name: str | None = None
    checks: list[DebugCheck] = []

    for line in lines:
        stripped = line.strip()

        # Version info lines
        m = re.search(r"running with dbt[= ]v?(\S+)", stripped, re.IGNORECASE)
        if m:
            dbt_version = m.group(1).rstrip(",")
            continue

        m = re.search(r"python version[:\s]+(\S+)", stripped, re.IGNORECASE)
        if m:
            python_version = m.group(1)
            continue

        m = re.search(r"adapter\s+type[:\s]+(\S+)", stripped, re.IGNORECASE)
        if m:
            adapter_name = m.group(1)
            continue

        m = re.search(r"adapter\s+version[:\s]+v?(\S+)", stripped, re.IGNORECASE)
        if m:
            adapter_version = m.group(1)
            continue

        m = re.search(r"using profiles(?:\.yml)? dir(?:ectory)?[:\s]+(.+)", stripped, re.IGNORECASE)
        if m:
            profiles_dir = m.group(1).strip()
            continue

        m = re.search(r"using profile\s+['\"]?(\S+?)['\"]?\s*$", stripped, re.IGNORECASE)
        if m:
            profile_name = m.group(1)
            continue

        m = re.search(r"using target\s+['\"]?(\S+?)['\"]?\s*$", stripped, re.IGNORECASE)
        if m:
            target_name = m.group(1)
            continue

        # Check lines — patterns observed in dbt debug output
        check = _parse_check_line(stripped)
        if check is not None:
            checks.append(check)

    overall_ok = len(checks) > 0 and all(c.status in ("ok", "info") for c in checks)

    return DebugResult(
        overall_ok=overall_ok,
        dbt_version=dbt_version,
        python_version=python_version,
        adapter_name=adapter_name,
        adapter_version=adapter_version,
        profiles_dir=profiles_dir,
        profile_name=profile_name,
        target_name=target_name,
        checks=tuple(checks),
        raw_log=text,
    )


def _parse_check_line(line: str) -> DebugCheck | None:
    """Try to parse a single dbt debug output line into a DebugCheck."""
    lower = line.lower()

    # Pattern: "  ok found and parsed profiles.yml" / "  ERROR: ..."
    if re.match(r"ok\s+", lower):
        detail = re.sub(r"^ok\s+", "", line, flags=re.IGNORECASE).strip()
        key = _classify_check(lower)
        label = _label_for_key(key, detail)
        return DebugCheck(key=key, label=label, status="ok", detail=detail)

    # "ERROR" patterns
    if re.match(r"error[:\s]", lower) or re.search(r"\[error\]", lower):
        detail = re.sub(r"^error[:\s]*", "", line, flags=re.IGNORECASE).strip()
        key = _classify_check(lower)
        label = _label_for_key(key, detail)
        return DebugCheck(key=key, label=label, status="fail", detail=detail)

    # "WARN" patterns
    if re.match(r"warn[:\s]", lower) or re.search(r"\[warn\]", lower):
        detail = re.sub(r"^warn[:\s]*", "", line, flags=re.IGNORECASE).strip()
        key = _classify_check(lower)
        label = _label_for_key(key, detail)
        return DebugCheck(key=key, label=label, status="warn", detail=detail)

    # Pattern: "Connection test: [OK connection ok]" or "Connection:" result lines
    if re.search(r"connection\s+(?:test|ok)", lower):
        status = "fail" if "fail" in lower or "error" in lower else "ok"
        return DebugCheck(key="connection", label="Connection test", status=status, detail=line.strip())

    # Bracket patterns: "[OK]" "[ERROR]" at end of line
    m = re.search(r"\[(ok|error|warn)\]", lower)
    if m:
        raw_status = m.group(1)
        status = "ok" if raw_status == "ok" else ("fail" if raw_status == "error" else "warn")
        detail = re.sub(r"\[(?:ok|error|warn)\]", "", line, flags=re.IGNORECASE).strip()
        key = _classify_check(lower)
        label = _label_for_key(key, detail)
        return DebugCheck(key=key, label=label, status=status, detail=detail)

    return None


def _classify_check(lower: str) -> str:
    if "profiles" in lower:
        return "profiles_yml"
    if "dbt_project" in lower or "project.yml" in lower:
        return "dbt_project_yml"
    if "connection" in lower:
        return "connection"
    if "adapter" in lower:
        return "adapter"
    if "python" in lower:
        return "python"
    return "dbt"


def _label_for_key(key: str, detail: str) -> str:
    labels = {
        "profiles_yml": "profiles.yml",
        "dbt_project_yml": "dbt_project.yml",
        "connection": "Connection test",
        "adapter": "Adapter",
        "python": "Python",
        "dbt": "dbt",
    }
    return labels.get(key, detail[:50] if detail else key)
