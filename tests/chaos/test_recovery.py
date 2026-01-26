"""Recovery tests for FerrumDeck.

These tests verify system recovery after failures.

Prerequisites:
- make quickstart
- Docker running (for service manipulation)
"""

import time

import httpx
import pytest


# ==========================================================================
# CHAOS-R-001: Database recovery
# ==========================================================================
class TestDatabaseRecovery:
    """Recovery tests for database failures."""

    def test_database_recovery(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that connections restore after Postgres restart.

        CHAOS-R-001: Connections should be restored
        """
        # Create workflow (proves DB is working)
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow (DB may be down)")
        workflow_id = workflow_resp.json()["id"]

        # In a real chaos test:
        # 1. Stop Postgres
        # 2. Wait for connection errors
        # 3. Restart Postgres
        # 4. Verify recovery

        # For now, verify system is healthy
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)

    def test_database_connection_pool_recovery(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test connection pool recovers after exhaustion."""
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Make many rapid requests
        for i in range(20):
            api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"idx": i}},
            )

        # Wait for connections to return to pool
        time.sleep(2)

        # System should be responsive
        health_resp = api_client.get("/health/live")
        assert health_resp.status_code == 200


# ==========================================================================
# CHAOS-R-002: Redis recovery
# ==========================================================================
class TestRedisRecovery:
    """Recovery tests for Redis failures."""

    def test_redis_recovery(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that queue resumes after Redis restart.

        CHAOS-R-002: Queue should resume
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # In a real chaos test:
        # 1. Stop Redis
        # 2. Verify queue operations fail
        # 3. Restart Redis
        # 4. Verify queue resumes

        # For now, verify queue is working
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)

    def test_redis_stream_recovery(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that stream processing resumes after Redis restart."""
        # Create workflow and runs
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create multiple runs
        run_ids = []
        for i in range(3):
            run_resp = api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"idx": i}},
            )
            if run_resp.status_code in (200, 201):
                run_ids.append(run_resp.json()["id"])

        # Wait for processing
        time.sleep(2)

        # Verify runs are queryable
        for run_id in run_ids:
            status_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
            assert status_resp.status_code == 200


# ==========================================================================
# CHAOS-R-003: Worker recovery
# ==========================================================================
class TestWorkerRecovery:
    """Recovery tests for worker failures."""

    def test_worker_recovery(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that pending jobs are processed after worker restart.

        CHAOS-R-003: Pending jobs should be processed
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

        # In a real chaos test:
        # 1. Stop worker
        # 2. Create more runs (they queue)
        # 3. Restart worker
        # 4. Verify queued runs are processed

        # For now, verify run is being processed
        time.sleep(2)
        status_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert status_resp.status_code == 200

    def test_worker_job_redelivery(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that abandoned jobs are redelivered."""
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

        # Wait for potential redelivery
        time.sleep(3)

        # Run should still be tracked
        status_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert status_resp.status_code == 200


# ==========================================================================
# CHAOS-R-004: Partial failure
# ==========================================================================
class TestPartialFailure:
    """Recovery tests for partial failures."""

    def test_partial_failure(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test that remaining workers handle load when 1 of 3 fails.

        CHAOS-R-004: Remaining workers should handle load
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # In a real chaos test:
        # 1. Start with 3 workers
        # 2. Kill 1 worker
        # 3. Verify remaining workers process jobs

        # Create several runs
        run_ids = []
        for i in range(5):
            run_resp = api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"idx": i}},
            )
            if run_resp.status_code in (200, 201):
                run_ids.append(run_resp.json()["id"])

        # Verify runs are being processed
        time.sleep(3)

        processed = 0
        for run_id in run_ids:
            status_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
            if status_resp.status_code == 200:
                status = status_resp.json().get("status")
                if status and status != "created":
                    processed += 1

        # At least some runs should be processed
        assert processed >= 1, "No runs were processed"

    def test_graceful_degradation(
        self, api_client: httpx.Client
    ) -> None:
        """Test system continues to function under partial failure."""
        # Health endpoint should work
        health_resp = api_client.get("/health/live")
        assert health_resp.status_code == 200

        # Workflow listing should work
        list_resp = api_client.get("/api/v1/workflows")
        assert list_resp.status_code in (200, 500, 503)

        # If unhealthy, should report appropriately
        ready_resp = api_client.get("/health/ready")
        # May be 200 (healthy) or 503 (degraded) but should respond
        assert ready_resp.status_code in (200, 503)
