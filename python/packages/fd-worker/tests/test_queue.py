"""Tests for Redis queue consumer.

Test IDs: PY-QUE-001 to PY-QUE-010
"""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from fd_worker.queue import RedisQueueConsumer


class TestRedisQueueConsumer:
    """Tests for RedisQueueConsumer class."""

    @pytest.fixture
    def consumer(self):
        """Create a queue consumer instance."""
        return RedisQueueConsumer(
            redis_url="redis://localhost:6379",
            stream_name="fd:queue:stream:steps",
            consumer_group="test-workers",
            consumer_name="test-worker-1",
        )

    # PY-QUE-001: Connection established
    @pytest.mark.asyncio
    async def test_connect_creates_consumer_group(self, consumer):
        """Test that connect creates the consumer group."""
        mock_client = MagicMock()
        mock_client.xgroup_create = AsyncMock()
        mock_client.close = AsyncMock()

        with patch("redis.asyncio.from_url", return_value=mock_client):
            await consumer.connect()

            mock_client.xgroup_create.assert_called_once_with(
                "fd:queue:stream:steps",
                "test-workers",
                id="0",
                mkstream=True,
            )

    @pytest.mark.asyncio
    async def test_connect_handles_existing_group(self, consumer):
        """Test that connect handles existing consumer group gracefully."""
        mock_client = MagicMock()

        # Simulate BUSYGROUP error (group already exists)
        class ResponseError(Exception):
            pass

        with patch("redis.asyncio.ResponseError", ResponseError):
            mock_client.xgroup_create = AsyncMock(
                side_effect=ResponseError("BUSYGROUP Consumer Group name already exists")
            )
            mock_client.close = AsyncMock()

            with patch("redis.asyncio.from_url", return_value=mock_client):
                # Should not raise
                await consumer.connect()

    @pytest.mark.asyncio
    async def test_connect_raises_other_errors(self, consumer):
        """Test that connect raises non-BUSYGROUP errors."""
        mock_client = MagicMock()

        class ResponseError(Exception):
            pass

        with patch("redis.asyncio.ResponseError", ResponseError):
            mock_client.xgroup_create = AsyncMock(side_effect=ResponseError("Some other error"))

            with (
                patch("redis.asyncio.from_url", return_value=mock_client),
                pytest.raises(ResponseError, match="Some other error"),
            ):
                await consumer.connect()

    # PY-QUE-002: Poll returns job when available
    @pytest.mark.asyncio
    async def test_poll_returns_job(self, consumer):
        """Test that poll returns job when available."""
        # Simulate Redis stream response
        mock_message = [
            (
                b"fd:queue:stream:steps",
                [
                    (
                        b"1234567890-0",
                        {
                            b"data": json.dumps(
                                {
                                    "id": "envelope_123",
                                    "payload": {
                                        "run_id": "run_abc",
                                        "step_id": "stp_xyz",
                                        "step_type": "llm",
                                        "input": {"model": "claude-3"},
                                        "context": {
                                            "tenant_id": "tenant_1",
                                            "agent_id": "agt_1",
                                        },
                                    },
                                }
                            ).encode()
                        },
                    )
                ],
            )
        ]

        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=mock_message)
        consumer._client = mock_client

        job = await consumer.poll(timeout=1.0)

        assert job is not None
        assert job["run_id"] == "run_abc"
        assert job["step_id"] == "stp_xyz"
        assert job["step_type"] == "llm"
        assert job["_message_id"] == "1234567890-0"
        assert job["_envelope_id"] == "envelope_123"
        assert job["tenant_id"] == "tenant_1"

    # PY-QUE-003: Poll timeout returns None
    @pytest.mark.asyncio
    async def test_poll_timeout_returns_none(self, consumer):
        """Test that poll returns None on timeout."""
        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=[])
        consumer._client = mock_client

        job = await consumer.poll(timeout=0.1)

        assert job is None

    @pytest.mark.asyncio
    async def test_poll_empty_messages_returns_none(self, consumer):
        """Test that poll returns None when no messages."""
        mock_response = [(b"fd:queue:stream:steps", [])]

        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=mock_response)
        consumer._client = mock_client

        job = await consumer.poll(timeout=0.1)

        assert job is None

    # PY-QUE-004: Ack removes message
    @pytest.mark.asyncio
    async def test_ack_removes_message(self, consumer):
        """Test that ack calls xack on Redis."""
        mock_client = MagicMock()
        mock_client.xack = AsyncMock()
        consumer._client = mock_client

        await consumer.ack("1234567890-0")

        mock_client.xack.assert_called_once_with(
            "fd:queue:stream:steps",
            "test-workers",
            "1234567890-0",
        )

    # PY-QUE-005: Disconnect closes connection
    @pytest.mark.asyncio
    async def test_disconnect_closes_client(self, consumer):
        """Test that disconnect closes the Redis client."""
        mock_client = MagicMock()
        mock_client.close = AsyncMock()
        consumer._client = mock_client

        await consumer.disconnect()

        mock_client.close.assert_called_once()
        assert consumer._client is None

    @pytest.mark.asyncio
    async def test_disconnect_when_not_connected(self, consumer):
        """Test that disconnect is safe when not connected."""
        consumer._client = None
        # Should not raise
        await consumer.disconnect()

    # Error handling tests
    @pytest.mark.asyncio
    async def test_poll_raises_when_not_connected(self, consumer):
        """Test that poll raises when not connected."""
        consumer._client = None

        with pytest.raises(RuntimeError, match="Not connected"):
            await consumer.poll()

    @pytest.mark.asyncio
    async def test_ack_raises_when_not_connected(self, consumer):
        """Test that ack raises when not connected."""
        consumer._client = None

        with pytest.raises(RuntimeError, match="Not connected"):
            await consumer.ack("some-id")

    # Legacy format handling
    @pytest.mark.asyncio
    async def test_poll_handles_legacy_format(self, consumer):
        """Test that poll handles legacy message format."""
        # Legacy format has direct fields instead of nested envelope
        mock_message = [
            (
                b"fd:queue:stream:steps",
                [
                    (
                        b"1234567890-0",
                        {
                            b"run_id": b"run_legacy",
                            b"step_id": b"stp_legacy",
                            b"step_type": b"tool",
                            b"input": b'{"tool_name": "test"}',
                        },
                    )
                ],
            )
        ]

        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=mock_message)
        consumer._client = mock_client

        job = await consumer.poll()

        assert job is not None
        assert job["run_id"] == "run_legacy"
        assert job["step_id"] == "stp_legacy"
        assert job["input"] == {"tool_name": "test"}


class TestRedisQueueConsumerConfiguration:
    """Tests for queue consumer configuration."""

    def test_default_consumer_name(self):
        """Test that default consumer name is generated."""
        consumer = RedisQueueConsumer(
            redis_url="redis://localhost:6379",
            stream_name="test-stream",
            consumer_group="test-group",
        )
        assert consumer.consumer_name.startswith("worker-")

    def test_custom_consumer_name(self):
        """Test that custom consumer name is used."""
        consumer = RedisQueueConsumer(
            redis_url="redis://localhost:6379",
            stream_name="test-stream",
            consumer_group="test-group",
            consumer_name="my-worker",
        )
        assert consumer.consumer_name == "my-worker"

    def test_default_stream_name(self):
        """Test default stream name."""
        consumer = RedisQueueConsumer()
        assert consumer.stream_name == "fd:queue:stream:steps"

    def test_default_consumer_group(self):
        """Test default consumer group."""
        consumer = RedisQueueConsumer()
        assert consumer.consumer_group == "steps-workers"

    def test_custom_redis_url(self):
        """Test custom Redis URL."""
        consumer = RedisQueueConsumer(redis_url="redis://custom-host:6380")
        assert consumer.redis_url == "redis://custom-host:6380"


class TestPollParameters:
    """Tests for poll method parameters."""

    @pytest.mark.asyncio
    async def test_poll_timeout_converted_to_ms(self):
        """Test that timeout is converted to milliseconds."""
        consumer = RedisQueueConsumer()
        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=[])
        consumer._client = mock_client

        await consumer.poll(timeout=2.5)

        call_kwargs = mock_client.xreadgroup.call_args.kwargs
        assert call_kwargs["block"] == 2500  # 2.5 seconds = 2500 ms

    @pytest.mark.asyncio
    async def test_poll_default_timeout(self):
        """Test default poll timeout."""
        consumer = RedisQueueConsumer()
        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=[])
        consumer._client = mock_client

        await consumer.poll()  # Default timeout is 1.0

        call_kwargs = mock_client.xreadgroup.call_args.kwargs
        assert call_kwargs["block"] == 1000

    @pytest.mark.asyncio
    async def test_poll_count_is_one(self):
        """Test that poll requests only one message."""
        consumer = RedisQueueConsumer()
        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=[])
        consumer._client = mock_client

        await consumer.poll()

        call_kwargs = mock_client.xreadgroup.call_args.kwargs
        assert call_kwargs["count"] == 1

    @pytest.mark.asyncio
    async def test_poll_uses_new_messages_only(self):
        """Test that poll uses '>' to read only new messages."""
        consumer = RedisQueueConsumer()
        mock_client = MagicMock()
        mock_client.xreadgroup = AsyncMock(return_value=[])
        consumer._client = mock_client

        await consumer.poll()

        call_kwargs = mock_client.xreadgroup.call_args.kwargs
        assert call_kwargs["streams"] == {consumer.stream_name: ">"}
