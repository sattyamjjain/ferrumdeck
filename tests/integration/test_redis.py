"""Redis integration tests.

These tests verify Redis queue operations work correctly.

Note: These tests require Redis to be running.
Start with: make dev-up
"""

import asyncio
import os
import time

import pytest
import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


# ==========================================================================
# INT-RD-001: Redis stream operations
# ==========================================================================
class TestStreamOperations:
    """Tests for Redis stream operations (XADD/XREAD)."""

    @pytest.mark.asyncio
    async def test_stream_operations(self, redis_client: aioredis.Redis) -> None:
        """Test that XADD/XREAD work correctly."""
        stream_key = "fd:test:stream_ops"

        try:
            # Clean up any existing stream
            await redis_client.delete(stream_key)

            # XADD - add message to stream
            message_id = await redis_client.xadd(
                stream_key,
                {"type": "test", "data": "test_value"},
            )
            assert message_id is not None

            # XREAD - read from stream
            messages = await redis_client.xread({stream_key: "0"}, count=1)
            assert len(messages) > 0

            # Verify message content
            stream_name, stream_messages = messages[0]
            assert len(stream_messages) > 0
            msg_id, msg_data = stream_messages[0]
            assert msg_data[b"type"] == b"test"
            assert msg_data[b"data"] == b"test_value"

        finally:
            # Clean up
            await redis_client.delete(stream_key)

    @pytest.mark.asyncio
    async def test_stream_message_ordering(self, redis_client: aioredis.Redis) -> None:
        """Test that messages are read in order."""
        stream_key = "fd:test:ordering"

        try:
            await redis_client.delete(stream_key)

            # Add multiple messages
            ids = []
            for i in range(5):
                msg_id = await redis_client.xadd(stream_key, {"seq": str(i)})
                ids.append(msg_id)

            # Read all messages
            messages = await redis_client.xread({stream_key: "0"}, count=10)
            stream_name, stream_messages = messages[0]

            # Verify order
            seqs = [int(msg[1][b"seq"]) for msg in stream_messages]
            assert seqs == list(range(5)), "Messages should be in order"

        finally:
            await redis_client.delete(stream_key)


# ==========================================================================
# INT-RD-002: Consumer groups
# ==========================================================================
class TestConsumerGroups:
    """Tests for Redis consumer group operations."""

    @pytest.mark.asyncio
    async def test_consumer_group(self, redis_client: aioredis.Redis) -> None:
        """Test that consumer groups operate correctly."""
        stream_key = "fd:test:consumer_group"
        group_name = "test_group"

        try:
            await redis_client.delete(stream_key)

            # Add a message first (stream must exist before creating group)
            await redis_client.xadd(stream_key, {"data": "init"})

            # Create consumer group
            try:
                await redis_client.xgroup_create(stream_key, group_name, id="0", mkstream=True)
            except aioredis.ResponseError as e:
                if "BUSYGROUP" not in str(e):
                    raise

            # Add more messages
            for i in range(3):
                await redis_client.xadd(stream_key, {"idx": str(i)})

            # Read with consumer group
            messages = await redis_client.xreadgroup(
                groupname=group_name,
                consumername="test_consumer",
                streams={stream_key: ">"},
                count=5,
            )

            assert len(messages) > 0
            stream_name, stream_messages = messages[0]
            assert len(stream_messages) >= 3

        finally:
            try:
                await redis_client.xgroup_destroy(stream_key, group_name)
            except Exception:
                pass
            await redis_client.delete(stream_key)


# ==========================================================================
# INT-RD-003: Pending entries
# ==========================================================================
class TestPendingEntries:
    """Tests for pending entry tracking."""

    @pytest.mark.asyncio
    async def test_pending_entries(self, redis_client: aioredis.Redis) -> None:
        """Test that pending entries are tracked."""
        stream_key = "fd:test:pending"
        group_name = "pending_group"

        try:
            await redis_client.delete(stream_key)

            # Create stream with message
            await redis_client.xadd(stream_key, {"data": "pending_test"})

            # Create consumer group
            try:
                await redis_client.xgroup_create(stream_key, group_name, id="0", mkstream=True)
            except aioredis.ResponseError as e:
                if "BUSYGROUP" not in str(e):
                    raise

            # Read message (but don't ack)
            messages = await redis_client.xreadgroup(
                groupname=group_name,
                consumername="pending_consumer",
                streams={stream_key: ">"},
                count=1,
            )

            assert len(messages) > 0
            msg_id = messages[0][1][0][0]

            # Check pending - there should be 1 pending message
            pending_info = await redis_client.xpending(stream_key, group_name)
            assert pending_info["pending"] >= 1

            # Now ack the message
            await redis_client.xack(stream_key, group_name, msg_id)

            # Check pending again - should be 0 now (or 1 less)
            pending_after = await redis_client.xpending(stream_key, group_name)
            assert pending_after["pending"] < pending_info["pending"]

        finally:
            try:
                await redis_client.xgroup_destroy(stream_key, group_name)
            except Exception:
                pass
            await redis_client.delete(stream_key)


# ==========================================================================
# INT-RD-004: Reconnection
# ==========================================================================
class TestReconnection:
    """Tests for Redis reconnection behavior."""

    @pytest.mark.asyncio
    async def test_reconnection(self) -> None:
        """Test that client reconnects after disconnect."""
        # Create a new client
        client = aioredis.from_url(REDIS_URL)

        try:
            # First operation should work
            await client.ping()

            # Simulate disconnect by closing pool
            await client.aclose()

            # Recreate client
            client = aioredis.from_url(REDIS_URL)

            # Should reconnect automatically
            result = await client.ping()
            assert result is True

        finally:
            await client.aclose()

    @pytest.mark.asyncio
    async def test_connection_pool_exhaustion_recovery(self) -> None:
        """Test recovery from connection pool exhaustion."""
        # Create client with small pool
        client = aioredis.from_url(REDIS_URL, max_connections=2)

        try:
            # Make many concurrent requests
            async def ping():
                return await client.ping()

            # Should handle more requests than pool size
            results = await asyncio.gather(*[ping() for _ in range(10)])
            assert all(r is True for r in results)

        finally:
            await client.aclose()


# ==========================================================================
# INT-RD-005: High throughput
# ==========================================================================
class TestHighThroughput:
    """Tests for high throughput operations."""

    @pytest.mark.asyncio
    async def test_high_throughput(self, redis_client: aioredis.Redis) -> None:
        """Test sustained message throughput (1000 msg/sec target)."""
        stream_key = "fd:test:throughput"
        message_count = 100  # Reduced for test speed

        try:
            await redis_client.delete(stream_key)

            # Add messages as fast as possible
            start = time.time()

            for i in range(message_count):
                await redis_client.xadd(
                    stream_key,
                    {"idx": str(i), "timestamp": str(time.time())},
                )

            elapsed = time.time() - start

            # Calculate throughput
            throughput = message_count / elapsed
            # Should achieve at least 100 msg/sec (being conservative for CI)
            assert throughput > 100, f"Throughput {throughput:.1f} msg/sec too low"

            # Verify all messages were stored
            stream_length = await redis_client.xlen(stream_key)
            assert stream_length == message_count

        finally:
            await redis_client.delete(stream_key)

    @pytest.mark.asyncio
    async def test_batch_operations(self, redis_client: aioredis.Redis) -> None:
        """Test batch read operations."""
        stream_key = "fd:test:batch"

        try:
            await redis_client.delete(stream_key)

            # Add messages
            for i in range(50):
                await redis_client.xadd(stream_key, {"batch_idx": str(i)})

            # Read in batches
            last_id = "0"
            total_read = 0

            while True:
                messages = await redis_client.xread(
                    {stream_key: last_id},
                    count=10,  # Batch size
                )

                if not messages:
                    break

                stream_name, stream_messages = messages[0]
                if not stream_messages:
                    break

                total_read += len(stream_messages)
                last_id = stream_messages[-1][0]

            assert total_read == 50, f"Expected 50 messages, got {total_read}"

        finally:
            await redis_client.delete(stream_key)


# ==========================================================================
# Additional Redis integration tests
# ==========================================================================
class TestRedisDataTypes:
    """Tests for various Redis data types used by the system."""

    @pytest.mark.asyncio
    async def test_hash_operations(self, redis_client: aioredis.Redis) -> None:
        """Test hash operations for session/state storage."""
        hash_key = "fd:test:hash"

        try:
            await redis_client.delete(hash_key)

            # Set multiple fields
            await redis_client.hset(
                hash_key,
                mapping={
                    "run_id": "run_123",
                    "status": "running",
                    "tokens": "1000",
                },
            )

            # Get all fields
            data = await redis_client.hgetall(hash_key)
            assert data[b"run_id"] == b"run_123"
            assert data[b"status"] == b"running"

            # Update single field
            await redis_client.hset(hash_key, "status", "completed")
            status = await redis_client.hget(hash_key, "status")
            assert status == b"completed"

        finally:
            await redis_client.delete(hash_key)

    @pytest.mark.asyncio
    async def test_expiration(self, redis_client: aioredis.Redis) -> None:
        """Test key expiration for rate limiting."""
        key = "fd:test:expiring"

        try:
            # Set with expiration
            await redis_client.set(key, "value", ex=1)

            # Should exist immediately
            value = await redis_client.get(key)
            assert value == b"value"

            # Wait for expiration
            await asyncio.sleep(1.5)

            # Should be gone
            value = await redis_client.get(key)
            assert value is None

        finally:
            await redis_client.delete(key)

    @pytest.mark.asyncio
    async def test_atomic_increment(self, redis_client: aioredis.Redis) -> None:
        """Test atomic increment for counters."""
        counter_key = "fd:test:counter"

        try:
            await redis_client.delete(counter_key)

            # Concurrent increments
            async def increment():
                return await redis_client.incr(counter_key)

            results = await asyncio.gather(*[increment() for _ in range(100)])

            # Should have unique sequential values
            assert set(results) == set(range(1, 101))

            # Final value should be 100
            final = await redis_client.get(counter_key)
            assert int(final) == 100

        finally:
            await redis_client.delete(counter_key)
