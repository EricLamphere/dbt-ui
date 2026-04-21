from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="DBT_UI_",
        env_file=".env",
        extra="ignore",
        populate_by_name=True,
    )

    # Optional — can also be set via the Global Settings UI (stored in app_settings table)
    dbt_projects_path: Path | None = Field(default=None, alias="DBT_PROJECTS_PATH")
    data_dir: Path = Field(default=Path("data"))
    database_url: str = Field(default="")
    vscode_cmd: str = Field(default="code")
    log_level: str = Field(default="INFO")
    host: str = Field(default="127.0.0.1")
    port: int = Field(default=8001)
    frontend_dist: Path = Field(default=Path("frontend/dist"))

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.data_dir / 'dbt_ui.sqlite'}"


settings = Settings()
