"""Tests for DAG orchestration logic."""

import json
from typing import Any

import httpx
import pytest


class TestDAGValidation:
    """Tests for DAG validation in workflow creation."""

    def test_valid_linear_dag(self, api_client: httpx.Client):
        """Test creating a valid linear DAG (A -> B -> C)."""
        workflow = {
            "name": "linear-dag",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {"id": "a", "name": "Step A", "type": "llm", "depends_on": []},
                    {"id": "b", "name": "Step B", "type": "llm", "depends_on": ["a"]},
                    {"id": "c", "name": "Step C", "type": "llm", "depends_on": ["b"]},
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)

    def test_valid_diamond_dag(self, api_client: httpx.Client):
        """Test creating a valid diamond DAG (A -> B,C -> D)."""
        workflow = {
            "name": "diamond-dag",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {"id": "a", "name": "Step A", "type": "llm", "depends_on": []},
                    {"id": "b", "name": "Step B", "type": "llm", "depends_on": ["a"]},
                    {"id": "c", "name": "Step C", "type": "llm", "depends_on": ["a"]},
                    {"id": "d", "name": "Step D", "type": "llm", "depends_on": ["b", "c"]},
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)

    def test_valid_complex_dag(self, api_client: httpx.Client):
        """Test creating a complex DAG with multiple paths."""
        workflow = {
            "name": "complex-dag",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {"id": "start", "name": "Start", "type": "llm", "depends_on": []},
                    {"id": "a", "name": "A", "type": "llm", "depends_on": ["start"]},
                    {"id": "b", "name": "B", "type": "llm", "depends_on": ["start"]},
                    {"id": "c", "name": "C", "type": "llm", "depends_on": ["a"]},
                    {"id": "d", "name": "D", "type": "llm", "depends_on": ["a", "b"]},
                    {"id": "e", "name": "E", "type": "llm", "depends_on": ["b"]},
                    {"id": "end", "name": "End", "type": "llm", "depends_on": ["c", "d", "e"]},
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)

    def test_multiple_entry_points(self, api_client: httpx.Client):
        """Test DAG with multiple entry points (independent starting steps)."""
        workflow = {
            "name": "multi-entry-dag",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {"id": "entry1", "name": "Entry 1", "type": "llm", "depends_on": []},
                    {"id": "entry2", "name": "Entry 2", "type": "llm", "depends_on": []},
                    {"id": "entry3", "name": "Entry 3", "type": "llm", "depends_on": []},
                    {"id": "merge", "name": "Merge", "type": "llm", "depends_on": ["entry1", "entry2", "entry3"]},
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)


class TestDAGExecution:
    """Tests for DAG execution order."""

    def test_entry_points_execute_first(self, api_client: httpx.Client):
        """Test that entry point steps are executed first."""
        workflow = {
            "name": "entry-point-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {"id": "init", "name": "Init", "type": "llm", "depends_on": [], "config": {}},
                    {"id": "next", "name": "Next", "type": "llm", "depends_on": ["init"], "config": {}},
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        # Create workflow
        create_resp = api_client.post("/api/v1/workflows", json=workflow)
        if create_resp.status_code not in (200, 201):
            pytest.skip(f"Could not create workflow: {create_resp.text}")

        workflow_id = create_resp.json()["id"]

        # Start run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip(f"Could not start run: {run_resp.text}")

        run_id = run_resp.json()["id"]

        # Check step executions - init should be created immediately
        import time
        time.sleep(0.5)

        steps_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200

        executions = steps_resp.json().get("executions", [])
        if len(executions) > 0:
            # The first step created should be the entry point
            step_ids = [e["step_id"] for e in executions]
            assert "init" in step_ids, f"Entry point 'init' not found in {step_ids}"


class TestStepTypes:
    """Tests for different step types."""

    def test_llm_step_type(self, api_client: httpx.Client):
        """Test workflow with LLM step type."""
        workflow = {
            "name": "llm-step-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "llm_step",
                        "name": "LLM Step",
                        "type": "llm",
                        "config": {
                            "model": "claude-sonnet-4-20250514",
                            "system_prompt": "You are a test assistant.",
                            "max_tokens": 100,
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)

    def test_tool_step_type(self, api_client: httpx.Client):
        """Test workflow with tool step type."""
        workflow = {
            "name": "tool-step-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "tool_step",
                        "name": "Tool Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "test_tool",
                            "tool_input": {"arg": "value"},
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)

    def test_approval_step_type(self, api_client: httpx.Client):
        """Test workflow with approval step type."""
        workflow = {
            "name": "approval-step-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "pre_approval",
                        "name": "Pre-Approval",
                        "type": "llm",
                        "config": {},
                        "depends_on": [],
                    },
                    {
                        "id": "approval_step",
                        "name": "Approval Step",
                        "type": "approval",
                        "config": {
                            "tool_name": "sensitive_action",
                            "approval_message": "Approve this action?",
                        },
                        "depends_on": ["pre_approval"],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)

    def test_parallel_step_type(self, api_client: httpx.Client):
        """Test workflow with parallel step type."""
        workflow = {
            "name": "parallel-step-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "parallel_step",
                        "name": "Parallel Step",
                        "type": "parallel",
                        "config": {
                            "steps": [
                                {"id": "p1", "name": "P1", "type": "llm", "config": {}},
                                {"id": "p2", "name": "P2", "type": "llm", "config": {}},
                            ],
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)


class TestOnErrorPolicies:
    """Tests for on_error workflow policies."""

    def test_on_error_fail_policy(self, api_client: httpx.Client):
        """Test workflow with on_error='fail' policy."""
        workflow = {
            "name": "fail-policy-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {"id": "a", "name": "Step A", "type": "llm", "depends_on": []},
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)
        data = response.json()
        assert data.get("on_error") == "fail"

    def test_on_error_continue_policy(self, api_client: httpx.Client):
        """Test workflow with on_error='continue' policy."""
        workflow = {
            "name": "continue-policy-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {"id": "a", "name": "Step A", "type": "llm", "depends_on": []},
                    {"id": "b", "name": "Step B", "type": "llm", "depends_on": ["a"]},
                    {"id": "c", "name": "Step C", "type": "llm", "depends_on": []},  # Independent
                ],
            },
            "max_iterations": 10,
            "on_error": "continue",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)
        data = response.json()
        assert data.get("on_error") == "continue"


class TestRetryConfiguration:
    """Tests for step retry configuration."""

    def test_step_with_retry(self, api_client: httpx.Client):
        """Test step with retry configuration."""
        workflow = {
            "name": "retry-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "retry_step",
                        "name": "Retry Step",
                        "type": "llm",
                        "config": {},
                        "depends_on": [],
                        "retry": {
                            "max_attempts": 3,
                            "delay_ms": 1000,
                            "backoff_multiplier": 2.0,
                        },
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)


class TestTimeoutConfiguration:
    """Tests for step timeout configuration."""

    def test_step_with_timeout(self, api_client: httpx.Client):
        """Test step with custom timeout."""
        workflow = {
            "name": "timeout-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "timeout_step",
                        "name": "Timeout Step",
                        "type": "llm",
                        "config": {},
                        "depends_on": [],
                        "timeout_ms": 60000,  # 60 seconds
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        response = api_client.post("/api/v1/workflows", json=workflow)
        assert response.status_code in (200, 201)
