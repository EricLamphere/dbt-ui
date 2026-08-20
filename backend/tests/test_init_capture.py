"""
Tests for _capture_script_exports (app.api.init), which sources a custom
init script and captures whatever env vars it exports.

Regression coverage for a bug where a multi-line exported value (e.g. a PEM
private key) was silently dropped by a line-based `export -p` parser.
"""

import os
from pathlib import Path

from app.api.init import _capture_script_exports

PEM_VALUE = "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCB\nKEYDATAHERE\n-----END PRIVATE KEY-----"


def _write_script(tmp_path: Path, body: str) -> str:
    script = tmp_path / "auth.sh"
    script.write_text(f"#!/bin/bash\n{body}\n")
    script.chmod(0o755)
    return str(script)


async def test_captures_multiline_exported_value(tmp_path: Path) -> None:
    script_path = _write_script(
        tmp_path,
        f'export SNOWFLAKE_PRIVATE_KEY="{PEM_VALUE}"\nexport SNOWFLAKE_USER=alice\n',
    )
    base_env = dict(os.environ)
    exported = await _capture_script_exports(script_path, str(tmp_path), base_env)
    assert exported["SNOWFLAKE_PRIVATE_KEY"] == PEM_VALUE
    assert exported["SNOWFLAKE_USER"] == "alice"


async def test_captures_single_line_exported_value(tmp_path: Path) -> None:
    script_path = _write_script(tmp_path, "export FOO=bar\n")
    base_env = dict(os.environ)
    exported = await _capture_script_exports(script_path, str(tmp_path), base_env)
    assert exported["FOO"] == "bar"


async def test_unchanged_vars_are_not_returned(tmp_path: Path) -> None:
    script_path = _write_script(tmp_path, "export FOO=bar\nexport BAZ=qux\n")
    base_env = {**os.environ, "FOO": "bar"}
    exported = await _capture_script_exports(script_path, str(tmp_path), base_env)
    assert "FOO" not in exported
    assert exported["BAZ"] == "qux"
