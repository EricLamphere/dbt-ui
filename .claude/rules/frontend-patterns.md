# Frontend Patterns for dbt-ui

## API Calls — Always Use api.ts

**Never call `fetch()` directly in a component.** All API calls go through the typed helpers in `frontend/src/lib/api.ts`.

When you need a new endpoint:
1. Add the typed helper to `api.ts` first
2. Then use it in the component

```typescript
// WRONG
const res = await fetch(`/api/projects/${id}/something`);

// CORRECT — add to api.ts, then call
export const api = {
  something: {
    get: (projectId: number) => get<SomethingDto>(`/projects/${projectId}/something`),
  }
};
```

## TypeScript Interfaces Mirror Backend DTOs

Every Pydantic response model in the backend has a corresponding TypeScript interface in `api.ts`. Keep them in sync — field names, optionality, and types must match. Python `str | None` maps to `string | null`.

## TanStack Query Key Conventions

Use consistent array keys so invalidation is predictable:

| Data | Key |
|------|-----|
| Project graph | `['graph', projectId]` |
| Profiles list | `['profiles', projectId]` |
| Env vars | `['env-vars', projectId]` |
| Init steps | `['init-steps', projectId]` |
| Docs status | `['docs-status', projectId]` |
| Global profiles | `['global-profiles']` |
| Settings | `['settings']` |

When adding a new resource, follow the pattern: `[resource-name, scopeId?]`.

## SSE Hooks — Never Poll

**Never use `setInterval` or repeated `useQuery` refetches to detect server-side changes.** Always use the appropriate SSE hook:

- `useProjectEvents(projectId, handler)` — all project events (runs, graph changes, file changes, init pipeline, docs)
- `useTerminalEvents(sessionId, handler)` — bash terminal PTY output
- `useInitSessionEvents(sessionId, handler)` — interactive dbt init PTY output

The hooks live in `frontend/src/lib/sse.ts`. They auto-reconnect on disconnect and clean up on unmount.

## SSE Event → Cache Invalidation Map

When handling SSE events, invalidate the relevant query:

| Event type | Invalidate |
|------------|-----------|
| `statuses_changed` | `['graph', projectId]` |
| `graph_changed` | `['graph', projectId]` |
| `files_changed` | `['graph', projectId]` |
| `compile_finished` | `['graph', projectId]` |
| `docs_generated` | `['docs-status', projectId]` |
| `init_pipeline_finished` | nothing (UI updates from step events) |

When adding a new event type that signals stale data, add an entry here.

## Adding a New SSE Event Type (Frontend Side)

When the backend adds a new event type that the frontend needs to handle:

1. Add the type string to the `types` array in `useProjectEvents` in `frontend/src/lib/sse.ts`
2. Handle it in the `useProjectEvents` callback of the relevant route component
3. Call `qc.invalidateQueries(...)` if it signals stale cached data

If the type is omitted from `sse.ts`, the `EventSource` will silently drop it.

## useCallback on SSE Handlers

SSE handler functions passed to the hooks must be stable references. If the handler is defined inline in a component, wrap it in `useCallback` with the correct dependency array — otherwise the hook's `useEffect` re-runs every render, causing reconnects.

```typescript
// WRONG — new function reference on every render
useProjectEvents(projectId, (event) => {
  if (event.type === 'graph_changed') qc.invalidateQueries(...);
});

// CORRECT — stable reference
useProjectEvents(projectId, useCallback((event) => {
  if (event.type === 'graph_changed') qc.invalidateQueries({ queryKey: ['graph', projectId] });
}, [projectId, qc]));
```

The hooks themselves use `handlerRef` internally (so the ref is always up to date), but the `useEffect` dep array only includes `projectId` — this is intentional.

## DataTable — Always Use the Shared Component

**Never render a `<table>` directly.** All tabular data goes through `DataTable` from `frontend/src/components/DataTable.tsx`. This ensures consistent font, spacing, selection, copy, and keyboard navigation across the entire app.

```tsx
import { DataTable } from '../../../../components/DataTable';

// columns: ColumnDef[] — each entry is { key: string; align?: 'left' | 'right' }
// rows: unknown[][] — each inner array maps positionally to columns

<DataTable
  columns={data.columns.map((c) => ({ key: c }))}
  rows={data.rows}
/>
```

**Default props are correct for almost all cases — do not override them without a good reason:**

| Prop | Default | When to override |
|------|---------|-----------------|
| `fontSize` | `'xs'` | Never — all tables should be `xs` |
| `maxHeight` | none (scrolls with container) | Never — let the parent container control height |
| `className` | — | Only for one-off layout adjustments |

Rules:
- Never pass `fontSize="sm"`, `fontSize="2xs"`, or a custom `maxHeight` — the container provides scroll bounds
- The component already handles: sticky header, row numbers, cell selection, drag-select, copy (Ctrl/Cmd+C), keyboard navigation, select-all (Ctrl/Cmd+A)
- When adding a new panel or tab that shows tabular data, use `DataTable` — don't inline a `<table>` or reach for a third-party grid

## Component File Size

- Target: 200–400 lines per file
- Hard limit: 800 lines
- When a file exceeds ~400 lines, extract sub-components into the same directory (e.g., `components/ProfileCard.tsx` alongside `Environment.tsx`)
- Organize by feature, not by type — keep related components co-located

## Tailwind Class Ordering

Order classes: layout → spacing → sizing → color → typography → state/interaction

```tsx
// layout first, then spacing, then color, then text
<div className="flex items-center gap-2 px-3 py-2 bg-zinc-800 text-sm text-zinc-300 hover:bg-zinc-700">
```

## 204 No Content Responses

The `request<T>()` helper in `api.ts` guards against parsing empty bodies:

```typescript
if (res.status === 204 || res.headers.get('content-length') === '0') {
  return undefined as T;
}
```

DELETE endpoints return 204. Type them as `Promise<void>` and don't try to use the return value.
