# How to Use the Integrated Terminal

dbt-ui includes an integrated bash/zsh terminal available from any project page. Use it to run dbt commands manually, inspect files, or run any shell command in the context of your project.

## Opening the terminal

1. Navigate to any project page.
2. Click the **Terminal** tab in the bottom panel (next to Run, Project Logs, API Logs).
3. A new terminal session starts automatically.

The terminal opens in your default shell (`$SHELL`, falling back to zsh → bash → sh). It is a full PTY — interactive programs, colors, and arrow keys all work.

## Multiple terminal tabs

You can open multiple terminal sessions side by side:

1. Click **+** in the terminal tab strip to start a new session.
2. Click any tab to switch between sessions.
3. Sessions persist as long as the tab is open — switching away does not kill the process.

Sessions are independent and do not share state. Each one starts in the same working directory.

## Resizing the terminal

Drag the top edge of the bottom panel upward to give the terminal more height. The terminal adapts automatically to the new size.

## Closing a terminal

Click **×** on any terminal tab to stop and close that session. The underlying PTY process is terminated.

Closing the bottom panel (dragging it shut) does **not** kill terminal sessions — they remain alive and resume when you reopen the panel.

## Using the terminal with dbt

The terminal is useful for:
- Running `dbt run --select` with custom selectors not available in the UI
- Running `dbt debug` to check your connection
- Running `dbt seed` or `dbt snapshot`
- Inspecting generated artifacts in `target/`
- Installing packages with `pip install` or `dbt deps`

The terminal shares the same working environment as dbt-ui's subprocess execution — it does **not** automatically inherit the project env vars set in the Environment tab. If you need those vars, set them in the terminal session manually or source them from your project's init scripts.

## Relationship to the init pipeline

The integrated terminal is separate from the init pipeline terminal (which appears in the **Opening project** modal). The init terminal shows `dbt init` output and runs once; the integrated terminal is persistent and interactive.

Both use the same underlying PTY infrastructure (`InteractiveInitManager`) but on separate SSE topics.

## Keyboard shortcuts

Standard terminal shortcuts work as expected:
- `Ctrl+C` — interrupt the current process
- `Ctrl+D` — send EOF (exits the shell)
- `Ctrl+L` — clear the screen
- `Ctrl+R` — reverse history search (if your shell supports it)
- `Ctrl+Z` — suspend (use `fg` to resume)

## Troubleshooting

**Terminal is blank** — The session may still be starting. Wait a moment or click **+** to start a fresh session.

**Terminal shows garbled output** — Resize the panel slightly to trigger a terminal resize event. This resolves most rendering glitches.

**Session exits immediately** — Check Project Logs for error output. The shell binary may not be found, or there may be a PTY startup error.

**Changes in the terminal don't appear in the UI** — dbt-ui watches the filesystem for changes. If you modify files in the terminal and the DAG doesn't update, check that the file watcher is active and that you saved the file.
