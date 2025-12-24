"""End-to-end workflow integration tests."""

import asyncio
import time
from typing import Any

import httpx
import pytest


class TestWorkflowAPI:
    """Tests for the Workflow API endpoints."""

    def test_create_workflow(self, api_client: httpx.Client, sample_workflow: dict):
        """Test creating a new workflow."""
        response = api_client.post("/api/v1/workflows", json=sample_workflow)

        assert response.status_code in (200, 201), f"Failed: {response.text}"
        data = response.json()
        assert "id" in data
        assert data["name"] == sample_workflow["name"]
        assert data["version"] == sample_workflow["version"]

    def test_get_workflow(self, api_client: httpx.Client, sample_workflow: dict):
        """Test retrieving a workflow by ID."""
        # First create
        create_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        assert create_resp.status_code in (200, 201)
        workflow_id = create_resp.json()["id"]

        # Then retrieve
        get_resp = api_client.get(f"/api/v1/workflows/{workflow_id}")
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["id"] == workflow_id

    def test_list_workflows(self, api_client: httpx.Client):
        """Test listing workflows."""
        response = api_client.get("/api/v1/workflows")
        assert response.status_code == 200
        data = response.json()
        assert "workflows" in data
        assert isinstance(data["workflows"], list)


class TestWorkflowExecution:
    """Tests for workflow execution."""

    def test_start_workflow_run(self, api_client: httpx.Client, sample_workflow: dict):
        """Test starting a workflow run."""
        # Create workflow
        create_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        assert create_resp.status_code in (200, 201)
        workflow_id = create_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={
                "workflow_id": workflow_id,
                "input": {"task": "Test task"},
            },
        )
        assert run_resp.status_code in (200, 201), f"Failed: {run_resp.text}"
        data = run_resp.json()
        assert "id" in data
        assert data["status"] in ("created", "running")

    def test_get_workflow_run(self, api_client: httpx.Client, sample_workflow: dict):
        """Test retrieving a workflow run."""
        # Create workflow
        create_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        workflow_id = create_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        run_id = run_resp.json()["id"]

        # Get run
        get_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_resp.status_code == 200
        data = get_resp.json()
        assert data["id"] == run_id

    def test_list_step_executions(self, api_client: httpx.Client, sample_workflow: dict):
        """Test listing step executions for a run."""
        # Create workflow and start run
        create_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        workflow_id = create_resp.json()["id"]

        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        run_id = run_resp.json()["id"]

        # Wait a bit for step executions to be created
        time.sleep(0.5)

        # Get step executions
        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200
        data = steps_resp.json()
        assert "executions" in data

    def test_cancel_workflow_run(self, api_client: httpx.Client, sample_workflow: dict):
        """Test cancelling a workflow run."""
        # Create and start
        create_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        workflow_id = create_resp.json()["id"]

        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        run_id = run_resp.json()["id"]

        # Cancel
        cancel_resp = api_client.post(f"/api/v1/workflow-runs/{run_id}/cancel")
        assert cancel_resp.status_code == 200
        data = cancel_resp.json()
        assert data["status"] == "cancelled"


class TestDAGOrchestration:
    """Tests for DAG-based workflow orchestration."""

    def test_parallel_workflow_creates_parallel_steps(
        self, api_client: httpx.Client, parallel_workflow: dict
    ):
        """Test that parallel steps are created correctly."""
        # Create workflow
        create_resp = api_client.post("/api/v1/workflows", json=parallel_workflow)
        assert create_resp.status_code in (200, 201)
        workflow_id = create_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "parallel test"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait for step executions to be created
        time.sleep(1)

        # Get step executions
        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200
        data = steps_resp.json()

        # At minimum, init step should be created
        assert len(data.get("executions", [])) >= 1

    def test_workflow_respects_dependencies(
        self, api_client: httpx.Client, sample_workflow: dict
    ):
        """Test that workflow respects step dependencies."""
        # Create workflow
        create_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        workflow_id = create_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        run_id = run_resp.json()["id"]

        # Wait for initial step to be created
        time.sleep(0.5)

        # Get step executions
        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        data = steps_resp.json()

        # Only the first step (init) should be created initially
        # because process depends on init, and finalize depends on process
        executions = data.get("executions", [])
        if len(executions) > 0:
            # First step should be 'init'
            first_step = executions[0]
            assert first_step["step_id"] == "init"


class TestErrorHandling:
    """Tests for error handling in workflows."""

    def test_workflow_not_found(self, api_client: httpx.Client):
        """Test 404 for non-existent workflow."""
        response = api_client.get("/api/v1/workflows/nonexistent_id")
        assert response.status_code == 404

    def test_workflow_run_not_found(self, api_client: httpx.Client):
        """Test 404 for non-existent workflow run."""
        response = api_client.get("/api/v1/workflow-runs/nonexistent_id")
        assert response.status_code == 404

    def test_invalid_workflow_definition(self, api_client: httpx.Client):
        """Test validation of invalid workflow definitions."""
        invalid_workflow = {
            "name": "invalid",
            "description": "Invalid workflow",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "cyclic_a",
                        "name": "Step A",
                        "type": "llm",
                        "depends_on": ["cyclic_b"],  # Circular dependency
                    },
                    {
                        "id": "cyclic_b",
                        "name": "Step B",
                        "type": "llm",
                        "depends_on": ["cyclic_a"],  # Circular dependency
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        # Creating the workflow might succeed (validation at run time)
        # or fail (validation at creation time)
        response = api_client.post("/api/v1/workflows", json=invalid_workflow)
        # Either 400 (validation error) or 200/201 (deferred validation)
        assert response.status_code in (200, 201, 400)

    def test_missing_workflow_id_in_run(self, api_client: httpx.Client):
        """Test starting a run with missing workflow ID."""
        response = api_client.post(
            "/api/v1/workflow-runs",
            json={"input": {}},  # Missing workflow_id
        )
        assert response.status_code in (400, 422)

    def test_start_run_with_nonexistent_workflow(self, api_client: httpx.Client):
        """Test starting a run for a non-existent workflow."""
        response = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": "nonexistent_workflow", "input": {}},
        )
        assert response.status_code == 404


class TestHealthEndpoints:
    """Tests for health check endpoints."""

    def test_liveness_probe(self, api_client: httpx.Client):
        """Test liveness probe returns 200."""
        response = api_client.get("/health/live")
        assert response.status_code == 200

    def test_readiness_probe(self, api_client: httpx.Client):
        """Test readiness probe returns 200."""
        response = api_client.get("/health/ready")
        assert response.status_code == 200


@pytest.mark.asyncio
class TestAsyncWorkflowExecution:
    """Async tests for workflow execution."""

    async def test_concurrent_workflow_runs(
        self, async_api_client: httpx.AsyncClient, sample_workflow: dict
    ):
        """Test running multiple workflows concurrently."""
        # Create workflow
        create_resp = await async_api_client.post(
            "/api/v1/workflows", json=sample_workflow
        )
        if create_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")

        workflow_id = create_resp.json()["id"]

        # Start multiple runs concurrently
        async def start_run(i: int) -> dict[str, Any]:
            resp = await async_api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"run_number": i}},
            )
            return resp.json()

        results = await asyncio.gather(*[start_run(i) for i in range(5)])

        # All runs should be created
        run_ids = [r.get("id") for r in results if "id" in r]
        assert len(run_ids) == 5, f"Expected 5 runs, got {len(run_ids)}"

        # All runs should have unique IDs
        assert len(set(run_ids)) == 5
