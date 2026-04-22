from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func, PrimaryKeyConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    path: Mapped[str] = mapped_column(String(1024), unique=True)
    platform: Mapped[str] = mapped_column(String(64), default="unknown")
    profile: Mapped[str | None] = mapped_column(String(255), nullable=True)
    vscode_cmd: Mapped[str | None] = mapped_column(String(255), nullable=True)
    init_script_path: Mapped[str] = mapped_column(String(255), default="init")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    ignored: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")

    init_steps: Mapped[list["InitStep"]] = relationship(
        back_populates="project", cascade="all, delete-orphan", order_by="InitStep.order"
    )


class InitStep(Base):
    __tablename__ = "init_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(255))
    order: Mapped[int] = mapped_column(Integer, default=0)
    script_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    is_base: Mapped[bool] = mapped_column(default=False)
    enabled: Mapped[bool] = mapped_column(default=True)

    project: Mapped[Project] = relationship(back_populates="init_steps")

    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_init_step_name"),)


class ModelStatus(Base):
    __tablename__ = "model_statuses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    unique_id: Mapped[str] = mapped_column(String(512), index=True)
    kind: Mapped[str] = mapped_column(String(32))  # "model" or "test"
    parent_model_id: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="idle")
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        UniqueConstraint("project_id", "unique_id", name="uq_status_project_unique"),
    )


class EnvProfile(Base):
    __tablename__ = "env_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    vars: Mapped[list["ProfileEnvVar"]] = relationship(
        back_populates="profile", cascade="all, delete-orphan"
    )

    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_env_profile_name"),)


class ProfileEnvVar(Base):
    __tablename__ = "profile_env_vars"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    profile_id: Mapped[int] = mapped_column(ForeignKey("env_profiles.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(255))
    value: Mapped[str] = mapped_column(Text, default="")

    profile: Mapped[EnvProfile] = relationship(back_populates="vars")

    __table_args__ = (UniqueConstraint("profile_id", "key", name="uq_profile_env_var_key"),)


class ProjectEnvVar(Base):
    __tablename__ = "project_env_vars"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(String(255))
    value: Mapped[str] = mapped_column(Text, default="")

    __table_args__ = (UniqueConstraint("project_id", "key", name="uq_env_var_key"),)


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(255), primary_key=True)
    value: Mapped[str] = mapped_column(Text, default="")


class RunInvocation(Base):
    __tablename__ = "run_invocations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    command: Mapped[str] = mapped_column(String(64))  # run, build, test, deps, init, etc.
    selector: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    log_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
