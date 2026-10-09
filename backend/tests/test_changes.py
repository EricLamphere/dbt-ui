"""Unit tests for mapping changed files to manifest nodes (app.dbt.changes)."""
from app.dbt.changes import (
    DEFAULT_RESOURCE_DIRS,
    ChangedFile,
    map_changed_files,
    resource_dirs_from_project_yml,
)


def _manifest() -> dict:
    return {
        "metadata": {"project_name": "shop"},
        "nodes": {
            "model.shop.stg_orders": {
                "resource_type": "model",
                "name": "stg_orders",
                "original_file_path": "models/staging/stg_orders.sql",
                "patch_path": "shop://models/staging/_staging.yml",
                "depends_on": {"macros": ["macro.shop.cents_to_dollars"]},
            },
            "model.shop.stg_customers": {
                "resource_type": "model",
                "name": "stg_customers",
                "original_file_path": "models/staging/stg_customers.sql",
                "patch_path": "shop://models/staging/_staging.yml",
                "depends_on": {"macros": ["macro.shop.normalize_email"]},
            },
            "model.shop.fct_revenue": {
                "resource_type": "model",
                "name": "fct_revenue",
                "original_file_path": "models/marts/fct_revenue.sql",
                "patch_path": None,
                "depends_on": {"macros": ["macro.dbt.is_incremental"]},
            },
            "seed.shop.countries": {
                "resource_type": "seed",
                "name": "countries",
                "original_file_path": "seeds/countries.csv",
                "patch_path": "shop://seeds/properties.yml",
                "depends_on": {"macros": []},
            },
            "test.shop.not_null_stg_orders_id": {
                "resource_type": "test",
                "name": "not_null_stg_orders_id",
                "original_file_path": "models/staging/_staging.yml",
                "depends_on": {"macros": ["macro.dbt.test_not_null"]},
            },
            "test.shop.assert_positive": {
                "resource_type": "test",
                "name": "assert_positive",
                "original_file_path": "tests/assert_positive.sql",
                "depends_on": {"macros": []},
            },
        },
        "sources": {
            "source.shop.raw.orders": {
                "resource_type": "source",
                "name": "orders",
                "original_file_path": "models/staging/_sources.yml",
            },
            "source.shop.raw.customers": {
                "resource_type": "source",
                "name": "customers",
                "original_file_path": "models/staging/_sources.yml",
            },
        },
        "exposures": {
            "exposure.shop.dash": {
                "resource_type": "exposure",
                "name": "dash",
                "original_file_path": "models/marts/_exposures.yml",
            },
        },
        "macros": {
            "macro.shop.cents_to_dollars": {
                "name": "cents_to_dollars",
                "package_name": "shop",
                "original_file_path": "macros/cents_to_dollars.sql",
                "depends_on": {"macros": ["macro.shop.round_money"]},
            },
            "macro.shop.round_money": {
                "name": "round_money",
                "package_name": "shop",
                "original_file_path": "macros/round_money.sql",
                "depends_on": {"macros": []},
            },
            "macro.shop.normalize_email": {
                "name": "normalize_email",
                "package_name": "shop",
                "original_file_path": "macros/normalize_email.sql",
                "depends_on": {"macros": []},
            },
            "macro.dbt.is_incremental": {
                "name": "is_incremental",
                "package_name": "dbt",
                "original_file_path": "macros/materializations/is_incremental.sql",
                "depends_on": {"macros": []},
            },
        },
    }


def _reasons(mapping, uid: str) -> list[tuple[str, str, str | None]]:
    return [(r.kind, r.path, r.macro) for r in mapping.nodes[uid]]


def test_sql_file_maps_to_its_model() -> None:
    mapping = map_changed_files(_manifest(), [ChangedFile("models/marts/fct_revenue.sql", "modified")])
    assert list(mapping.nodes) == ["model.shop.fct_revenue"]
    assert _reasons(mapping, "model.shop.fct_revenue") == [("file", "models/marts/fct_revenue.sql", None)]
    assert mapping.unmapped == ()


def test_seed_csv_maps_to_seed() -> None:
    mapping = map_changed_files(_manifest(), [ChangedFile("seeds/countries.csv", "modified")])
    assert list(mapping.nodes) == ["seed.shop.countries"]


def test_schema_yaml_maps_to_every_patched_node_but_not_tests() -> None:
    mapping = map_changed_files(_manifest(), [ChangedFile("models/staging/_staging.yml", "modified")])
    assert sorted(mapping.nodes) == ["model.shop.stg_customers", "model.shop.stg_orders"]
    assert _reasons(mapping, "model.shop.stg_orders") == [("yaml", "models/staging/_staging.yml", None)]


def test_sources_and_exposures_map_via_their_yaml_file() -> None:
    mapping = map_changed_files(_manifest(), [
        ChangedFile("models/staging/_sources.yml", "modified"),
        ChangedFile("models/marts/_exposures.yml", "added"),
    ])
    assert sorted(mapping.nodes) == ["exposure.shop.dash", "source.shop.raw.customers", "source.shop.raw.orders"]


def test_macro_change_maps_to_models_calling_it_directly_or_transitively() -> None:
    mapping = map_changed_files(_manifest(), [ChangedFile("macros/round_money.sql", "modified")])
    # round_money is called by cents_to_dollars, which stg_orders calls
    assert list(mapping.nodes) == ["model.shop.stg_orders"]
    assert _reasons(mapping, "model.shop.stg_orders") == [("macro", "macros/round_money.sql", "round_money")]


def test_package_macros_with_colliding_paths_are_ignored() -> None:
    mapping = map_changed_files(_manifest(), [ChangedFile("macros/materializations/is_incremental.sql", "modified")])
    assert mapping.nodes == {}
    assert [f.path for f in mapping.unmapped] == ["macros/materializations/is_incremental.sql"]


def test_reasons_accumulate_per_node() -> None:
    mapping = map_changed_files(_manifest(), [
        ChangedFile("models/staging/stg_orders.sql", "modified"),
        ChangedFile("macros/cents_to_dollars.sql", "modified"),
    ])
    assert [r.kind for r in mapping.nodes["model.shop.stg_orders"]] == ["file", "macro"]


def test_test_only_files_are_matched_but_produce_no_nodes() -> None:
    mapping = map_changed_files(_manifest(), [ChangedFile("tests/assert_positive.sql", "modified")])
    assert mapping.nodes == {}
    assert mapping.unmapped == ()


def test_project_wide_unmapped_and_ignored_files() -> None:
    mapping = map_changed_files(_manifest(), [
        ChangedFile("dbt_project.yml", "modified"),
        ChangedFile("packages.yml", "modified"),
        ChangedFile("models/marts/new_model.sql", "added"),
        ChangedFile("README.md", "modified"),
        ChangedFile("target/compiled/x.sql", "modified"),
        ChangedFile("dbt_packages/dbt_utils/macros/x.sql", "modified"),
    ])
    assert mapping.nodes == {}
    assert [f.path for f in mapping.project_wide] == ["dbt_project.yml", "packages.yml"]
    assert [(f.path, f.change) for f in mapping.unmapped] == [("models/marts/new_model.sql", "added")]
    assert mapping.relevant_files == 3


def test_relevant_files_counts_matched_files() -> None:
    mapping = map_changed_files(_manifest(), [
        ChangedFile("models/marts/fct_revenue.sql", "modified"),
        ChangedFile("tests/assert_positive.sql", "modified"),
        ChangedFile("dbtui/workspace/scratch.sql", "added"),
    ])
    assert mapping.relevant_files == 2


def test_missing_manifest_sections_are_tolerated() -> None:
    mapping = map_changed_files({}, [ChangedFile("models/a.sql", "modified")])
    assert mapping.nodes == {}
    assert [f.path for f in mapping.unmapped] == ["models/a.sql"]


def test_unmapped_only_reports_files_under_resource_dirs() -> None:
    mapping = map_changed_files(_manifest(), [
        ChangedFile("dbtui/workspace/scratch.sql", "added"),
        ChangedFile("scripts/load.py", "modified"),
        ChangedFile("transform/new.sql", "added"),
        ChangedFile("models/new.sql", "added"),
    ], resource_dirs=("transform", "models"))
    assert [f.path for f in mapping.unmapped] == ["transform/new.sql", "models/new.sql"]


def test_resource_dirs_from_project_yml() -> None:
    text = "name: shop\nmodel-paths: ['transform', 'more_models']\nseed-paths: ['data']\n"
    dirs = resource_dirs_from_project_yml(text)
    assert dirs == ("transform", "more_models", "data", "macros", "snapshots", "tests", "analyses")


def test_resource_dirs_defaults_on_missing_or_bad_yaml() -> None:
    assert resource_dirs_from_project_yml(None) == DEFAULT_RESOURCE_DIRS
    assert resource_dirs_from_project_yml(":\n  - [") == DEFAULT_RESOURCE_DIRS
    assert resource_dirs_from_project_yml("model-paths: models/\n") == DEFAULT_RESOURCE_DIRS
