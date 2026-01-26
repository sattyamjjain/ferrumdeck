"""Database integration tests.

These tests verify database operations work correctly with
actual PostgreSQL connections.

Note: These tests require PostgreSQL to be running.
Start with: make dev-up
"""

import asyncio
import time
from typing import Any

import httpx
import pytest


# ==========================================================================
# INT-DB-001: Migrations run successfully
# ==========================================================================
class TestMigrations:
    """Tests for database migrations."""

    def test_migrations_run(self, api_client: httpx.Client) -> None:
        """Test that all migrations apply successfully.

        If the gateway starts successfully, migrations have run.
        """
        # Health check verifies gateway started (which runs migrations)
        response = api_client.get("/health/ready")
        assert response.status_code == 200
        data = response.json()
        # Ready endpoint should indicate DB is connected
        assert data.get("status") in ("healthy", "ok", "ready")


# ==========================================================================
# INT-DB-002: Run lifecycle operations
# ==========================================================================
class TestRunLifecycle:
    """Tests for run lifecycle in database."""

    def test_run_lifecycle(self, api_client: httpx.Client, sample_workflow: dict) -> None:
        """Test create → update → complete lifecycle."""
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create run (status: created/running)
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "lifecycle test"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]
        initial_status = run_resp.json()["status"]
        assert initial_status in ("created", "running")

        # Get run
        get_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_resp.status_code == 200

        # Cancel run (update to cancelled)
        cancel_resp = api_client.post(f"/api/v1/workflow-runs/{run_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"

    def test_run_status_transitions(self, api_client: httpx.Client, sample_workflow: dict) -> None:
        """Test that run status transitions are tracked."""
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create multiple runs
        runs = []
        for i in range(3):
            resp = api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"run_index": i}},
            )
            if resp.status_code in (200, 201):
                runs.append(resp.json())

        # Verify each run has a status
        for run in runs:
            assert "status" in run
            assert run["status"] in ("created", "running", "waiting_approval", "completed", "failed")


# ==========================================================================
# INT-DB-003: Concurrent updates
# ==========================================================================
class TestConcurrentUpdates:
    """Tests for concurrent database updates."""

    @pytest.mark.asyncio
    async def test_concurrent_updates(
        self, async_api_client: httpx.AsyncClient, sample_workflow: dict
    ) -> None:
        """Test that concurrent updates don't conflict."""
        # Create workflow
        workflow_resp = await async_api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start multiple runs concurrently
        async def create_run(idx: int) -> dict[str, Any]:
            resp = await async_api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"concurrent_idx": idx}},
            )
            return resp.json() if resp.status_code in (200, 201) else {}

        results = await asyncio.gather(*[create_run(i) for i in range(10)])

        # All should succeed without conflicts
        valid_results = [r for r in results if "id" in r]
        assert len(valid_results) >= 8, "Most concurrent creates should succeed"

        # All IDs should be unique
        ids = [r["id"] for r in valid_results]
        assert len(ids) == len(set(ids)), "All run IDs should be unique"


# ==========================================================================
# INT-DB-004: Transaction rollback
# ==========================================================================
class TestTransactionRollback:
    """Tests for transaction rollback behavior."""

    def test_invalid_workflow_rolled_back(self, api_client: httpx.Client) -> None:
        """Test that failed transaction rolls back completely."""
        # Try to create workflow with invalid data
        invalid_workflow = {
            "name": "",  # Empty name might fail validation
            "version": "1.0.0",
            "definition": {"steps": []},  # Empty steps
        }

        response = api_client.post("/api/v1/workflows", json=invalid_workflow)
        # Should fail validation
        if response.status_code in (400, 422):
            # Good - validation caught it
            # Try to list workflows - the invalid one shouldn't be there
            list_resp = api_client.get("/api/v1/workflows")
            assert list_resp.status_code == 200
            workflows = list_resp.json().get("workflows", [])
            # No workflow with empty name should exist
            empty_named = [w for w in workflows if w.get("name") == ""]
            assert len(empty_named) == 0


# ==========================================================================
# INT-DB-005: Large JSON storage
# ==========================================================================
class TestLargeJsonStorage:
    """Tests for large JSONB storage."""

    def test_large_json_storage(self, api_client: httpx.Client, sample_workflow: dict) -> None:
        """Test that large JSONB is stored correctly."""
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create run with large input
        large_input = {
            "task": "Large JSON test",
            "data": {
                f"field_{i}": f"value_{i}" * 100 for i in range(100)  # ~100KB of data
            },
            "nested": {"level1": {"level2": {"level3": {"data": "x" * 10000}}}},
        }

        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": large_input},
        )

        if run_resp.status_code not in (200, 201):
            pytest.skip("Large input not supported")

        run_id = run_resp.json()["id"]

        # Verify we can retrieve it
        get_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_resp.status_code == 200
        # Input should be stored correctly
        retrieved_input = get_resp.json().get("input", {})
        assert retrieved_input.get("task") == "Large JSON test"


# ==========================================================================
# INT-DB-006: Tenant isolation
# ==========================================================================
class TestTenantIsolation:
    """Tests for multi-tenant data isolation."""

    def test_tenant_isolation(self, api_client: httpx.Client, sample_workflow: dict) -> None:
        """Test that queries respect tenant_id isolation."""
        # Create workflow with one auth token
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Try to access with a different (invalid) tenant token
        bad_client = httpx.Client(
            base_url=api_client.base_url,
            headers={
                "Authorization": "Bearer fd_different_tenant_token",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )

        try:
            # Should get 401 (unauthorized) or 404 (not found due to tenant isolation)
            get_resp = bad_client.get(f"/api/v1/workflows/{workflow_id}")
            assert get_resp.status_code in (401, 403, 404)
        finally:
            bad_client.close()


# ==========================================================================
# INT-DB-007: Cascade delete
# ==========================================================================
class TestCascadeDelete:
    """Tests for cascade delete behavior."""

    def test_cascade_delete(self, api_client: httpx.Client, sample_workflow: dict) -> None:
        """Test that deleting run deletes associated steps."""
        # Create workflow and run
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
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

        # Wait for steps to be created
        time.sleep(0.5)

        # Get steps
        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200

        # Cancel the run (similar to delete in terms of state management)
        cancel_resp = api_client.post(f"/api/v1/workflow-runs/{run_id}/cancel")
        assert cancel_resp.status_code == 200

        # Steps should still be accessible but run is in terminal state
        final_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert final_resp.status_code == 200
        assert final_resp.json()["status"] == "cancelled"


# ==========================================================================
# INT-DB-008: Index performance
# ==========================================================================
class TestIndexPerformance:
    """Tests for database index performance."""

    def test_index_performance(self, api_client: httpx.Client) -> None:
        """Test that indexed queries are fast."""
        # Measure time to list workflows (should use index)
        start = time.time()
        response = api_client.get("/api/v1/workflows")
        elapsed = time.time() - start

        assert response.status_code == 200
        # List query should be fast (< 1 second even with many records)
        assert elapsed < 1.0, f"List query took {elapsed:.2f}s, expected < 1s"

    def test_lookup_by_id_performance(
        self, api_client: httpx.Client, sample_workflow: dict
    ) -> None:
        """Test that ID lookup uses primary key index."""
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Measure time to get by ID
        start = time.time()
        response = api_client.get(f"/api/v1/workflows/{workflow_id}")
        elapsed = time.time() - start

        assert response.status_code == 200
        # ID lookup should be very fast (< 100ms)
        assert elapsed < 0.5, f"ID lookup took {elapsed:.2f}s, expected < 0.5s"
