# Use Source Control (Git)

dbt-ui includes a VSCode-style Source Control panel for the active dbt project. It requires the project to live inside a git repository — the repo root is found by walking upward from the project directory, so mono-repo layouts work.

## Opening Source Control

Click **Source Control** in the left rail of any project page. The panel loads the current branch, ahead/behind counts, and the list of changed files.

Like VS Code, the panel is a stack of collapsible sections: **Changes** (expanded), **Impact** (expanded) and **Commit History** (collapsed), with the branch/commit/push box always at the bottom. Click a section header to collapse or expand it; dbt-ui remembers your choice.

If the project is not inside a git repository, the panel shows "Not a git repository" with no file list.

## Viewing Changes

In the **Changes** section (its header shows the total), changed files are grouped into:

| Group | What it shows |
|---|---|
| **Staged Changes** | Files added to the index (`git add`) |
| **Merge Conflicts** | Unmerged files |
| **Unstaged Changes** | Worktree modifications and new files not yet staged |

Each file row shows a status letter: **M** (modified), **A** (added), **D** (deleted), **R** (renamed), **U** (untracked / unmerged).

Click a file to open its Monaco diff view on the right — HEAD on the left, working tree on the right. The diff is read-only; use the file editor to make changes.

If the file defines a dbt node (a model's SQL, a seed's CSV, or a YAML file defining sources or exposures), the bottom pane's **Node DAG** and **Impact** tabs follow it, just as they do for the open file on the Files page. Impact follows it in **Selection** mode; the **Uncommitted** and **Branch** modes keep showing the whole change set.

## Staging and Unstaging

Hover a file row to reveal action buttons:

- **+** — stage the file (`git add`)
- **−** — unstage the file (`git restore --staged`)
- **↶** — discard working-tree changes (`git restore`). A confirmation dialog appears before discarding.

The **+** button in a section header stages / unstages all files in that group.

## Committing

Type a commit message in the text area at the bottom of the changes panel. Press **⌘↵** (or **Ctrl↵**) or click the **Commit** button to commit staged files. The button shows the number of staged files.

## Push and Pull

The **push / pull** icon button appears next to the branch chip. It pushes if you are ahead of the upstream, or pulls if you are behind. Output streams live into a log area above the commit message box.

Authentication uses your existing `~/.gitconfig` credential helper or SSH agent — no credentials are entered in dbt-ui. If auth fails, fix your credential helper externally and retry.

## Switching Branches

Click the **branch chip** (showing the current branch name) to open the branch picker:

- Filter branches by typing in the search field.
- Click a branch name to check it out.
- Click **+ Create new branch** to create a branch off the current HEAD.

## Commit History

Expand the **Commit History** section (collapsed by default) to see the commit log. The log shows the 200 most recent commits (hash, author, date, message) and refreshes after commits, pulls and branch switches. While a file is selected, an **All / <file>** toggle lets you narrow the log to commits that touched that file (it defaults to All). Drag the top edge of the Commit History section to resize it (double-click to reset); the size and open state are remembered.

## Impact of Your Changes

The **Impact** section (between Changes and Commit History; its header shows how many dbt nodes you've changed) summarizes what your uncommitted changes affect downstream, counting changes to models, seeds, snapshots, sources, exposures and macros. If they touch no dbt nodes it says so. Otherwise it reads like "3 changed nodes affect 9 models · 1 exposure · 27 tests", with flags for risky downstream nodes (untested, exposures, incremental, failing or stale). It also warns when `dbt_project.yml` or `packages.yml` changed, since that can affect every node.

- **Details** opens the bottom pane's **Impact** tab in **Uncommitted** mode, with the full downstream list. Switch it to **Branch** to see everything on your branch compared to `main` (or another base) before opening a PR.
- **Build impacted** runs `dbt build --select <changed>+`, which builds the changed nodes and everything downstream and runs their tests.

See [Seeing what a change would affect](navigate-dag.md#seeing-what-a-change-would-affect) for how changes are matched to nodes.

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Commit | ⌘↵ / Ctrl↵ |

## Notes

- Push and pull run non-interactively. If your remote requires interactive authentication (e.g. an SSH key without a loaded agent), configure your credential helper or SSH agent outside dbt-ui.
- Merge conflict resolution is not built in — conflicted files appear in the panel, but you must resolve them in the file editor and then stage the result.
- The branch chip and file list update automatically (within ~250ms) when you run git commands in an external terminal, thanks to the `.git/` directory watcher.
