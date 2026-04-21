from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="DBT_UI_", env_file=".env", extra="ignore")

    workspace: Path = Field(
        default=Path("/workspace"),
        validation_alias=AliasChoices("DBT_PROJECTS_PATH", "DBT_UI_WORKSPACE"),
    )
    data_dir: Path = Field(default=Path("/data"))
    database_url: str = Field(default="")
    vscode_cmd: str = Field(default="code")
    log_level: str = Field(default="INFO")
    host: str = Field(default="0.0.0.0")
    port: int = Field(default=8000)
    frontend_dist: Path = Field(default=Path("/app/frontend_dist"))

    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite+aiosqlite:///{self.data_dir / 'dbt_ui.sqlite'}"


settings = Settings()
