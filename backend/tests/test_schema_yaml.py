from pathlib import Path

import pytest
import yaml

from app.dbt.schema_yaml import DocumentTarget, SchemaYamlError, document_node


def _target(
    name: str = "orders",
    resource_type: str = "model",
    original_file_path: str = "models/marts/orders.sql",
    patch_path: str | None = None,
) -> DocumentTarget:
    return DocumentTarget(
        name=name,
        resource_type=resource_type,
        original_file_path=original_file_path,
        patch_path=patch_path,
    )


@pytest.fixture
def project(tmp_path: Path) -> Path:
    (tmp_path / "models" / "marts").mkdir(parents=True)
    (tmp_path / "models" / "marts" / "orders.sql").write_text("select 1 as id")
    return tmp_path


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text())


def test_creates_schema_yml_when_folder_has_none(project: Path) -> None:
    result = document_node(project, _target(), ["id", "amount"])

    schema = project / "models" / "marts" / "schema.yml"
    assert result.path == "models/marts/schema.yml"
    assert result.created_file is True
    assert result.added_entry is True
    assert result.added_columns == ("id", "amount")
    assert _load(schema) == {
        "version": 2,
        "models": [{"name": "orders", "columns": [{"name": "id"}, {"name": "amount"}]}],
    }


def test_adds_entry_to_existing_models_file(project: Path) -> None:
    existing = project / "models" / "marts" / "_marts.yml"
    existing.write_text("version: 2\n\nmodels:\n  - name: customers\n")

    result = document_node(project, _target(), ["id"])

    assert result.path == "models/marts/_marts.yml"
    assert result.created_file is False
    assert result.added_entry is True
    data = _load(existing)
    assert [m["name"] for m in data["models"]] == ["customers", "orders"]
    assert data["models"][1]["columns"] == [{"name": "id"}]


def test_prefers_file_already_containing_the_entry(project: Path) -> None:
    folder = project / "models" / "marts"
    (folder / "a.yml").write_text("version: 2\nmodels:\n  - name: customers\n")
    (folder / "b.yml").write_text("version: 2\nmodels:\n  - name: orders\n")

    result = document_node(project, _target(), ["id"])

    assert result.path == "models/marts/b.yml"
    assert result.added_entry is False
    assert _load(folder / "a.yml")["models"] == [{"name": "customers"}]


def test_uses_patch_path_when_present(project: Path) -> None:
    other = project / "models" / "schema"
    other.mkdir()
    (other / "all.yml").write_text("version: 2\nmodels:\n  - name: orders\n")

    result = document_node(
        project, _target(patch_path="my_pkg://models/schema/all.yml"), ["id"]
    )

    assert result.path == "models/schema/all.yml"
    assert _load(other / "all.yml")["models"][0]["columns"] == [{"name": "id"}]
    assert not (project / "models" / "marts" / "schema.yml").exists()


def test_skips_existing_columns_case_insensitively(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text(
        "version: 2\nmodels:\n  - name: orders\n    columns:\n      - name: id\n"
        "        description: pk\n"
    )

    result = document_node(project, _target(), ["ID", "amount", "amount", "  "])

    assert result.added_columns == ("amount",)
    cols = _load(schema)["models"][0]["columns"]
    assert cols == [{"name": "id", "description": "pk"}, {"name": "amount"}]


def test_no_write_when_nothing_to_add(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    original = "version: 2\nmodels:\n  - name: orders\n    columns:\n      - name: id\n"
    schema.write_text(original)
    mtime = schema.stat().st_mtime_ns

    result = document_node(project, _target(), ["id"])

    assert result.added_entry is False
    assert result.added_columns == ()
    assert schema.stat().st_mtime_ns == mtime


def test_preserves_comments_and_indentation(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text(
        "version: 2\n"
        "\n"
        "# hand-written notes\n"
        "models:\n"
        "- name: orders  # the orders model\n"
        "  description: All orders\n"
    )

    document_node(project, _target(), ["id"])

    text = schema.read_text()
    assert "# hand-written notes" in text
    assert "# the orders model" in text
    assert "- name: orders" in text.splitlines()[4]  # flush sequence style kept
    assert _load(schema)["models"][0]["columns"] == [{"name": "id"}]


def test_adds_models_key_to_schema_yml_with_only_sources(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text("version: 2\nsources:\n  - name: raw\n")

    result = document_node(project, _target(), ["id"])

    assert result.created_file is False
    data = _load(schema)
    assert data["sources"] == [{"name": "raw"}]
    assert data["models"] == [{"name": "orders", "columns": [{"name": "id"}]}]


def test_seed_uses_seeds_key(tmp_path: Path) -> None:
    (tmp_path / "seeds").mkdir()
    (tmp_path / "seeds" / "countries.csv").write_text("code\nUS\n")

    result = document_node(
        tmp_path,
        _target(name="countries", resource_type="seed", original_file_path="seeds/countries.csv"),
        ["code"],
    )

    assert result.path == "seeds/schema.yml"
    assert _load(tmp_path / "seeds" / "schema.yml")["seeds"] == [
        {"name": "countries", "columns": [{"name": "code"}]}
    ]


def test_entry_without_columns_gets_columns_key(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text("version: 2\nmodels:\n  - name: orders\n    columns:\n")

    result = document_node(project, _target(), ["id"])

    assert result.added_columns == ("id",)
    assert _load(schema)["models"][0]["columns"] == [{"name": "id"}]


def test_rejects_unsupported_resource_type(project: Path) -> None:
    with pytest.raises(SchemaYamlError, match="not supported"):
        document_node(project, _target(resource_type="test"), ["id"])


def test_rejects_path_outside_project(project: Path) -> None:
    with pytest.raises(SchemaYamlError, match="outside the project"):
        document_node(project, _target(original_file_path="../elsewhere/orders.sql"), ["id"])


def test_rejects_malformed_resource_list(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text("version: 2\nmodels: not-a-list\n")

    with pytest.raises(SchemaYamlError, match="not a list"):
        document_node(project, _target(), ["id"])


def test_rejects_unparseable_patch_path_file(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text("models: [\n")

    with pytest.raises(SchemaYamlError, match="could not parse"):
        document_node(project, _target(patch_path="pkg://models/marts/schema.yml"), ["id"])


def test_unparseable_sibling_is_ignored_during_discovery(project: Path) -> None:
    folder = project / "models" / "marts"
    (folder / "broken.yml").write_text("models: [\n")

    result = document_node(project, _target(), ["id"])

    assert result.path == "models/marts/schema.yml"
    assert result.created_file is True


WRAPPED = (
    "version: 2\n"
    "models:\n"
    "- name: orders\n"
    "  description: 'A long description that a dumper wrapped across\n"
    "    multiple lines at eighty columns.\n"
    "\n"
    "    '\n"
    "  columns:\n"
    "  - name: id\n"
    "    description: Calendar date of aggregated orders, which is quite a long line indeed.\n"
    "  # - name: old_col\n"
    "  #   description: commented out\n"
    "- name: customers\n"
    "  description: Inventory status mart joining movement history with product dimensions.\n"
    "    Includes stockout risk flags.\n"
    "  columns:\n"
    "  - name: id\n"
)


def test_existing_text_is_byte_preserved(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text(WRAPPED)

    document_node(project, _target(), ["amount"])

    lines = schema.read_text().splitlines(keepends=True)
    assert lines.pop(9 + 1) == "  - name: amount\n"
    assert "".join(lines) == WRAPPED


def test_entry_appended_after_last_item_keeps_style(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text(WRAPPED + "\n# trailing comment\n")

    document_node(project, _target(name="payments"), ["id"])

    text = schema.read_text()
    assert text.startswith(WRAPPED + "- name: payments\n  columns:\n  - name: id\n")
    assert text.endswith("\n# trailing comment\n")


def test_columns_added_when_columns_key_is_not_last(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text(
        "version: 2\n"
        "models:\n"
        "  - name: orders\n"
        "    columns:\n"
        "      - name: id\n"
        "    config:\n"
        "      materialized: table\n"
        "  - name: customers\n"
    )

    document_node(project, _target(), ["amount"])

    assert schema.read_text() == (
        "version: 2\n"
        "models:\n"
        "  - name: orders\n"
        "    columns:\n"
        "      - name: id\n"
        "      - name: amount\n"
        "    config:\n"
        "      materialized: table\n"
        "  - name: customers\n"
    )


def test_columns_key_added_to_entry_without_one(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text(
        "version: 2\nmodels:\n  - name: orders\n    description: x\n  - name: customers\n"
    )

    document_node(project, _target(), ["id"])

    assert schema.read_text() == (
        "version: 2\nmodels:\n  - name: orders\n    description: x\n"
        "    columns:\n      - name: id\n  - name: customers\n"
    )


def test_column_names_needing_quotes_are_quoted(project: Path) -> None:
    document_node(project, _target(), ["yes", "has space", "a:b", "#hash"])

    data = _load(project / "models" / "marts" / "schema.yml")
    assert [c["name"] for c in data["models"][0]["columns"]] == ["yes", "has space", "a:b", "#hash"]


def test_flow_style_columns_rejected(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    original = "version: 2\nmodels:\n  - name: orders\n    columns: []\n"
    schema.write_text(original)

    with pytest.raises(SchemaYamlError, match="inline"):
        document_node(project, _target(), ["id"])
    assert schema.read_text() == original


def test_crlf_line_endings_preserved(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_bytes(b"version: 2\r\nmodels:\r\n  - name: orders\r\n")

    document_node(project, _target(), ["id"])

    assert schema.read_bytes() == (
        b"version: 2\r\nmodels:\r\n  - name: orders\r\n    columns:\r\n      - name: id\r\n"
    )


def test_resource_key_with_no_value(project: Path) -> None:
    schema = project / "models" / "marts" / "schema.yml"
    schema.write_text("version: 2\nmodels:\nsources:\n  - name: raw\n")

    document_node(project, _target(), ["id"])

    data = _load(schema)
    assert data["models"] == [{"name": "orders", "columns": [{"name": "id"}]}]
    assert data["sources"] == [{"name": "raw"}]
