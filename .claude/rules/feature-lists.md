# Feature Lists (Base vs. Pro)

## MANDATORY: sync feature lists whenever a user-facing feature changes

After adding, renaming, removing, or moving a user-facing feature between Base
and Pro, run the `sync-feature-lists` skill before marking the work complete.
Skipping it is a bug, the same as skipping a doc update.

The feature set is listed in four places that must agree on wording and tier:

| Surface | Location |
|---------|----------|
| README | `README.md` → `## Features` (Pro items tagged `(Pro)`) |
| In-app pricing | `frontend/src/routes/Pricing.tsx` → `FEATURES` (`base` / `pro` flags) |
| Website pricing | `../lamphere-labs/tools/dbt-ui/index.html` → `#pricing` Base and Pro plan lists, plus the intro paragraph |
| Website feature grid | same file → `#features` (headline features only) |

Bug fixes, refactors, and dev tooling don't need it. Never commit or push
`lamphere-labs` yourself — pushing to `main` deploys the live site.
