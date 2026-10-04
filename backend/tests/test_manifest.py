import json
from pathlib import Path

import pytest

from app.dbt.manifest import Manifest, load_manifest


def _write_manifest(tmp_path: Path, data: dict) -> Path:
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(data))
    return path


def _make_node(unique_id: str, resource_type: str = "model") -> dict:
    return {
        "unique_id": unique_id,
        "name": unique_id.split(".")[-1],
        "resource_type": resource_type,
        "schema": "analytics",
        "database": "warehouse",
        "config": {"materialized": "table"},
        "tags": [],
        "description": "",
        "original_file_path": f"models/{unique_id.split('.')[-1]}.sql",
    }


def test_load_manifest_missing_file(tmp_path: Path) -> None:
    result = load_manifest(tmp_path / "manifest.json")
    assert result is None


def test_load_manifest_invalid_json(tmp_path: Path) -> None:
    path = tmp_path / "manifest.json"
    path.write_text("not valid json{{{")
    result = load_manifest(path)
    assert result is None


def test_load_manifest_basic(tmp_path: Path) -> None:
    data = {
        "nodes": {
            "model.proj.orders": _make_node("model.proj.orders"),
            "model.proj.customers": _make_node("model.proj.customers"),
        },
        "sources": {},
        "parent_map": {
            "model.proj.orders": ["model.proj.customers"],
        },
    }
    path = _write_manifest(tmp_path, data)
    manifest = load_manifest(path)
    assert manifest is not None
    ids = {n.unique_id for n in manifest.nodes}
    assert "model.proj.orders" in ids
    assert "model.proj.customers" in ids


def test_load_manifest_edges(tmp_path: Path) -> None:
    data = {
        "nodes": {
            "model.proj.a": _make_node("model.proj.a"),
            "model.proj.b": _make_node("model.proj.b"),
        },
        "sources": {},
        "parent_map": {
            "model.proj.b": ["model.proj.a"],
        },
    }
    manifest = load_manifest(_write_manifest(tmp_path, data))
    assert manifest is not None
    edges = manifest.edges()
    assert ("model.proj.a", "model.proj.b") in edges


def test_load_manifest_filters_exposures(tmp_path: Path) -> None:
    data = {
        "nodes": {
            "exposure.proj.my_report": {
                "unique_id": "exposure.proj.my_report",
                "name": "my_report",
                "resource_type": "exposure",
                "tags": [],
                "description": "",
            }
        },
        "sources": {},
        "parent_map": {},
    }
    manifest = load_manifest(_write_manifest(tmp_path, data))
    assert manifest is not None
    assert len(manifest.nodes) == 0


def test_manifest_edges_excludes_missing_nodes(tmp_path: Path) -> None:
    data = {
        "nodes": {
            "model.proj.child": _make_node("model.proj.child"),
        },
        "sources": {},
        "parent_map": {
            "model.proj.child": ["model.proj.ghost"],
        },
    }
    manifest = load_manifest(_write_manifest(tmp_path, data))
    assert manifest is not None
    edges = manifest.edges()
    assert len(edges) == 0


def test_load_manifest_parses_unit_tests_separately(tmp_path: Path) -> None:
    path = _write_manifest(tmp_path, {
        "nodes": {"model.p.orders": _make_node("model.p.orders")},
        "unit_tests": {
            "unit_test.p.orders.test_orders_net": {
                "unique_id": "unit_test.p.orders.test_orders_net",
                "name": "test_orders_net",
                "resource_type": "unit_test",
                "model": "orders",
                "original_file_path": "models/_unit_tests.yml",
            },
            "unit_test.p.orders.broken": "not a dict",
        },
    })
    manifest = load_manifest(path)
    assert manifest is not None
    # Unit tests must not leak into the DAG nodes
    assert {n.unique_id for n in manifest.nodes} == {"model.p.orders"}
    assert len(manifest.unit_tests) == 1
    ut = manifest.unit_tests[0]
    assert ut.unique_id == "unit_test.p.orders.test_orders_net"
    assert ut.name == "test_orders_net"
    assert ut.model == "orders"
    assert ut.original_file_path == "models/_unit_tests.yml"


def test_load_manifest_without_unit_tests_key(tmp_path: Path) -> None:
    path = _write_manifest(tmp_path, {"nodes": {}})
    manifest = load_manifest(path)
    assert manifest is not None
    assert manifest.unit_tests == ()
