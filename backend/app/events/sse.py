import asyncio
import json
from collections.abc import AsyncIterator

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
            except asyncio.TimeoutError:
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
            except asyncio.TimeoutError:
                yield {"event": "ping", "data": "{}"}
    finally:
        await bus.unsubscribe(topic, queue)


def sse_response(topic: str) -> EventSourceResponse:
    return EventSourceResponse(_event_stream(topic))


def sse_response_with_replay(
    topic: str,
    replay_chunks: list[str],
    already_finished: bool,
    return_code: int | None,
) -> EventSourceResponse:
    return EventSourceResponse(
        _event_stream_with_replay(topic, replay_chunks, already_finished, return_code)
    )
