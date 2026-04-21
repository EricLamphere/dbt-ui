import json
from pathlib import Path

import pytest

from app.dbt.run_results import load_run_results


def _write_rr(tmp_path: Path, results: list) -> Path:
    path = tmp_path / "run_results.json"
    path.write_text(json.dumps({"metadata": {}, "results": results}))
    return path


def test_missing_file(tmp_path: Path) -> None:
    assert load_run_results(tmp_path / "run_results.json") == []


def test_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "run_results.json"
    path.write_text("{{{{")
    assert load_run_results(path) == []


def test_success_result(tmp_path: Path) -> None:
    path = _write_rr(
        tmp_path,
        [{"unique_id": "model.proj.orders", "status": "success", "message": None, "execution_time": 1.2}],
    )
    results = load_run_results(path)
    assert len(results) == 1
    assert results[0].unique_id == "model.proj.orders"
    assert results[0].status == "success"


def test_fail_maps_to_error(tmp_path: Path) -> None:
    path = _write_rr(
        tmp_path,
        [{"unique_id": "test.proj.not_null", "status": "fail", "message": "1 rows", "execution_time": 0.5}],
    )
    results = load_run_results(path)
    assert results[0].status == "error"


def test_pass_maps_to_success(tmp_path: Path) -> None:
    path = _write_rr(
        tmp_path,
        [{"unique_id": "test.proj.unique", "status": "pass", "message": None, "execution_time": 0.1}],
    )
    results = load_run_results(path)
    assert results[0].status == "success"


def test_skipped_maps_to_idle(tmp_path: Path) -> None:
    path = _write_rr(
        tmp_path,
        [{"unique_id": "model.proj.x", "status": "skipped", "message": None, "execution_time": 0.0}],
    )
    results = load_run_results(path)
    assert results[0].status == "idle"
