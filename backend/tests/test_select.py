import pytest

from app.dbt.select import build_selector


def test_only() -> None:
    assert build_selector("orders", "only") == "orders"


def test_upstream() -> None:
    assert build_selector("orders", "upstream") == "+orders"


def test_downstream() -> None:
    assert build_selector("orders", "downstream") == "orders+"


def test_full() -> None:
    assert build_selector("orders", "full") == "+orders+"


def test_invalid_mode() -> None:
    with pytest.raises(ValueError, match="unknown select mode"):
        build_selector("orders", "bad_mode")  # type: ignore[arg-type]
