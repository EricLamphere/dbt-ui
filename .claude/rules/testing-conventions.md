# Testing Conventions for dbt-ui

## Backend Test Setup

### The `override_db` Fixture (autouse — no declaration needed)

`backend/tests/conftest.py` declares `override_db` as `autouse=True`. Every test automatically gets a **fresh in-memory SQLite database** wired into FastAPI's DI system via `app.dependency_overrides[get_session]`.

```python
# You do NOT need to declare override_db — it's automatic
async def test_something(client):  # just use the fixtures you need
    response = await client.get("/api/projects")
    assert response.status_code == 200
```

If you declare `override_db` again in your test file, you'll get a duplicate-fixture conflict.

### The Bus Singleton Caveat

`bus` (`app.events.bus.bus`) is a **module-level singleton and is NOT reset between tests**. If your test publishes events or subscribes to topics:

```python
async def test_emits_event():
    queue = await bus.subscribe("project:1")
    try:
        await client.post("/api/projects/1/run", json={"model": "foo", "mode": "only"})
        event = await asyncio.wait_for(queue.get(), timeout=2.0)
        assert event.type == "run_started"
    finally:
        await bus.unsubscribe("project:1", queue)  # always unsubscribe
```

Forgetting to unsubscribe leaves the queue in the bus for the rest of the test session.

### Mocking DbtRunner

Mock `runner.stream` directly — do not patch `asyncio.create_subprocess_exec`:

```python
from unittest.mock import patch, AsyncMock
from app.dbt.runner import runner

async def _fake_stream(req):
    yield ("stdout", "1 of 1 OK")

with patch.object(runner, "stream", side_effect=_fake_stream):
    response = await client.post("/api/projects/1/run", ...)
```

## Running Tests

```bash
# Full suite with coverage (from project root)
task test:backend

# Single file, verbose
cd backend && .venv/bin/pytest tests/test_api_runs.py -xvs

# Specific test
cd backend && .venv/bin/pytest tests/test_api_runs.py::test_run_model -xvs

# Coverage report
cd backend && .venv/bin/pytest --cov=app --cov-report=term-missing -q
```

## Frontend Testing

There is **no Jest or Vitest suite** yet. The frontend "test" is:

```bash
task test:frontend  # runs: npm run build (tsc + vite build)
```

This catches TypeScript type errors and import failures. If adding unit tests, use **Vitest** (it's in the Vite ecosystem and requires no extra config).

For type checking only (faster):
```bash
cd frontend && npx tsc --noEmit
```

## Coverage Baseline

- Current: ~57% (as of 2026-04-14)
- Target: 80%
- Priority areas not yet well-covered: `api/runs.py`, `watcher/service.py`
- Do not write tests purely to inflate the number — test real behavior and error paths
