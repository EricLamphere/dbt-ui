"""The `python_path` global setting: which interpreter the dbt venv is built from.

Stored in app_settings like every other global setting, and mirrored into
app.dbt.venv (via set_configured_python) because venv resolution is sync.
"""
import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AppSetting
from app.dbt import venv
from app.logging_setup import get_logger

log = get_logger(__name__)

PYTHON_PATH_KEY = "python_path"


async def load_python_setting(session: AsyncSession) -> str | None:
    """Mirror the stored setting into venv; seed it on first run.

    When unset, the setting starts as whatever the existing venv was built from
    (so upgrading never triggers a rebuild), else the first suitable system
    interpreter. If none is found it stays unset and ensure_venv() reports the
    missing-Python error when dbt is first needed.
    """
    row = await session.get(AppSetting, PYTHON_PATH_KEY)
    value = row.value if row is not None and row.value else None
    if value is None:
        value = await asyncio.get_running_loop().run_in_executor(None, venv.detect_python)
        if value is None:
            log.warning("python_path_not_detected")
        else:
            if row is None:
                session.add(AppSetting(key=PYTHON_PATH_KEY, value=value))
            else:
                row.value = value
            await session.commit()
            log.info("python_path_detected", python=value)
    venv.set_configured_python(value)
    return value
