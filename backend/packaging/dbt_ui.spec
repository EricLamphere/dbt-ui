# PyInstaller spec for the dbt-ui backend, bundled as a Tauri resource.
#
# Build with:
#   cd backend && .venv/bin/pyinstaller packaging/dbt_ui.spec --distpath dist --workpath build --noconfirm
#
# dbt and git are intentionally NOT bundled — they remain external tools the
# user must already have on PATH, invoked via subprocess (see .claude/rules/dbt-execution.md).
#
# Built as --onedir (EXE + COLLECT), not onefile: onefile re-extracts the
# entire interpreter and libraries into a fresh temp dir on every single
# launch, which added ~7s to app startup. onedir keeps everything unpacked
# on disk permanently, so launching is just exec + dynamic-library load.
# Tauri's externalBin/sidecar mechanism only accepts a single file, so the
# resulting dbt-ui-backend/ folder is shipped as a plain Tauri "resource"
# and spawned directly (see src-tauri/src/lib.rs) instead of via .sidecar().

from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hidden_imports = (
    collect_submodules("sqlglot")
    + collect_submodules("dbt_artifacts_parser")
    + collect_submodules("uvicorn")
    + [
        # SQLAlchemy's aiosqlite dialect resolves this dynamically via
        # importlib, which PyInstaller's static analysis can't see.
        "aiosqlite",
    ]
)

# NOTE: the dbt venv (where "Run global setup" pip-installs dbt-core + an
# adapter) is created via the user's own system python3 on PATH, NOT via this
# frozen interpreter's `venv` module — venv.create(with_pip=True) inside a
# PyInstaller one-file binary fork-bombs, because ensurepip's bootstrap
# re-execs "python", which resolves to this whole frozen app rather than a
# real interpreter. See app/dbt/venv.py.

a = Analysis(
    ["../app/__main__.py"],
    pathex=[".."],
    binaries=[],
    datas=[],
    hiddenimports=hidden_imports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="dbt-ui-backend",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="dbt-ui-backend",
)
