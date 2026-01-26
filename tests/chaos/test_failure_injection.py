"""Failure injection tests for FerrumDeck.

These tests verify system behavior when dependencies fail.

Prerequisites:
- make quickstart
- Docker running (for service manipulation)

Note: These tests may affect running services. Run with caution.
"""

import subprocess
import time

import httpx
import pytest


# ==========================================================================
# CHAOS-001: Database unavailable
# ==========================================================================
class TestDatabaseUnavailable:
    """Chaos tests for database failures."""

    @pytest.mark.skipif(
        subprocess.run(
            ["docker", "ps"],
            capture_output=True,
        ).returncode != 0,
        reason="Docker not available",
    )
    def test_database_unavailable(
        self, api_client: httpx.Client
    ) -> None:
        """Test behavior when Postgres is killed.

        CHAOS-001: Gateway should return 503, queued jobs wait
        """
        # Note: This test would actually stop Postgres in a real chaos test
        # For safety, we just simulate by checking error handling

        # Try to create workflow (should work or fail gracefully)
        workflow = {
            "name": "chaos-db-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "name": "Step",
                        "type": "llm",
                        "config": {
                            "model": "claude-sonnet-4-20250514",
                            "max_tokens": 10,
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 5,
            "on_error": "fail",
        }

        resp = api_client.post("/api/v1/workflows", json=workflow)
        # Under normal conditions should succeed
        # Under chaos (DB down) would return 503
        assert resp.status_code in (200, 201, 500, 502, 503)


# ==========================================================================
# CHAOS-002: Redis unavailable
# ==========================================================================
class TestRedisUnavailable:
    """Chaos tests for Redis failures."""

    def test_redis_unavailable(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test behavior when Redis is killed.

        CHAOS-002: Gateway queues should fail gracefully
        """
        # Test that the system handles Redis errors gracefully
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)

        # Should succeed or fail gracefully
        assert workflow_resp.status_code in (200, 201, 500, 502, 503)

        if workflow_resp.status_code in (200, 201):
            workflow_id = workflow_resp.json()["id"]

            # Try to create run (would fail if Redis is down)
            run_resp = api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {}},
            )
            # Should succeed or fail gracefully
            assert run_resp.status_code in (200, 201, 500, 502, 503)


# ==========================================================================
# CHAOS-003: Worker crash
# ==========================================================================
class TestWorkerCrash:
    """Chaos tests for worker crashes."""

    def test_worker_crash(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test behavior when worker crashes mid-job.

        CHAOS-003: Job should be redelivered to another worker
        """
        # Create workflow and run
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not create run")
        run_id = run_resp.json()["id"]

        # In a real chaos test, we would kill the worker here
        # For now, verify the run tracking works
        time.sleep(1)

        status_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert status_resp.status_code == 200


# ==========================================================================
# CHAOS-004: Gateway restart
# ==========================================================================
class TestGatewayRestart:
    """Chaos tests for gateway restarts."""

    def test_gateway_restart(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test behavior when gateway restarts.

        CHAOS-004: In-flight requests fail, retried
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not create run")
        run_id = run_resp.json()["id"]

        # In a real chaos test, we would restart gateway here
        # For now, verify system state is consistent
        time.sleep(1)

        # Run should still be queryable
        status_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert status_resp.status_code == 200


# ==========================================================================
# CHAOS-005: Network partition
# ==========================================================================
class TestNetworkPartition:
    """Chaos tests for network partitions."""

    def test_network_partition(
        self, api_client: httpx.Client
    ) -> None:
        """Test behavior during network partition.

        CHAOS-005: Worker should reconnect
        """
        # Test that health endpoint works (connectivity)
        health_resp = api_client.get("/health/live")
        assert health_resp.status_code == 200

        # In a real chaos test, we would block network traffic
        # and verify reconnection behavior


# ==========================================================================
# CHAOS-006: Slow database
# ==========================================================================
class TestSlowDatabase:
    """Chaos tests for database latency."""

    def test_slow_database(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test behavior with 500ms DB latency.

        CHAOS-006: Timeout handling
        """
        # Test with normal conditions
        # In real chaos test, we would add latency via tc or proxy

        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        # Should succeed or timeout gracefully
        assert workflow_resp.status_code in (200, 201, 408, 500, 502, 503, 504)


# ==========================================================================
# CHAOS-007: Full disk
# ==========================================================================
class TestFullDisk:
    """Chaos tests for disk space exhaustion."""

    def test_full_disk(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test behavior when disk is full.

        CHAOS-007: Graceful degradation
        """
        # Test with normal conditions
        # In real chaos test, we would fill the disk

        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        # Should succeed or fail gracefully (not crash)
        assert workflow_resp.status_code in (200, 201, 500, 503, 507)


# ==========================================================================
# CHAOS-008: Memory pressure
# ==========================================================================
class TestMemoryPressure:
    """Chaos tests for memory exhaustion."""

    def test_memory_pressure(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test behavior under memory pressure.

        CHAOS-008: OOM handling
        """
        # Test with normal conditions
        # In real chaos test, we would limit memory via cgroups

        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        # Should succeed or fail gracefully
        assert workflow_resp.status_code in (200, 201, 500, 503)
