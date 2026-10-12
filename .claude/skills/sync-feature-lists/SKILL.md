---
name: sync-feature-lists
description: Sync dbt-ui's Base vs. Pro feature lists across the README, the in-app Pricing page, and the lamphere-labs product page. Use after adding, renaming, removing, or re-tiering (Base ↔ Pro) any user-facing feature.
---

dbt-ui's feature set is listed in four places across two repos. Nothing enforces
that they agree, so every user-facing feature change must update all of them in
the same session.

## Step 1: Work out what changed

Read the diff (`git diff HEAD --stat`, plus `git log -5 --oneline` if the work is
already committed) and decide, for each user-facing change:

- **New / changed / removed** feature?
- **Tier**: Base (free, in this repo) or Pro (gated via `app/licensing`, logic in
  `dbt-ui-pro`)? A Base feature can gain a Pro extension (e.g. impact analysis is
  Base, column-level impact is Pro) — list those as two separate entries.
- **Headline-worthy?** Only major new areas of the app belong in the website's
  feature grid; small improvements just extend an existing line.

Internal refactors, bug fixes, and dev tooling don't touch feature lists — stop here.

## Step 2: Update each surface

Read each file before editing it, and match the voice and length of its
neighbouring entries.

| # | Surface | File | Format |
|---|---------|------|--------|
| 1 | README feature list | `README.md` → `## Features` | `- **Name** — one sentence`; Pro items end the list and carry `(Pro)` after the name |
| 2 | In-app pricing grid | `frontend/src/routes/Pricing.tsx` → `FEATURES` | `{ label, base, pro }`; Base rows go above the Pro-only rows, `Priority support` stays last |
| 3 | Website pricing cards | `../lamphere-labs/tools/dbt-ui/index.html` → `#pricing` | Base plan `<li>`s; Pro plan `<li>`s (after `Everything in Base`, before `New Pro features as they ship` / `Priority support`). Also the intro `<p>` under the pricing `<h2>`, which names the Pro features |
| 4 | Website feature grid | same file → `#features` `.feature-grid` | Only for headline features. Keep `num` sequential (`01`, `02`, …) and the grid an even count |

Also check in the website file:
- **Gallery** (`.gallery-item`, `data-cap` + `.gallery-cap`) — if the feature has a
  screenshot, add or update its item; Pro items say `(Pro)` in the caption. Image
  sourcing and resizing rules are in `.claude/rules/related-repos.md`.
- **Hero / platform note** — only if the change alters the product's one-line pitch.

Escape `&` as `&amp;` in the HTML. Keep wording consistent across all four
surfaces (same feature name everywhere), shortest in `Pricing.tsx`, longest in
the README.

## Step 3: Verify

- Grep all four surfaces for the feature name and confirm Base/Pro tiering agrees:
  `grep -n -i "<feature>" README.md frontend/src/routes/Pricing.tsx ../lamphere-labs/tools/dbt-ui/index.html`
- Every Pro item on the website is `false` for `base` in `Pricing.tsx` and tagged
  `(Pro)` in the README, and vice versa.
- `cd frontend && npx tsc --noEmit` if `Pricing.tsx` changed.

## Step 4: Report — don't publish

List what changed in each file. Do **not** commit or push in either repo — the
user commits themselves, and pushing `lamphere-labs` to `main` deploys the live
site via Cloudflare Pages. If `../lamphere-labs` isn't checked out, say so and
give the exact HTML to add instead.
