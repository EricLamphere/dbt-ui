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

    # Polar (polar.sh) licensing — organization ID is not a secret (it just
    # identifies which Polar org to validate license keys against), but the
    # API key IS a secret and must never be committed; both come from
    # backend/.env (gitignored), never hardcoded. polar_use_sandbox picks
    # which Polar environment (and API base URL) to talk to.
    polar_use_sandbox: bool = Field(default=True, alias="POLAR_USE_SANDBOX")
    polar_sandbox_organization_id: str | None = Field(default=None, alias="POLAR_SANDBOX_ORGANIZATION_ID")
    polar_sandbox_api_key: str | None = Field(default=None, alias="POLAR_SANDBOX_API_KEY")
    polar_production_organization_id: str | None = Field(default=None, alias="POLAR_PRODUCTION_ORGANIZATION_ID")
    polar_production_api_key: str | None = Field(default=None, alias="POLAR_PRODUCTION_API_KEY")
    polar_sandbox_checkout_url: str | None = Field(default=None, alias="POLAR_SANDBOX_CHECKOUT_URL")
    polar_production_checkout_url: str | None = Field(default=None, alias="POLAR_PRODUCTION_CHECKOUT_URL")

    @property
    def polar_checkout_url(self) -> str | None:
        return self.polar_sandbox_checkout_url if self.polar_use_sandbox else self.polar_production_checkout_url

    @property
    def polar_organization_id(self) -> str | None:
        return self.polar_sandbox_organization_id if self.polar_use_sandbox else self.polar_production_organization_id

    @property
    def polar_api_key(self) -> str | None:
        return self.polar_sandbox_api_key if self.polar_use_sandbox else self.polar_production_api_key

    @property
    def polar_api_base(self) -> str:
        return "https://sandbox-api.polar.sh" if self.polar_use_sandbox else "https://api.polar.sh"

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.data_dir / 'dbt_ui.sqlite'}"


settings = Settings()
