"""Unit tests for app.dbt.custom_command.parse_custom_command."""
import pytest

from app.dbt.custom_command import CustomCommandError, ParsedCommand, parse_custom_command


def test_parses_basic_command() -> None:
    parsed = parse_custom_command("run --select my_model")
    assert parsed.args == ("run", "--select", "my_model")
    assert parsed.subcommand == "run"
    assert parsed.rest == ("--select", "my_model")


def test_strips_leading_dbt() -> None:
    parsed = parse_custom_command("  dbt ls --resource-type model  ")
    assert parsed.args == ("ls", "--resource-type", "model")


def test_respects_quotes() -> None:
    parsed = parse_custom_command("run --vars '{\"a\": 1, \"b\": 2}'")
    assert parsed.args == ("run", "--vars", '{"a": 1, "b": 2}')


@pytest.mark.parametrize("raw", ["", "   ", "dbt", "  dbt  "])
def test_rejects_empty(raw: str) -> None:
    with pytest.raises(CustomCommandError, match="Enter a dbt command"):
        parse_custom_command(raw)


def test_rejects_unbalanced_quotes() -> None:
    with pytest.raises(CustomCommandError, match="quote"):
        parse_custom_command("run --vars '{a: 1}")


@pytest.mark.parametrize("raw", ["--debug run", "dbt -s my_model"])
def test_rejects_leading_flag(raw: str) -> None:
    with pytest.raises(CustomCommandError, match="subcommand"):
        parse_custom_command(raw)


@pytest.mark.parametrize("raw", ["init", "dbt init my_project", "docs serve", "docs serve --port 9000"])
def test_rejects_interactive_or_long_running(raw: str) -> None:
    with pytest.raises(CustomCommandError, match="not supported"):
        parse_custom_command(raw)


def test_allows_docs_generate() -> None:
    assert parse_custom_command("docs generate").args == ("docs", "generate")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("run --select a b", "a b"),
        ("run -s +my_model", "+my_model"),
        ("test --select=tag:nightly", "tag:nightly"),
        ("run -m legacy", "legacy"),
        ("run --models legacy", "legacy"),
        ("run --full-refresh", None),
        ("run --select", None),
    ],
)
def test_extracts_selector(raw: str, expected: str | None) -> None:
    assert parse_custom_command(raw).selector == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("run", False), ("run --target prod", True), ("run -t prod", True), ("run --target=prod", True)],
)
def test_detects_target(raw: str, expected: bool) -> None:
    assert parse_custom_command(raw).has_target is expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("run", False), ("run --profiles-dir ~/.dbt", True), ("run --profiles-dir=/x", True)],
)
def test_detects_profiles_dir(raw: str, expected: bool) -> None:
    assert parse_custom_command(raw).has_profiles_dir is expected


def test_from_args_round_trip() -> None:
    parsed = parse_custom_command("build -s my_model --full-refresh")
    assert ParsedCommand.from_args(list(parsed.args)) == parsed


def test_from_args_validates() -> None:
    with pytest.raises(CustomCommandError, match="not supported"):
        ParsedCommand.from_args(["init"])
