# Event Bus and SSE Rules

## The Bus Singleton

```python
from app.events.bus import bus, Event
```

- `bus` in `backend/app/events/bus.py` is a **module-level singleton** — never instantiate `EventBus()`
- The bus is **NOT reset between requests or tests** — leaked subscribers persist for the process lifetime
- Queue capacity: 1024 events per subscriber. Overflow is dropped with a warning log.

## Publishing

```python
await bus.publish(Event(
    topic="project:42",     # "project:{id}" or "init:{session_id}"
    type="my_event",        # must be a known event type (see list below)
    data={"key": "value"},  # must be JSON-serialisable
))
```

Never publish to a topic that no one subscribes to just to "log" something — use structlog for that.

## Subscribing

```python
queue = await bus.subscribe("project:42")
try:
    event = await asyncio.wait_for(queue.get(), timeout=15.0)
    # handle event
finally:
    await bus.unsubscribe("project:42", queue)  # ALWAYS unsubscribe
```

**The SSE helpers in `events/sse.py` handle subscribe/unsubscribe automatically — prefer them for endpoints.**

## SSE Helpers

```python
from app.events.sse import sse_response, sse_response_with_replay

# Standard project stream (15s keepalive ping built in)
return sse_response("project:42")

# PTY session stream (replays buffered output for late subscribers)
return sse_response_with_replay(
    topic=f"init:{session_id}",
    replay_chunks=session.replay_buffer,
    already_finished=session.finished,
    return_code=session.return_code,
)
```

Use `sse_response_with_replay` **only** for PTY init sessions. All other SSE endpoints use `sse_response`.

## Complete Event Type List

| Type | Topic | Emitted by |
|------|-------|------------|
| `run_started` | project | `runner.stream()` automatically |
| `run_log` | project | `runner.stream()` automatically |
| `run_finished` | project | `runner.stream()` automatically |
| `run_error` | project | `runner.stream()` (dbt not found) |
| `statuses_changed` | project | `_persist_results_after_run()` in `api/runs.py` |
| `graph_changed` | project | `watcher/service.py` on manifest.json change |
| `files_changed` | project | `watcher/service.py` on .sql/.yml change |
| `compile_started` | project | `api/models.py` compile endpoint |
| `compile_finished` | project | `api/models.py` compile endpoint |
| `docs_generating` | project | `api/docs.py` |
| `docs_generated` | project | `api/docs.py` (includes `ok`, `generated_at`) |
| `init_pipeline_started` | project | `api/init.py` |
| `init_step` | project | `api/init.py` (includes `name`, `status`) |
| `init_pipeline_finished` | project | `api/init.py` |
| `init_output` | init | `dbt/interactive.py` PTY reader |
| `init_finished` | init | `dbt/interactive.py` PTY reader |

## Adding a New Event Type

1. Choose the right topic (`project:{id}` for almost everything; `init:{session_id}` for PTY only)
2. Add `await bus.publish(Event(...))` at the right call site in the backend
3. In the frontend (`frontend/src/lib/sse.ts`), add handling in `useProjectEvents` callback if needed
4. If the event signals stale cached data, add `qc.invalidateQueries(...)` in the relevant route component

## Frontend Cache Invalidation Pattern

```tsx
useProjectEvents(projectId, useCallback((event) => {
  if (event.type === 'statuses_changed' || event.type === 'graph_changed') {
    qc.invalidateQueries({ queryKey: ['graph', projectId] });
  }
  if (event.type === 'docs_generated') {
    qc.invalidateQueries({ queryKey: ['docs-status', projectId] });
  }
}, [projectId, qc]));
```

**Never poll for freshness when an SSE event signals the change.** Polling bypasses the event system and creates race conditions. If data can become stale, there must be a corresponding SSE event to invalidate the cache.
