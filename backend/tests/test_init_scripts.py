import stat
from pathlib import Path

import pytest

from app.dbt.init_scripts import delete_script, list_scripts, save_script


def test_list_scripts_empty(tmp_path: Path) -> None:
    assert list_scripts(tmp_path) == []


def test_save_and_list_script(tmp_path: Path) -> None:
    save_script(tmp_path, "setup_dev", "#!/bin/bash\necho hello")
    scripts = list_scripts(tmp_path)
    assert len(scripts) == 1
    assert scripts[0].name == "setup_dev"
    assert "echo hello" in scripts[0].content


def test_saved_script_is_executable(tmp_path: Path) -> None:
    script = save_script(tmp_path, "my_step", "#!/bin/bash\ntrue")
    mode = script.path.stat().st_mode
    assert mode & stat.S_IXUSR


def test_delete_script(tmp_path: Path) -> None:
    save_script(tmp_path, "cleanup", "#!/bin/bash\n")
    assert delete_script(tmp_path, "cleanup") is True
    assert list_scripts(tmp_path) == []


def test_delete_missing_script(tmp_path: Path) -> None:
    assert delete_script(tmp_path, "ghost") is False


def test_save_script_rejects_path_traversal(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        save_script(tmp_path, "../evil", "#!/bin/bash\n")


def test_save_script_rejects_slash_name(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        save_script(tmp_path, "a/b", "#!/bin/bash\n")


def test_multiple_scripts_sorted(tmp_path: Path) -> None:
    save_script(tmp_path, "z_last", "#!/bin/bash\n")
    save_script(tmp_path, "a_first", "#!/bin/bash\n")
    names = [s.name for s in list_scripts(tmp_path)]
    assert names == ["a_first", "z_last"]
