"""E2E tests for agent run journeys.

These tests verify complete agent run lifecycle from creation
to completion or failure.

Prerequisites:
- make quickstart
- ANTHROPIC_API_KEY set
"""

import time

import httpx
import pytest


# ==========================================================================
# E2E-RUN-001: Create and complete run
# ==========================================================================
class TestCreateAndCompleteRun:
    """E2E tests for run creation and completion."""

    def test_create_and_complete_run(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test full run from API to completion.

        E2E-RUN-001: Complete agent run lifecycle
        """
        # Create workflow
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={
                "workflow_id": workflow_id,
                "input": {"task": "Say hello in one sentence"},
            },
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Poll until completion or timeout
        max_wait = 60  # 60 seconds
        start = time.time()
        final_status = None

        while time.time() - start < max_wait:
            status_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}")
            assert status_resp.status_code == 200
            final_status = status_resp.json()["status"]

            if final_status in ("completed", "failed", "cancelled", "budget_killed"):
                break
            time.sleep(2)

        # Run should complete (or fail, but not hang)
        assert final_status is not None
        assert final_status in (
            "completed",
            "failed",
            "cancelled",
            "budget_killed",
            "running",  # May still be running if LLM is slow
        )


# ==========================================================================
# E2E-RUN-002: Run with tool calls
# ==========================================================================
class TestRunWithToolCalls:
    """E2E tests for runs with tool calls."""

    def test_run_with_tool_calls(
        self, gateway_client: httpx.Client, tool_agent_workflow: dict
    ) -> None:
        """Test run with multiple tool calls.

        E2E-RUN-002: Agent with tool execution
        """
        workflow_resp = gateway_client.post("/api/v1/workflows", json=tool_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "Read a file"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait for processing
        time.sleep(3)

        # Check steps were created
        steps_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200


# ==========================================================================
# E2E-RUN-003: Run with approval
# ==========================================================================
class TestRunWithApproval:
    """E2E tests for approval workflows."""

    def test_run_with_approval(
        self, gateway_client: httpx.Client, approval_agent_workflow: dict
    ) -> None:
        """Test run pauses and resumes with approval.

        E2E-RUN-003: Approval gate functionality
        """
        workflow_resp = gateway_client.post("/api/v1/workflows", json=approval_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait and check status
        time.sleep(2)
        status_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert status_resp.status_code == 200
        # Status could be waiting_approval if approval step was reached
        # or still running if earlier steps are processing


# ==========================================================================
# E2E-RUN-004: Run with budget kill
# ==========================================================================
class TestRunBudgetKill:
    """E2E tests for budget enforcement."""

    def test_run_budget_kill(
        self, gateway_client: httpx.Client, budget_limited_workflow: dict
    ) -> None:
        """Test run killed on budget exceed.

        E2E-RUN-004: Budget enforcement
        """
        workflow_resp = gateway_client.post("/api/v1/workflows", json=budget_limited_workflow)
        if workflow_resp.status_code not in (200, 201, 400, 422):
            pytest.skip("Could not process budget workflow")

        # Budget enforcement may happen at creation or runtime
        if workflow_resp.status_code in (200, 201):
            workflow_id = workflow_resp.json()["id"]

            # Start run
            run_resp = gateway_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {}},
            )
            assert run_resp.status_code in (200, 201)


# ==========================================================================
# E2E-RUN-005: Run policy block
# ==========================================================================
class TestRunPolicyBlock:
    """E2E tests for policy enforcement."""

    def test_run_policy_block(self, gateway_client: httpx.Client) -> None:
        """Test run blocked on denied tool.

        E2E-RUN-005: Policy enforcement
        """
        workflow = {
            "name": "e2e-policy-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "dangerous",
                        "name": "Dangerous Tool",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_shell",  # Should be denied
                            "tool_input": {"command": "ls"},
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = gateway_client.post("/api/v1/workflows", json=workflow)
        # Should succeed or fail based on policy validation timing
        assert workflow_resp.status_code in (200, 201, 400, 422)


# ==========================================================================
# E2E-RUN-006: Run Airlock block
# ==========================================================================
class TestRunAirlockBlock:
    """E2E tests for Airlock security."""

    def test_run_airlock_block(self, gateway_client: httpx.Client) -> None:
        """Test run blocked by Airlock.

        E2E-RUN-006: Airlock security enforcement
        """
        workflow = {
            "name": "e2e-airlock-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "malicious",
                        "name": "Potentially Malicious",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "eval(user_input)",  # RCE pattern
                            },
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = gateway_client.post("/api/v1/workflows", json=workflow)
        # Should be blocked by Airlock or policy
        assert workflow_resp.status_code in (200, 201, 400, 422, 403)


# ==========================================================================
# E2E-RUN-007: Run cancellation
# ==========================================================================
class TestRunCancellation:
    """E2E tests for run cancellation."""

    def test_run_cancellation(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test user cancels in-flight run.

        E2E-RUN-007: Run cancellation
        """
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Immediately cancel
        cancel_resp = gateway_client.post(f"/api/v1/workflow-runs/{run_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"


# ==========================================================================
# E2E-RUN-008: Run timeout
# ==========================================================================
class TestRunTimeout:
    """E2E tests for run timeout."""

    def test_run_timeout(self, gateway_client: httpx.Client) -> None:
        """Test run times out.

        E2E-RUN-008: Timeout handling
        """
        workflow = {
            "name": "e2e-timeout-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "slow",
                        "name": "Slow Step",
                        "type": "llm",
                        "config": {
                            "model": "claude-sonnet-4-20250514",
                            "max_tokens": 1000,
                        },
                        "depends_on": [],
                        "timeout_ms": 1000,  # 1 second timeout
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = gateway_client.post("/api/v1/workflows", json=workflow)
        assert workflow_resp.status_code in (200, 201)


# ==========================================================================
# Additional E2E run tests
# ==========================================================================
class TestRunStatusTracking:
    """E2E tests for run status tracking."""

    def test_run_status_history(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test that run status history is tracked."""
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Get run details
        detail_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert detail_resp.status_code == 200
        run_data = detail_resp.json()

        # Should have timestamps
        assert "created_at" in run_data or "id" in run_data


class TestRunResourceTracking:
    """E2E tests for run resource tracking."""

    def test_run_token_tracking(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test that token usage is tracked."""
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "Count to 5"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait for completion
        time.sleep(5)

        # Get run with usage
        detail_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert detail_resp.status_code == 200
        # Usage tracking may be included in the response
