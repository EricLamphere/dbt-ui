import sys
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _is_frozen() -> bool:
    """True when running as a PyInstaller-bundled executable."""
    return getattr(sys, "frozen", False)


def _bundle_dir() -> Path:
    """Directory containing bundled data files (PyInstaller extraction dir, or repo root in dev)."""
    if _is_frozen():
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent.parent.parent


def _default_data_dir() -> Path:
    if not _is_frozen():
        return Path("data")
    try:
        from platformdirs import user_data_dir

        return Path(user_data_dir("dbt-ui", appauthor=False))
    except ImportError:
        return Path(sys.executable).parent / "data"


def _default_frontend_dist() -> Path:
    if _is_frozen():
        # Resolved relative to the executable itself, not PyInstaller's ephemeral
        # _MEIPASS extraction dir — Tauri lays out frontend_dist/ as a sibling
        # resource next to the sidecar binary, not inside it.
        return Path(sys.executable).resolve().parent / "frontend_dist"
    return Path("frontend/dist")


def _default_dbt_venv_dir() -> Path:
    if not _is_frozen():
        # Dev mode: the venv `task install:backend` creates at backend/.venv,
        # already on PATH-equivalent footing with the rest of the checkout.
        return Path(__file__).resolve().parent.parent / ".venv"
    # Packaged app: _MEIPASS (and the app bundle itself) is recreated/read-only
    # per launch, so the dbt venv — which "Run global setup" pip-installs
    # dbt-core + an adapter into — needs a real, persistent, writable location
    # that survives across launches and app updates.
    return _default_data_dir() / "dbt-venv"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DBT_UI_",
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
    )

    # Optional — can also be set via the Global Settings UI (stored in app_settings table)
    dbt_projects_path: Path | None = Field(default=None, alias="DBT_UI_PROJECTS_PATH")
    global_requirements_path: str | None = Field(default=None, alias="DBT_UI_GLOBAL_REQUIREMENTS_PATH")
    data_dir: Path = Field(default_factory=_default_data_dir)
    database_url: str = Field(default="")
    vscode_cmd: str = Field(default="code")
    log_level: str = Field(default="INFO")
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=8001)
    frontend_dist: Path = Field(default_factory=_default_frontend_dist)
    dbt_venv_dir: Path = Field(default_factory=_default_dbt_venv_dir)

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.data_dir / 'dbt_ui.sqlite'}"


settings = Settings()
