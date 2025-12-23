"""Redis queue consumer."""

import json
import logging
from typing import Any

import redis.asyncio as redis

logger = logging.getLogger(__name__)


class RedisQueueConsumer:
    """Consume jobs from Redis streams."""

    def __init__(
        self,
        redis_url: str = "redis://localhost:6379",
        stream_name: str = "fd:queue:stream:steps",
        consumer_group: str = "steps-workers",
        consumer_name: str | None = None,
    ):
        self.redis_url = redis_url
        self.stream_name = stream_name
        self.consumer_group = consumer_group
        self.consumer_name = consumer_name or f"worker-{id(self)}"
        self.client: redis.Redis | None = None

    async def connect(self) -> None:
        """Connect to Redis and ensure consumer group exists."""
        self.client = redis.from_url(self.redis_url)

        # Create consumer group if it doesn't exist
        try:
            await self.client.xgroup_create(
                self.stream_name,
                self.consumer_group,
                id="0",
                mkstream=True,
            )
            logger.info(f"Created consumer group: {self.consumer_group}")
        except redis.ResponseError as e:
            if "BUSYGROUP" not in str(e):
                raise
            logger.debug(f"Consumer group already exists: {self.consumer_group}")

    async def disconnect(self) -> None:
        """Disconnect from Redis."""
        if self.client:
            await self.client.close()
            self.client = None

    async def poll(self, timeout: float = 1.0) -> dict[str, Any] | None:
        """Poll for the next job."""
        if not self.client:
            raise RuntimeError("Not connected to Redis")

        # Read from stream
        result = await self.client.xreadgroup(
            groupname=self.consumer_group,
            consumername=self.consumer_name,
            streams={self.stream_name: ">"},
            count=1,
            block=int(timeout * 1000),
        )

        if not result:
            return None

        # Parse the message
        _stream_name, messages = result[0]
        if not messages:
            return None

        message_id, data = messages[0]

        # Decode the raw data
        raw = {k.decode(): v.decode() for k, v in data.items()}
        msg_id = message_id.decode()

        # The Rust gateway stores the entire message as JSON in "data" field
        if "data" in raw:
            envelope = json.loads(raw["data"])
            payload = envelope.get("payload", {})
            job = {
                "_message_id": msg_id,
                "_envelope_id": envelope.get("id"),
                "run_id": payload.get("run_id"),
                "step_id": payload.get("step_id"),
                "step_type": payload.get("step_type"),
                "input": payload.get("input", {}),
                "tenant_id": payload.get("context", {}).get("tenant_id"),
                "agent_id": payload.get("context", {}).get("agent_id"),
            }
        else:
            # Legacy format - direct fields
            job = raw
            job["_message_id"] = msg_id
            if "input" in job:
                job["input"] = json.loads(job["input"])

        return job

    async def ack(self, message_id: str) -> None:
        """Acknowledge a processed message."""
        if not self.client:
            raise RuntimeError("Not connected to Redis")

        await self.client.xack(self.stream_name, self.consumer_group, message_id)
