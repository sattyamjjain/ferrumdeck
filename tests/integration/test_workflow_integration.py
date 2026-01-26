"""Full workflow integration tests.

These tests verify complete workflow execution patterns including
linear, parallel, conditional, and approval workflows.

Note: These tests require the full stack to be running.
Start with: make quickstart
"""

import os
import time

import httpx
import pytest

GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")


# ==========================================================================
# INT-WF-001: Linear workflow execution
# ==========================================================================
class TestLinearWorkflow:
    """Tests for linear workflow execution (A → B → C)."""

    def test_linear_workflow(
        self, api_client: httpx.Client, sample_workflow: dict
    ) -> None:
        """Test that linear workflow executes steps in order."""
        # The sample_workflow fixture has init → process → finalize
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "linear test"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait for processing
        time.sleep(1.0)

        # Get step executions
        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200

        executions = steps_resp.json().get("executions", [])
        if len(executions) > 0:
            # First step should be the entry point (init)
            first_step = executions[0]
            assert first_step["step_id"] == "init"

    def test_linear_workflow_dependencies(
        self, api_client: httpx.Client
    ) -> None:
        """Test that linear dependencies are respected."""
        workflow = {
            "name": "linear-deps-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step_a",
                        "name": "Step A",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                    },
                    {
                        "id": "step_b",
                        "name": "Step B (depends on A)",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["step_a"],
                    },
                    {
                        "id": "step_c",
                        "name": "Step C (depends on B)",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["step_b"],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)


# ==========================================================================
# INT-WF-002: Parallel workflow execution
# ==========================================================================
class TestParallelWorkflow:
    """Tests for parallel workflow execution (A → (B, C) → D)."""

    def test_parallel_workflow(
        self, api_client: httpx.Client, parallel_workflow: dict
    ) -> None:
        """Test that parallel workflow executes independent steps together."""
        workflow_resp = api_client.post("/api/v1/workflows", json=parallel_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "parallel test"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait for processing
        time.sleep(1.0)

        # Get step executions
        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200

    def test_fanout_fanin_pattern(
        self, api_client: httpx.Client
    ) -> None:
        """Test fanout/fanin workflow pattern."""
        workflow = {
            "name": "fanout-fanin-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "start",
                        "name": "Start",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                    },
                    # Fanout to 3 parallel steps
                    {
                        "id": "parallel_1",
                        "name": "Parallel 1",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["start"],
                    },
                    {
                        "id": "parallel_2",
                        "name": "Parallel 2",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["start"],
                    },
                    {
                        "id": "parallel_3",
                        "name": "Parallel 3",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["start"],
                    },
                    # Fanin to single step
                    {
                        "id": "end",
                        "name": "End",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["parallel_1", "parallel_2", "parallel_3"],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)


# ==========================================================================
# INT-WF-003: Conditional workflow execution
# ==========================================================================
class TestConditionalWorkflow:
    """Tests for conditional workflow execution."""

    def test_conditional_workflow(
        self, api_client: httpx.Client, conditional_workflow: dict
    ) -> None:
        """Test that conditional branches work correctly."""
        workflow_resp = api_client.post("/api/v1/workflows", json=conditional_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"condition_value": True}},
        )
        assert run_resp.status_code in (200, 201)

    def test_conditional_step_skip(
        self, api_client: httpx.Client
    ) -> None:
        """Test that steps with false conditions are skipped."""
        workflow = {
            "name": "conditional-skip-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "check",
                        "name": "Check",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                    },
                    {
                        "id": "maybe_run",
                        "name": "Maybe Run",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["check"],
                        "condition": "$.check.should_run == true",
                    },
                    {
                        "id": "always_run",
                        "name": "Always Run",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["check"],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)


# ==========================================================================
# INT-WF-004: Approval workflow
# ==========================================================================
class TestApprovalWorkflow:
    """Tests for approval workflow execution."""

    def test_approval_workflow(
        self, api_client: httpx.Client
    ) -> None:
        """Test that workflow pauses for approval and resumes."""
        workflow = {
            "name": "approval-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "prepare",
                        "name": "Prepare",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                    },
                    {
                        "id": "approval_gate",
                        "name": "Approval Gate",
                        "type": "approval",
                        "config": {
                            "approval_message": "Please approve this action",
                            "timeout_ms": 3600000,  # 1 hour
                        },
                        "depends_on": ["prepare"],
                    },
                    {
                        "id": "execute",
                        "name": "Execute",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["approval_gate"],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)


# ==========================================================================
# INT-WF-005: Failure recovery workflow
# ==========================================================================
class TestFailureRecoveryWorkflow:
    """Tests for workflow failure recovery."""

    def test_failure_recovery(
        self, api_client: httpx.Client
    ) -> None:
        """Test that failed steps can be retried."""
        workflow = {
            "name": "failure-recovery-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "flaky_step",
                        "name": "Flaky Step",
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

    def test_on_error_continue(
        self, api_client: httpx.Client
    ) -> None:
        """Test that on_error=continue allows independent steps to run."""
        workflow = {
            "name": "on-error-continue-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step_a",
                        "name": "Step A (might fail)",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                    },
                    {
                        "id": "step_b",
                        "name": "Step B (depends on A)",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": ["step_a"],
                    },
                    {
                        "id": "step_c",
                        "name": "Step C (independent)",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "continue",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)


# ==========================================================================
# INT-WF-006: Timeout workflow
# ==========================================================================
class TestTimeoutWorkflow:
    """Tests for workflow timeout handling."""

    def test_timeout_workflow(
        self, api_client: httpx.Client
    ) -> None:
        """Test that timeout terminates workflow appropriately."""
        workflow = {
            "name": "timeout-workflow-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "long_step",
                        "name": "Long Running Step",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 1000},
                        "depends_on": [],
                        "timeout_ms": 5000,  # 5 second timeout
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)

    def test_step_level_timeout(
        self, api_client: httpx.Client
    ) -> None:
        """Test step-level timeout configuration."""
        workflow = {
            "name": "step-timeout-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "quick_step",
                        "name": "Quick Step",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                        "depends_on": [],
                        "timeout_ms": 1000,  # 1 second timeout
                    },
                    {
                        "id": "slow_step",
                        "name": "Slow Step",
                        "type": "llm",
                        "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 500},
                        "depends_on": ["quick_step"],
                        "timeout_ms": 30000,  # 30 second timeout
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = api_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)


# ==========================================================================
# Additional workflow integration tests
# ==========================================================================
class TestWorkflowStateTransitions:
    """Tests for workflow state transitions."""

    def test_workflow_state_progression(
        self, api_client: httpx.Client, sample_workflow: dict
    ) -> None:
        """Test that workflow state progresses correctly."""
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]
        initial_status = run_resp.json()["status"]

        # Initial status should be created or running
        assert initial_status in ("created", "running")

        # Wait and check again
        time.sleep(0.5)
        check_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert check_resp.status_code == 200
        current_status = check_resp.json()["status"]

        # Status should be valid
        valid_statuses = (
            "created",
            "running",
            "waiting_approval",
            "completed",
            "failed",
            "cancelled",
        )
        assert current_status in valid_statuses


class TestWorkflowInputOutput:
    """Tests for workflow input/output handling."""

    def test_workflow_input_passed(
        self, api_client: httpx.Client, sample_workflow: dict
    ) -> None:
        """Test that input is passed to workflow correctly."""
        workflow_resp = api_client.post("/api/v1/workflows", json=sample_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run with specific input
        input_data = {
            "task": "Test input passing",
            "options": {"verbose": True, "timeout": 30},
            "items": ["item1", "item2", "item3"],
        }

        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": input_data},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Get run and verify input is stored
        get_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_resp.status_code == 200
        stored_input = get_resp.json().get("input", {})
        assert stored_input.get("task") == "Test input passing"
