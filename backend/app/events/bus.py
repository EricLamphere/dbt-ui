import asyncio
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from app.logging_setup import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class Event:
    topic: str
    type: str
    data: dict[str, Any] = field(default_factory=dict)


class EventBus:
    """In-process pub/sub for SSE. Each subscribe() returns a fresh queue per subscriber."""

    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[Event]]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def subscribe(self, topic: str) -> asyncio.Queue[Event]:
        queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=1024)
        async with self._lock:
            self._subscribers[topic].add(queue)
        return queue

    async def unsubscribe(self, topic: str, queue: asyncio.Queue[Event]) -> None:
        async with self._lock:
            self._subscribers[topic].discard(queue)

    async def publish(self, event: Event) -> None:
        async with self._lock:
            queues = list(self._subscribers.get(event.topic, ()))
        for q in queues:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                log.warning("event_bus_queue_full", topic=event.topic, type=event.type)


bus = EventBus()
