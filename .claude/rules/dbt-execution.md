# dbt Execution Rules

## Golden Rule

dbt is invoked **only** via `asyncio.create_subprocess_exec` through the `DbtRunner` singleton.
**Never** import dbt Python libraries (`import dbt`, `from dbt.xxx import ...`). They are not installed.

## DbtRunner Singleton

```python
from app.dbt.runner import runner, RunRequest

req = RunRequest(
    project_id=42,
    project_path=Path("/workspace/my_project"),
    command="run",       # run | build | test | deps | compile | ls | docs
    select="my_model",   # None for all models
    extra=(),            # additional CLI args as tuple
)
async for kind, line in runner.stream(req):
    pass  # bus already publishes run_started / run_log / run_finished automatically
```

- `runner` in `backend/app/dbt/runner.py` is a **module-level singleton** — never instantiate `DbtRunner()` again
- Each `project_id` has its own `asyncio.Lock` — runs are **serialized per project**. Never bypass or work around this lock; dbt is not concurrency-safe
- `runner.stream()` is an async generator — consume it fully or it won't publish `run_finished`
- `runner.build_args(req)` returns the CLI args list without executing, useful for inspection

## Selector Helpers

```python
from app.dbt.select import build_selector, SelectMode

build_selector("my_model", "only")       # → "my_model"
build_selector("my_model", "upstream")   # → "+my_model"
build_selector("my_model", "downstream") # → "my_model+"
build_selector("my_model", "full")       # → "+my_model+"
```

Pass the result as `RunRequest.select`.

## Post-Run Persistence

After any run/build/test command that produces `run_results.json`:
1. Call `_persist_results_after_run(project)` (defined in `api/runs.py`)
2. This reads `run_results.json`, updates `model_statuses` in the DB
3. Publishes `statuses_changed` to the event bus
4. Frontend `useProjectEvents` handler invalidates the React Query graph cache

**Canonical pattern:** `api/runs.py` → `_run_dbt_and_persist()` — copy this for any new run-type endpoint.

## Adding a New dbt Command Endpoint

1. Add a router function in `backend/app/api/runs.py` (or new file for a distinct resource)
2. Use `asyncio.create_task(_run_dbt_and_persist(...))` for fire-and-forget endpoints
3. Never call `asyncio.create_subprocess_exec` directly — always go through `runner.stream(req)`
4. Emit `run_started` before (runner does this) and `run_finished` after (runner does this)
5. Call `_persist_results_after_run` if the command writes `run_results.json`

## Interactive dbt init (PTY) — Separate System

The interactive terminal for `dbt init` is completely separate from `DbtRunner`.

```python
from app.dbt.interactive import manager  # InteractiveInitManager singleton

session_id = await manager.create_pending(platform)
# Pip-install step + PTY launch happens via manager.start_install() / manager.start_pty()
# Output streams via SSE topic "init:{session_id}"
```

- Uses `ptyprocess` for a full pseudoterminal (required for dbt's interactive prompts)
- Replay buffer (`session.replay_buffer`) holds all output in memory for late subscribers
- **No persistence across server restart** — replay buffer is in-process only
- PTY sessions use topic `init:{session_id}`, **not** `project:{id}`
- SSE endpoint: use `sse_response_with_replay(...)` from `events/sse.py`
