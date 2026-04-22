---
name: new-event
description: Wire up a new SSE event type end-to-end in dbt-ui — backend bus.publish(), sse.ts listener registration, frontend cache invalidation, and rule file update.
---

<command-instructions>
You are wiring up a new SSE event type in the dbt-ui project end-to-end. This touches the backend event bus, the frontend SSE hook, and the project rules.

## Parse the Arguments

Extract from the user's args:
- **Event type**: the string name (e.g. `model_archived`, `profile_synced`)
- **Topic**: which bus topic — `project:{id}`, `init:{session_id}`, or `terminal:{session_id}`
- **Emitter**: which backend file will publish this event
- **Data payload**: what fields the event carries (if specified)
- **Stale data**: does this event mean cached data is now stale? If yes, which query key?

If any of these are unclear, ask before proceeding.

## Step 1: Add bus.publish() in the Backend

In the emitter file, add the publish call at the right point (after the state change, not before):

```python
await bus.publish(Event(
    topic=f"project:{project_id}",   # or init:{session_id} / terminal:{session_id}
    type="my_new_event",
    data={"key": "value"},           # must be JSON-serializable
))
```

Import `Event` and `bus` if not already imported:
```python
from app.events.bus import bus, Event
```

## Step 2: Register in sse.ts

Open `frontend/src/lib/sse.ts`. In `useProjectEvents`, add the new type to the `types` array:

```typescript
const types = [
  'run_started', 'run_log', 'run_finished', 'run_error',
  'statuses_changed', 'graph_changed', 'files_changed',
  'init_pipeline_started', 'init_step', 'init_pipeline_finished',
  'compile_started', 'compile_finished',
  'docs_generating', 'docs_generated',
  'test_failed',
  'my_new_event',   // ← add here
];
```

For `init:` or `terminal:` topic events, add to `useInitSessionEvents` or `useTerminalEvents` instead.

## Step 3: Handle in the Route Component (if needed)

If the event signals stale data or needs to update UI state, find the relevant route component and add handling in its `useProjectEvents` callback:

```typescript
useProjectEvents(projectId, useCallback((event) => {
  if (event.type === 'my_new_event') {
    qc.invalidateQueries({ queryKey: ['affected-data', projectId] });
    // or update local state
  }
}, [projectId, qc]));
```

Always wrap the handler in `useCallback` with correct deps to avoid infinite reconnect loops.

## Step 4: Update the Event Bus Rule File

Open `.claude/rules/event-bus-and-sse.md`. Add the new event type to the **Complete Event Type List** table:

```markdown
| `my_new_event` | project | `backend/app/api/whatever.py` |
```

Also update the **Frontend Cache Invalidation Map** in `.claude/rules/frontend-patterns.md` if this event invalidates cached data.

## Step 5: Report

Summarize:
- Event type name and topic
- Where `bus.publish()` was added (file + line area)
- That `sse.ts` was updated
- Which component handles it and what it invalidates
- That rule files were updated
</command-instructions>
