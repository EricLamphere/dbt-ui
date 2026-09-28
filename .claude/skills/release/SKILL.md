---
name: release
description: Cut a new dbt-ui desktop release — bump the version everywhere it lives, then run `task release` to build the production app and publish the GitHub release. Use when the user asks to release, ship, or publish a new version of dbt-ui.
argument-hint: "[patch|minor|major|X.Y.Z]  (default: patch)"
---

# Release dbt-ui

Arguments: `$ARGUMENTS` — `patch` (default when empty), `minor`, `major`, or an explicit `X.Y.Z`.

Invoking this skill is the user's go-ahead to publish. Do not commit or push anything — the user always does git themselves.

## 1. Preflight

Run these and stop with a clear message if any fail:

- `gh auth status` — must be logged in (the release is created with `gh`).
- Read the current version from `src-tauri/tauri.conf.json` (`"version"`). This is the source of truth.
- Compute the new version from the argument (semver: `patch` → X.Y.Z+1, `minor` → X.Y+1.0, `major` → X+1.0.0; an explicit version must be valid semver and greater than the current one).
- `gh release view v<new>` must fail (no existing release with that tag).
- `git status --short` — if there are uncommitted changes, list them for the user as a heads-up, but continue.

Tell the user in one line: `Releasing dbt-ui <old> → <new>`.

## 2. Bump the version in every file

The version lives in exactly these places. Change only the dbt-ui version field itself — never a dependency that happens to share the same version string.

| File | What to change |
|------|----------------|
| `src-tauri/tauri.conf.json` | top-level `"version"` |
| `src-tauri/Cargo.toml` | `version` under `[package]` |
| `src-tauri/Cargo.lock` | the `version` line directly under `name = "dbt-ui"` in its `[[package]]` block (other crates can have the same version — don't touch them) |
| `frontend/package.json` | top-level `"version"` |
| `frontend/package-lock.json` | the root `"version"` (line ~3) and `packages[""].version` (line ~9) only |
| `backend/pyproject.toml` | `version` under `[project]` |

Use the Edit tool with enough surrounding context to make each match unique. For the two lockfiles, include the neighboring `name` line in `old_string`.

Then verify — every row should print the new version:

```bash
grep -m1 '"version"' src-tauri/tauri.conf.json
grep -m1 '^version' src-tauri/Cargo.toml
grep -A1 '^name = "dbt-ui"$' src-tauri/Cargo.lock
grep -m1 '"version"' frontend/package.json
sed -n '1,10p' frontend/package-lock.json | grep '"version"'
grep -m1 '^version' backend/pyproject.toml
```

If any file doesn't show the new version, fix it before continuing.

## 3. Build and publish

Run `task release` from the repo root **in the background** (`run_in_background: true`) — the production build takes several minutes, well past the foreground timeout. It:

1. refuses if a release for this version already exists,
2. runs `task package:production` (builds the Pro + Polar-production app and installs it to `/Applications`),
3. creates GitHub release `v<new>` with both `dbt-ui_<new>_aarch64.dmg` and `dbt-ui_aarch64.dmg` (the stable name the lamphere-labs site's Download buttons link to).

Wait for the completion notification; don't poll. If it fails, show the relevant tail of the output, diagnose, and do not retry blindly — a failure after the release was created must not create a second one.

## 4. Verify

```bash
gh release view v<new> --json tagName,url,assets -q '.tagName, .url, (.assets[].name)'
curl -sIL -o /dev/null -w '%{http_code} %{url_effective}\n' \
  https://github.com/EricLamphere/dbt-ui/releases/latest/download/dbt-ui_aarch64.dmg
```

The release should list both dmg files, and the curl should end in `200` with `filename=dbt-ui_aarch64.dmg` in the final URL.

## 5. Report

Tell the user:

- the new version and the release URL,
- that both dmg files are attached and the site's Download buttons now serve `<new>`,
- that the version bump in the six files is **uncommitted** — they should commit and push it. Note that `gh release create` made the `v<new>` tag from the GitHub default branch's current HEAD, so if the release code isn't on that branch yet, they may want to move the tag after pushing.
