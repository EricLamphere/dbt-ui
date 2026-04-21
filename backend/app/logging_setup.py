import logging
import sys
from pathlib import Path

import structlog


def configure_logging(level: str = "INFO", api_log_path: Path | None = None) -> None:
    """Configure structlog with console output + optional file sink for API logs."""
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
    ]

    if api_log_path is not None:
        api_log_path.parent.mkdir(parents=True, exist_ok=True)
        _file_handler = logging.FileHandler(str(api_log_path), encoding="utf-8")
        _file_handler.setFormatter(logging.Formatter("%(message)s"))

        _file_logger = logging.getLogger("dbt_ui.api")
        _file_logger.setLevel(level.upper())
        _file_logger.addHandler(_file_handler)
        _file_logger.propagate = False

    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=level.upper(),
    )
    structlog.configure(
        processors=[
            *shared_processors,
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, level.upper(), logging.INFO)
        ),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.BoundLogger:
    return structlog.get_logger(name)
