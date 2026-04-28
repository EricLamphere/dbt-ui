# Use Source Control (Git)

dbt-ui includes a VSCode-style Source Control panel for the active dbt project. It requires the project to live inside a git repository — the repo root is found by walking upward from the project directory, so mono-repo layouts work.

## Opening Source Control

Click **Source Control** in the left rail of any project page. The panel loads the current branch, ahead/behind counts, and the list of changed files.

If the project is not inside a git repository, the panel shows "Not a git repository" with no file list.

## Viewing Changes

Changed files are grouped into three sections:

| Section | What it shows |
|---|---|
| **Staged Changes** | Files added to the index (`git add`) |
| **Merge Conflicts** | Unmerged files |
| **Changes** | Worktree modifications not yet staged |

Each file row shows a status letter: **M** (modified), **A** (added), **D** (deleted), **R** (renamed), **U** (untracked / unmerged).

Click a file to open its Monaco diff view on the right — HEAD on the left, working tree on the right. The diff is read-only; use the file editor to make changes.

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

At the bottom of the changes panel, click **History** to expand the commit log. The log shows the 50 most recent commits (hash, author, date, message). If a file is selected in the diff view, the log filters to commits that touched that file.

## Keyboard Shortcuts

| Action | Shortcut |
|---|---|
| Commit | ⌘↵ / Ctrl↵ |

## Notes

- Push and pull run non-interactively. If your remote requires interactive authentication (e.g. an SSH key without a loaded agent), configure your credential helper or SSH agent outside dbt-ui.
- Merge conflict resolution is not built in — conflicted files appear in the panel, but you must resolve them in the file editor and then stage the result.
- The branch chip and file list update automatically (within ~250ms) when you run git commands in an external terminal, thanks to the `.git/` directory watcher.
