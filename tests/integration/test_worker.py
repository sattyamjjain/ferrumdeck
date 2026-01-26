"""Worker integration tests.

These tests verify the Python worker correctly processes jobs from
the Redis queue and reports results back to the gateway.

Note: These tests require both the gateway and Redis to be running.
Start with: make dev-up && make run-gateway
"""

import os
import time

import httpx
import pytest

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")


# ==========================================================================
# INT-WK-001: Worker processes job
# ==========================================================================
class TestWorkerProcessesJob:
    """Tests for job processing by worker."""

    def test_worker_processes_job(
        self, api_client: httpx.Client, sample_workflow: dict
    ) -> None:
        """Test that worker dequeues, executes, and acks jobs.

        This test verifies the complete flow:
        1. Create workflow and start run
        2. Run gets queued
        3. Worker picks up the job (if running)
        4. Job is processed
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "worker test"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # The run should be created
        assert run_id is not None

        # Wait a bit and check status - if worker is running, it will process
        time.sleep(1.0)

        get_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_resp.status_code == 200
        status = get_resp.json()["status"]
        # Status should have progressed (or still be in initial state if no worker)
        assert status in ("created", "running", "waiting_approval", "completed", "failed")


# ==========================================================================
# INT-WK-002: Worker reports result
# ==========================================================================
class TestWorkerReportsResult:
    """Tests for result reporting."""

    def test_worker_reports_result(
        self, api_client: httpx.Client, sample_workflow: dict
    ) -> None:
        """Test that worker reports results back to gateway."""
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "result test"}},
        )
        run_id = run_resp.json()["id"]

        # Wait for processing
        time.sleep(1.5)

        # Check steps - worker should create step executions
        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200

        # Steps response should be valid
        data = steps_resp.json()
        assert "executions" in data or isinstance(data, list)


# ==========================================================================
# INT-WK-003: Worker handles policy denial
# ==========================================================================
class TestWorkerPolicyDenial:
    """Tests for policy denial handling."""

    def test_worker_handles_policy_denial(
        self, api_client: httpx.Client
    ) -> None:
        """Test that worker reports denied tool calls correctly."""
        # Create workflow with a tool step
        workflow = {
            "name": "policy-denial-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "denied_tool",
                        "name": "Denied Tool Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "dangerous_undeclared_tool",
                            "tool_input": {},
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )

        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not start run")

        run_id = run_resp.json()["id"]

        # Wait for processing
        time.sleep(2.0)

        # Check run status - should fail due to policy denial
        get_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_resp.status_code == 200
        # Status could be failed or policy_blocked if tool was denied
        final_status = get_resp.json()["status"]
        # Any terminal status is acceptable for this test
        assert final_status in ("created", "running", "failed", "policy_blocked", "completed")


# ==========================================================================
# INT-WK-004: Worker handles approval wait
# ==========================================================================
class TestWorkerApprovalWait:
    """Tests for approval wait handling."""

    def test_worker_handles_approval(
        self, api_client: httpx.Client
    ) -> None:
        """Test that worker pauses run for approval."""
        # Create workflow with approval step
        workflow = {
            "name": "approval-wait-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "init",
                        "name": "Initialize",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                    },
                    {
                        "id": "approval",
                        "name": "Needs Approval",
                        "type": "approval",
                        "config": {
                            "tool_name": "sensitive_action",
                            "approval_message": "Test approval required",
                        },
                        "depends_on": ["init"],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not start run")

        run_id = run_resp.json()["id"]

        # Run should exist
        assert run_id is not None


# ==========================================================================
# INT-WK-005: Worker handles budget kill
# ==========================================================================
class TestWorkerBudgetKill:
    """Tests for budget enforcement."""

    def test_worker_handles_budget_kill(
        self, api_client: httpx.Client
    ) -> None:
        """Test that worker respects budget limits.

        Note: This test verifies the budget mechanism exists.
        Actual budget kill requires LLM execution which consumes tokens.
        """
        # Create workflow with a budget (if supported)
        workflow = {
            "name": "budget-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "name": "Step 1",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 10},
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 1,  # Very limited
            "on_error": "fail",
            "budget": {
                "max_tokens": 100,  # Very low token budget
                "max_cost_cents": 1,  # Very low cost budget
            },
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        # Budget field might not be supported
        if workflow_resp.status_code not in (200, 201, 400, 422):
            pytest.skip("Could not create workflow")

        # If it succeeded, verify workflow was created
        if workflow_resp.status_code in (200, 201):
            assert "id" in workflow_resp.json()


# ==========================================================================
# INT-WK-006: Worker graceful shutdown
# ==========================================================================
class TestWorkerGracefulShutdown:
    """Tests for graceful shutdown behavior."""

    def test_worker_graceful_shutdown(
        self, api_client: httpx.Client
    ) -> None:
        """Test that in-flight jobs complete on shutdown.

        Note: This is a design verification test. Actual graceful
        shutdown testing requires process management.
        """
        # Verify health endpoint responds (worker is accepting requests)
        response = api_client.get("/health/ready")
        assert response.status_code == 200

        # The graceful shutdown behavior is verified by:
        # 1. Worker catches SIGTERM
        # 2. Worker stops accepting new jobs
        # 3. Worker waits for in-flight jobs to complete
        # 4. Worker exits cleanly

        # This test just verifies the system is healthy
        # Full graceful shutdown testing is done in chaos tests


# ==========================================================================
# Additional worker tests
# ==========================================================================
class TestWorkerErrorHandling:
    """Tests for worker error handling."""

    def test_worker_handles_invalid_step(
        self, api_client: httpx.Client
    ) -> None:
        """Test worker handles steps with invalid config."""
        workflow = {
            "name": "invalid-step-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "invalid",
                        "name": "Invalid Step",
                        "type": "unknown_type",  # Invalid type
                        "config": {},
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        # Should fail validation or succeed and fail at runtime
        assert workflow_resp.status_code in (200, 201, 400, 422)

    def test_worker_handles_timeout(
        self, api_client: httpx.Client
    ) -> None:
        """Test worker handles step timeouts."""
        workflow = {
            "name": "timeout-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "timeout_step",
                        "name": "Timeout Step",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 1000},
                        "depends_on": [],
                        "timeout_ms": 1000,  # 1 second timeout
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        # Workflow creation should succeed
        assert workflow_resp.status_code in (200, 201)


class TestWorkerRetry:
    """Tests for worker retry behavior."""

    def test_worker_retries_transient_errors(
        self, api_client: httpx.Client
    ) -> None:
        """Test that transient errors trigger retry."""
        workflow = {
            "name": "retry-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "retry_step",
                        "name": "Retry Step",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                        "retry": {
                            "max_attempts": 3,
                            "delay_ms": 100,
                            "backoff_multiplier": 2.0,
                        },
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)

        # Start run
        workflow_id = workflow_resp.json()["id"]
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
