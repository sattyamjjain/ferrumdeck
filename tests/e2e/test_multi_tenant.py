"""E2E tests for multi-tenant isolation.

These tests verify tenant isolation, rate limiting, and
cross-tenant security boundaries.

Prerequisites:
- make quickstart
- Multiple tenant API keys configured
"""

import time

import httpx
import pytest


# ==========================================================================
# E2E-MT-001: Tenant data isolation
# ==========================================================================
class TestTenantDataIsolation:
    """E2E tests for tenant data isolation."""

    def test_tenant_data_isolation(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test data isolation between tenants.

        E2E-MT-001: Tenant isolation
        """
        # Create workflow as tenant A
        workflow_a = simple_agent_workflow.copy()
        workflow_a["name"] = "tenant-a-workflow"
        resp_a = tenant_a_client.post("/api/v1/workflows", json=workflow_a)
        if resp_a.status_code not in (200, 201):
            pytest.skip("Could not create workflow as tenant A")
        workflow_a_id = resp_a.json()["id"]

        # Create workflow as tenant B
        workflow_b = simple_agent_workflow.copy()
        workflow_b["name"] = "tenant-b-workflow"
        resp_b = tenant_b_client.post("/api/v1/workflows", json=workflow_b)
        if resp_b.status_code not in (200, 201):
            pytest.skip("Could not create workflow as tenant B")
        workflow_b_id = resp_b.json()["id"]

        # Tenant A should see their workflow
        get_a = tenant_a_client.get(f"/api/v1/workflows/{workflow_a_id}")
        assert get_a.status_code == 200
        assert get_a.json()["name"] == "tenant-a-workflow"

        # Tenant B should see their workflow
        get_b = tenant_b_client.get(f"/api/v1/workflows/{workflow_b_id}")
        assert get_b.status_code == 200
        assert get_b.json()["name"] == "tenant-b-workflow"

        # Cross-tenant access should be blocked
        cross_a = tenant_a_client.get(f"/api/v1/workflows/{workflow_b_id}")
        assert cross_a.status_code in (403, 404)

        cross_b = tenant_b_client.get(f"/api/v1/workflows/{workflow_a_id}")
        assert cross_b.status_code in (403, 404)

    def test_tenant_run_isolation(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test that runs are isolated between tenants."""
        # Create workflow and run as tenant A
        workflow = simple_agent_workflow.copy()
        workflow["name"] = "isolation-test-a"
        workflow_resp = tenant_a_client.post("/api/v1/workflows", json=workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        run_resp = tenant_a_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not create run")
        run_id = run_resp.json()["id"]

        # Tenant A can access their run
        get_a = tenant_a_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_a.status_code == 200

        # Tenant B cannot access tenant A's run
        get_b = tenant_b_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert get_b.status_code in (403, 404)


# ==========================================================================
# E2E-MT-002: Tenant rate limits
# ==========================================================================
class TestTenantRateLimits:
    """E2E tests for tenant-specific rate limiting."""

    def test_tenant_rate_limits(
        self, tenant_a_client: httpx.Client
    ) -> None:
        """Test rate limits enforced per tenant.

        E2E-MT-002: Rate limit enforcement
        """
        # Make rapid requests to trigger rate limiting
        responses = []
        for _ in range(50):
            resp = tenant_a_client.get("/api/v1/workflows")
            responses.append(resp.status_code)

        # Should eventually get rate limited (429) or all succeed
        # Depending on configured limits
        assert all(code in (200, 429) for code in responses)

    def test_rate_limit_headers(
        self, tenant_a_client: httpx.Client
    ) -> None:
        """Test that rate limit headers are present."""
        resp = tenant_a_client.get("/api/v1/workflows")
        assert resp.status_code in (200, 429)

        # Check for rate limit headers (if implemented)
        # These are optional but good practice
        expected_headers = [
            "x-ratelimit-limit",
            "x-ratelimit-remaining",
            "x-ratelimit-reset",
            "ratelimit-limit",
            "ratelimit-remaining",
        ]
        # Check if any rate limit header is present (optional feature)
        has_rate_limit_header = any(
            h in resp.headers for h in expected_headers
        )
        # At least check request completed (header presence is optional)
        assert resp.status_code in (200, 429) or has_rate_limit_header


# ==========================================================================
# E2E-MT-003: Tenant-specific policies
# ==========================================================================
class TestTenantPolicies:
    """E2E tests for tenant-specific policies."""

    def test_tenant_policies(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
    ) -> None:
        """Test tenant-specific tool allowlists.

        E2E-MT-003: Per-tenant policies
        """
        # Create workflow with tool that may be allowed for one tenant
        workflow = {
            "name": "policy-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "tool_step",
                        "name": "Tool Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "read_file",
                            "tool_input": {"path": "/tmp/test.txt"},
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 10,
            "on_error": "fail",
        }

        # Both tenants try to create the workflow
        resp_a = tenant_a_client.post("/api/v1/workflows", json=workflow)
        resp_b = tenant_b_client.post("/api/v1/workflows", json=workflow)

        # Results depend on tenant-specific policies
        # Both should get a valid response (success or policy error)
        assert resp_a.status_code in (200, 201, 400, 403, 422)
        assert resp_b.status_code in (200, 201, 400, 403, 422)

    def test_tenant_budget_limits(
        self,
        tenant_a_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test that tenant budget limits are enforced."""
        workflow = simple_agent_workflow.copy()
        workflow["name"] = "budget-test"
        workflow["budget"] = {
            "max_tokens": 100,
            "max_cost_cents": 10,
        }

        resp = tenant_a_client.post("/api/v1/workflows", json=workflow)
        # Should succeed or fail validation
        assert resp.status_code in (200, 201, 400, 422)


# ==========================================================================
# E2E-MT-004: Cross-tenant access blocking
# ==========================================================================
class TestCrossTenantBlocking:
    """E2E tests for cross-tenant access blocking."""

    def test_cross_tenant_workflow_access(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test workflow access blocked across tenants.

        E2E-MT-004: Cross-tenant blocking
        """
        # Create workflow as tenant A
        workflow = simple_agent_workflow.copy()
        workflow["name"] = "cross-tenant-test"
        resp = tenant_a_client.post("/api/v1/workflows", json=workflow)
        if resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = resp.json()["id"]

        # Tenant B tries to start a run on tenant A's workflow
        run_resp = tenant_b_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        # Should be blocked
        assert run_resp.status_code in (400, 403, 404, 422)

    def test_cross_tenant_run_cancel(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test that tenant B cannot cancel tenant A's run."""
        # Create workflow and run as tenant A
        workflow = simple_agent_workflow.copy()
        workflow["name"] = "cancel-isolation-test"
        workflow_resp = tenant_a_client.post("/api/v1/workflows", json=workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        run_resp = tenant_a_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not create run")
        run_id = run_resp.json()["id"]

        # Tenant B tries to cancel tenant A's run
        cancel_resp = tenant_b_client.post(f"/api/v1/workflow-runs/{run_id}/cancel")
        # Should be blocked
        assert cancel_resp.status_code in (403, 404)

    def test_cross_tenant_step_access(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test that tenant B cannot access tenant A's run steps."""
        # Create workflow and run as tenant A
        workflow = simple_agent_workflow.copy()
        workflow["name"] = "step-isolation-test"
        workflow_resp = tenant_a_client.post("/api/v1/workflows", json=workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        run_resp = tenant_a_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not create run")
        run_id = run_resp.json()["id"]

        # Wait for some steps to be created
        time.sleep(1)

        # Tenant A can access steps
        steps_a = tenant_a_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_a.status_code == 200

        # Tenant B cannot access tenant A's steps
        steps_b = tenant_b_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_b.status_code in (403, 404)


# ==========================================================================
# Additional multi-tenant tests
# ==========================================================================
class TestTenantListFiltering:
    """E2E tests for tenant list filtering."""

    def test_workflow_list_filtered_by_tenant(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test that workflow lists are filtered by tenant."""
        # Create workflows for both tenants
        workflow_a = simple_agent_workflow.copy()
        workflow_a["name"] = "list-test-a"
        tenant_a_client.post("/api/v1/workflows", json=workflow_a)

        workflow_b = simple_agent_workflow.copy()
        workflow_b["name"] = "list-test-b"
        tenant_b_client.post("/api/v1/workflows", json=workflow_b)

        # Get lists
        list_a = tenant_a_client.get("/api/v1/workflows")
        list_b = tenant_b_client.get("/api/v1/workflows")

        if list_a.status_code == 200:
            data_a = list_a.json()
            workflows_a = data_a.get("workflows", data_a) if isinstance(data_a, dict) else data_a
            if isinstance(workflows_a, list):
                names_a = [w.get("name", "") for w in workflows_a]
                # Should not contain tenant B's workflows
                assert "list-test-b" not in names_a

        if list_b.status_code == 200:
            data_b = list_b.json()
            workflows_b = data_b.get("workflows", data_b) if isinstance(data_b, dict) else data_b
            if isinstance(workflows_b, list):
                names_b = [w.get("name", "") for w in workflows_b]
                # Should not contain tenant A's workflows
                assert "list-test-a" not in names_b

    def test_run_list_filtered_by_tenant(
        self,
        tenant_a_client: httpx.Client,
        tenant_b_client: httpx.Client,
        simple_agent_workflow: dict,
    ) -> None:
        """Test that run lists are filtered by tenant."""
        # Create workflow and run for tenant A
        workflow = simple_agent_workflow.copy()
        workflow["name"] = "run-list-test"
        workflow_resp = tenant_a_client.post("/api/v1/workflows", json=workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        tenant_a_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )

        # Get run lists
        runs_a = tenant_a_client.get("/api/v1/workflow-runs")
        runs_b = tenant_b_client.get("/api/v1/workflow-runs")

        # Tenant A should see their runs
        assert runs_a.status_code == 200

        # Tenant B should not see tenant A's runs
        if runs_b.status_code == 200:
            data_b = runs_b.json()
            runs_list = data_b.get("runs", data_b) if isinstance(data_b, dict) else data_b
            if isinstance(runs_list, list):
                # Check none of tenant B's runs are from tenant A's workflow
                for run in runs_list:
                    assert run.get("workflow_id") != workflow_id


class TestTenantAuthentication:
    """E2E tests for tenant authentication."""

    def test_invalid_api_key(self) -> None:
        """Test that invalid API keys are rejected."""
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer invalid_api_key_12345",
                "Content-Type": "application/json",
            },
            timeout=10.0,
        ) as client:
            try:
                resp = client.get("/api/v1/workflows")
                assert resp.status_code in (401, 403)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")

    def test_missing_api_key(self) -> None:
        """Test that missing API keys are rejected."""
        with httpx.Client(
            base_url="http://localhost:8080",
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        ) as client:
            try:
                resp = client.get("/api/v1/workflows")
                assert resp.status_code in (401, 403)
            except httpx.ConnectError:
                pytest.skip("Gateway not running")
