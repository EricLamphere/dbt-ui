"""Parse and validate user-entered dbt commands (the "custom command" feature).

Commands are tokenized with shlex and executed via DbtRunner's argv-based
subprocess call, never through a shell, so metacharacters like `;` or `|`
are passed to dbt as literal arguments rather than interpreted.
"""
import re
import shlex
from dataclasses import dataclass

_SUBCOMMAND_RE = re.compile(r"^[a-z][a-z0-9_-]*$")
_SELECT_FLAGS = ("--select", "-s", "--models", "-m")
_TARGET_FLAGS = ("--target", "-t")
_PROFILES_DIR_FLAG = "--profiles-dir"

# Commands that block on stdin or never exit; either would hold the project's
# run lock indefinitely. Keys are argument prefixes.
_BLOCKED: dict[tuple[str, ...], str] = {
    ("init",): "`dbt init` is interactive and not supported here. Use New Project instead.",
    ("docs", "serve"): "`dbt docs serve` runs until stopped and is not supported here. Use the Docs page instead.",
}


class CustomCommandError(ValueError):
    """Raised when a custom command is empty, malformed, or not allowed."""


def _has_flag(args: tuple[str, ...], flags: tuple[str, ...]) -> bool:
    long_prefixes = tuple(f"{f}=" for f in flags if f.startswith("--"))
    return any(a in flags or a.startswith(long_prefixes) for a in args)


def _flag_value(args: tuple[str, ...], flags: tuple[str, ...]) -> str | None:
    """Return the value(s) of the first occurrence of any of `flags`, space-joined if multiple."""
    for i, arg in enumerate(args):
        for flag in flags:
            if flag.startswith("--") and arg.startswith(f"{flag}="):
                return arg.split("=", 1)[1] or None
        if arg in flags:
            values: list[str] = []
            for value in args[i + 1:]:
                if value.startswith("-"):
                    break
                values.append(value)
            return " ".join(values) or None
    return None


@dataclass(frozen=True)
class ParsedCommand:
    args: tuple[str, ...]  # user args, without a leading "dbt"
    selector: str | None  # for display in run history
    target: str | None
    has_target: bool
    has_profiles_dir: bool

    @property
    def subcommand(self) -> str:
        return self.args[0]

    @property
    def rest(self) -> tuple[str, ...]:
        return self.args[1:]

    @classmethod
    def from_args(cls, tokens: list[str]) -> "ParsedCommand":
        args = tuple(tokens[1:] if tokens and tokens[0] == "dbt" else tokens)
        if not args:
            raise CustomCommandError("Enter a dbt command, e.g. `ls --select my_model`.")
        if not _SUBCOMMAND_RE.match(args[0]):
            raise CustomCommandError(
                f"Start with a dbt subcommand (e.g. run, ls, compile), not `{args[0]}`."
            )
        for prefix, message in _BLOCKED.items():
            if args[: len(prefix)] == prefix:
                raise CustomCommandError(message)
        return cls(
            args=args,
            selector=_flag_value(args, _SELECT_FLAGS),
            target=_flag_value(args, _TARGET_FLAGS),
            has_target=_has_flag(args, _TARGET_FLAGS),
            has_profiles_dir=_has_flag(args, (_PROFILES_DIR_FLAG,)),
        )


def parse_custom_command(raw: str) -> ParsedCommand:
    try:
        tokens = shlex.split(raw)
    except ValueError as exc:
        raise CustomCommandError(f"Could not parse command: {exc} (check your quotes).") from exc
    return ParsedCommand.from_args(tokens)
