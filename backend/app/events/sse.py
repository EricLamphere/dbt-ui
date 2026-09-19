import asyncio
import json
from collections.abc import AsyncIterator, Callable

from sse_starlette.sse import EventSourceResponse

from app.events.bus import Event, bus


async def _event_stream(topic: str) -> AsyncIterator[dict]:
    queue = await bus.subscribe(topic)
    try:
        yield {"event": "ping", "data": "{}"}
        while True:
            try:
                event: Event = await asyncio.wait_for(queue.get(), timeout=15.0)
                yield {"event": event.type, "data": json.dumps(event.data)}
            except TimeoutError:
                yield {"event": "ping", "data": "{}"}
    finally:
        await bus.unsubscribe(topic, queue)


async def _event_stream_with_replay(
    topic: str,
    replay_chunks: list[str],
    already_finished: bool,
    return_code: int | None,
) -> AsyncIterator[dict]:
    """Like _event_stream but first replays buffered PTY output to catch up late subscribers."""
    # Subscribe before yielding anything so we don't miss new events.
    queue = await bus.subscribe(topic)
    try:
        yield {"event": "ping", "data": "{}"}
        # Replay everything the process already wrote.
        for chunk in replay_chunks:
            yield {"event": "init_output", "data": json.dumps({"data": chunk})}
        # If the process already finished, send the terminal event and stop.
        if already_finished:
            yield {
                "event": "init_finished",
                "data": json.dumps({"return_code": return_code}),
            }
            return
        # Otherwise stream live events as normal.
        while True:
            try:
                event: Event = await asyncio.wait_for(queue.get(), timeout=15.0)
                yield {"event": event.type, "data": json.dumps(event.data)}
                if event.type == "init_finished":
                    return
            except TimeoutError:
                yield {"event": "ping", "data": "{}"}
    finally:
        await bus.unsubscribe(topic, queue)


async def _event_stream_with_output_replay(
    topic: str,
    replay_chunks: list[str],
    already_finished: bool,
    return_code: int | None | Callable[[], int | None],
    started_event: str,
    output_event: str,
    finished_event: str,
) -> AsyncIterator[dict]:
    """Generic replay stream: replays buffered output chunks then streams live events.

    Subscribes to the bus BEFORE replaying so any events published during replay
    land in the queue and aren't missed.
    """
    # Subscribe first — any publish that happens while we replay will be queued.
    queue = await bus.subscribe(topic)
    try:
        yield {"event": "ping", "data": "{}"}
        if replay_chunks or already_finished:
            # Synthetic started event so reconnecting subscribers leave 'starting' state
            yield {"event": started_event, "data": "{}"}
        for chunk in replay_chunks:
            yield {"event": output_event, "data": json.dumps({"data": chunk})}
        if already_finished:
            rc_val = return_code() if callable(return_code) else return_code
            yield {"event": finished_event, "data": json.dumps({"return_code": rc_val})}
            return
        # Drain any events that arrived while we were replaying, then stream live.
        # Use a short timeout so we quickly detect if finished was already published.
        finished_seen = False
        while True:
            try:
                event: Event = await asyncio.wait_for(queue.get(), timeout=2.0)
                yield {"event": event.type, "data": json.dumps(event.data)}
                if event.type == finished_event:
                    finished_seen = True
                    return
            except TimeoutError:
                # Check if pip finished in the race window between our snapshot and subscribe.
                # get_return_code() reads the current module-level value, not the snapshot.
                live_rc = return_code() if callable(return_code) else return_code
                if live_rc is not None and not finished_seen:
                    yield {"event": finished_event, "data": json.dumps({"return_code": live_rc})}
                    return
                yield {"event": "ping", "data": "{}"}
    finally:
        await bus.unsubscribe(topic, queue)


def sse_response(topic: str) -> EventSourceResponse:
    return EventSourceResponse(_event_stream(topic))


def sse_response_with_output_replay(
    topic: str,
    replay_chunks: list[str],
    already_finished: bool,
    return_code: int | None | Callable[[], int | None],
    started_event: str,
    output_event: str,
    finished_event: str,
) -> EventSourceResponse:
    return EventSourceResponse(
        _event_stream_with_output_replay(
            topic, replay_chunks, already_finished, return_code,
            started_event, output_event, finished_event,
        )
    )


def sse_response_with_replay(
    topic: str,
    replay_chunks: list[str],
    already_finished: bool,
    return_code: int | None,
) -> EventSourceResponse:
    return EventSourceResponse(
        _event_stream_with_replay(topic, replay_chunks, already_finished, return_code)
    )
