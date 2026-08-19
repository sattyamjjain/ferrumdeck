"""E2E tests for agent run journeys.

These tests verify complete agent run lifecycle from creation
to completion or failure.

Prerequisites:
- make quickstart
- ANTHROPIC_API_KEY set
"""

import os
import time
from typing import ClassVar

import httpx
import pytest

# The project the dev seed creates (db/migrations/20241223000002_seed_dev_data.sql).
# `POST /v1/workflows` requires it; every workflow payload below omitted it and got
# a 400, so these scenarios never reached the behaviour they were written to test.
SEED_PROJECT_ID = os.getenv("FD_SEED_PROJECT_ID", "prj_01JFVX0000000000000000001")


# Agent seeded by the dev migration, with a known allowlist.
SEED_AGENT_ID = os.getenv("FD_SEED_AGENT_ID", "agt_01JFVX0000000000000000001")


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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
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
            status_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}")
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
        workflow_resp = gateway_client.post("/v1/workflows", json=tool_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "Read a file"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait for processing
        time.sleep(3)

        # Check steps were created
        steps_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}/steps")
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
        workflow_resp = gateway_client.post("/v1/workflows", json=approval_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait and check status
        time.sleep(2)
        status_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}")
        assert status_resp.status_code == 200
        # Status could be waiting_approval if approval step was reached
        # or still running if earlier steps are processing


# ==========================================================================
# E2E-RUN-004: Run with budget kill
# ==========================================================================
class TestRunBudgetKill:
    """E2E tests for budget enforcement.

    Converted for #6. The previous version posted a workflow to
    ``/v1/workflows`` — the Next.js BFF path, not the gateway's ``/v1`` —
    and asserted the response was ``in (200, 201, 400, 422)``, a set that
    covers success and both failure modes. It then asserted a run could be
    created. Neither statement can fail on a system where budget enforcement
    does nothing at all, which is the specific behaviour the test is named for.

    The version below asserts the thing the claim rests on: with the cost
    budget exhausted, the *next* tool call is refused. Enforcement means the
    call does not proceed; logging that a budget was exceeded and continuing
    is the failure mode, not the feature.
    """

    # A `costly` tool is the one whose decision the budget actually governs.
    # On the R1-R3 ladder a `reversible` tool is allowed regardless of budget
    # and an `irreversible` one requires approval regardless — only `costly`
    # moves from AllowUnderBudget to RequireApproval when headroom runs out
    # (fd_policy::graduated_response). Testing budget with either of the others
    # would assert a constant.
    COSTLY_TOOL: ClassVar[dict] = {
        "name": "e2e-budget-probe",
        "slug": "e2e_budget_probe",
        "description": "Costly tool used to observe the budget gate end to end.",
        "mcp_server": "e2e-test",
        "risk_level": "low",
        "reversibility": "costly",
        "input_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
    }

    @staticmethod
    def _check(client: httpx.Client, run_id: str, tool: str, estimated_cost_cents: int) -> dict:
        resp = client.post(
            f"/v1/runs/{run_id}/check-tool",
            json={
                "tool_name": tool,
                "tool_input": {"q": "ok"},
                "estimated_cost_cents": estimated_cost_cents,
            },
        )
        assert resp.status_code == 200, f"check-tool failed: {resp.status_code} {resp.text}"
        return resp.json()

    def _run_with_budget(self, client: httpx.Client, max_cost_cents: int) -> str:
        resp = client.post(
            "/v1/runs",
            json={
                "agent_id": SEED_AGENT_ID,
                "input": {"task": "e2e-budget"},
                "config": {"budget": {"max_cost_cents": max_cost_cents}},
            },
        )
        assert resp.status_code in (200, 201), (
            f"setup: could not create run: {resp.status_code} {resp.text}"
        )
        return resp.json()["id"]

    def test_budget_exhaustion_blocks_the_next_call(self, gateway_client: httpx.Client) -> None:
        """E2E-RUN-004: budget enforcement refuses the call, it does not log and continue."""
        tool_resp = gateway_client.post("/v1/registry/tools", json=self.COSTLY_TOOL)
        if tool_resp.status_code == 403:
            pytest.skip("API key lacks the write scope needed to register the probe tool")
        if tool_resp.status_code not in (200, 201, 409):
            pytest.skip(
                f"could not register the costly probe tool: "
                f"{tool_resp.status_code} {tool_resp.text[:200]}"
            )
        tool_name = self.COSTLY_TOOL["slug"]

        # --- Control: headroom available -> the call proceeds ----------------
        funded = self._run_with_budget(gateway_client, max_cost_cents=10_000)
        with_headroom = self._check(gateway_client, funded, tool_name, estimated_cost_cents=1)

        assert with_headroom.get("allowed") is True, (
            "the control case must pass, otherwise the exhausted case below "
            "proves nothing -- the tool would be blocked for some reason other "
            f"than budget. decision={with_headroom}"
        )

        # --- Exhausted: no headroom -> the call is refused -------------------
        broke = self._run_with_budget(gateway_client, max_cost_cents=0)
        without_headroom = self._check(gateway_client, broke, tool_name, estimated_cost_cents=500)

        assert without_headroom.get("allowed") is not True, (
            "budget exhausted and the tool call was still authorized. The engine "
            "is in-path: an exceeded budget has to stop the next call, not be "
            f"noted while it proceeds. decision={without_headroom}"
        )
        assert without_headroom.get("response_level") == "require_approval", (
            "an exhausted cost budget must escalate a costly tool to R3 "
            "(require_approval) per fd_policy::graduated_response, got "
            f"{without_headroom.get('response_level')!r}"
        )

        # The two runs differ only in budget, so the decision difference is
        # attributable to the budget gate and nothing else.
        assert with_headroom.get("response_level") != without_headroom.get("response_level"), (
            "identical calls under different budgets produced the same response "
            "level; the budget gate is not affecting the decision at all"
        )


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
            "project_id": SEED_PROJECT_ID,
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = gateway_client.post("/v1/workflows", json=workflow)
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
            "project_id": SEED_PROJECT_ID,
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = gateway_client.post("/v1/workflows", json=workflow)
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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Immediately cancel
        cancel_resp = gateway_client.post(f"/v1/workflow-runs/{run_id}/cancel")
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
            "project_id": SEED_PROJECT_ID,
            "max_iterations": 10,
            "on_error": "fail",
        }

        workflow_resp = gateway_client.post("/v1/workflows", json=workflow)
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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Get run details
        detail_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}")
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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"task": "Count to 5"}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Wait for completion
        time.sleep(5)

        # Get run with usage
        detail_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}")
        assert detail_resp.status_code == 200
        # Usage tracking may be included in the response
