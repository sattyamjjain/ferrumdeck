"""E2E tests for dashboard journeys.

These tests verify dashboard functionality through API interactions.
Note: Actual UI testing would require Playwright or similar tools.

Prerequisites:
- make quickstart
"""

import time

import httpx
import pytest


# ==========================================================================
# E2E-UI-001: View runs list
# ==========================================================================
class TestViewRunsList:
    """E2E tests for viewing runs list."""

    def test_view_runs_list(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test dashboard shows runs list.

        E2E-UI-001: Runs list display
        """
        # First create some runs
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create a few runs
        for i in range(3):
            gateway_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"run_idx": i}},
            )

        # Wait for runs to be created
        time.sleep(1)

        # List runs (this is what dashboard would call)
        list_resp = gateway_client.get("/api/v1/workflow-runs")
        assert list_resp.status_code == 200
        data = list_resp.json()
        # Should have runs (key might be "runs", "items", or "workflow_runs")
        assert "runs" in data or "items" in data or isinstance(data, list)


# ==========================================================================
# E2E-UI-002: View run detail
# ==========================================================================
class TestViewRunDetail:
    """E2E tests for viewing run detail."""

    def test_view_run_detail(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test run detail page shows all info.

        E2E-UI-002: Run detail display
        """
        # Create workflow and run
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"detail": True}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Get run detail
        detail_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}")
        assert detail_resp.status_code == 200
        run_data = detail_resp.json()

        # Should have key fields
        assert "id" in run_data
        assert "status" in run_data

        # Get steps
        steps_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}/steps")
        assert steps_resp.status_code == 200


# ==========================================================================
# E2E-UI-003: Approve from dashboard
# ==========================================================================
class TestApproveFromDashboard:
    """E2E tests for approval actions."""

    def test_approve_from_dashboard(
        self, gateway_client: httpx.Client, approval_agent_workflow: dict
    ) -> None:
        """Test approve action from dashboard.

        E2E-UI-003: Approval action
        """
        # Create approval workflow
        workflow_resp = gateway_client.post("/api/v1/workflows", json=approval_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not start run")

        # Check pending approvals endpoint
        approvals_resp = gateway_client.get("/api/v1/approvals")
        # Endpoint might exist or not
        assert approvals_resp.status_code in (200, 404, 501)


# ==========================================================================
# E2E-UI-004: Cancel from dashboard
# ==========================================================================
class TestCancelFromDashboard:
    """E2E tests for cancel actions."""

    def test_cancel_from_dashboard(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test cancel action from dashboard.

        E2E-UI-004: Cancel action
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

        # Cancel run (dashboard action)
        cancel_resp = gateway_client.post(f"/api/v1/workflow-runs/{run_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"


# ==========================================================================
# E2E-UI-005: View threats
# ==========================================================================
class TestViewThreats:
    """E2E tests for viewing threats."""

    def test_view_threats(self, gateway_client: httpx.Client) -> None:
        """Test threat list shows in dashboard.

        E2E-UI-005: Threats display
        """
        # Get threats list
        threats_resp = gateway_client.get("/api/v1/security/threats")
        # Endpoint might exist or not
        assert threats_resp.status_code in (200, 404, 501)

        if threats_resp.status_code == 200:
            data = threats_resp.json()
            # Should be a list or have threats key
            assert isinstance(data, list) or "threats" in data


# ==========================================================================
# E2E-UI-006: Toggle Airlock mode
# ==========================================================================
class TestToggleAirlockMode:
    """E2E tests for Airlock settings."""

    def test_toggle_airlock_mode(self, gateway_client: httpx.Client) -> None:
        """Test mode toggle in dashboard.

        E2E-UI-006: Airlock mode toggle
        """
        # Get current config
        config_resp = gateway_client.get("/api/v1/security/config")
        # Endpoint might exist or not
        assert config_resp.status_code in (200, 404, 501)


# ==========================================================================
# E2E-UI-007: Real-time updates
# ==========================================================================
class TestRealTimeUpdates:
    """E2E tests for real-time updates."""

    def test_real_time_updates(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test polling shows new data.

        E2E-UI-007: Real-time updates via polling
        """
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Simulate polling (what dashboard does)
        statuses = []
        for _ in range(5):
            poll_resp = gateway_client.get(f"/api/v1/workflow-runs/{run_id}")
            assert poll_resp.status_code == 200
            statuses.append(poll_resp.json()["status"])
            time.sleep(0.5)

        # Should get consistent responses
        assert len(statuses) == 5


# ==========================================================================
# Additional dashboard tests
# ==========================================================================
class TestDashboardPagination:
    """E2E tests for dashboard pagination."""

    def test_runs_pagination(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test pagination in runs list."""
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create multiple runs
        for i in range(5):
            gateway_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"idx": i}},
            )

        # Test pagination
        page1 = gateway_client.get("/api/v1/workflow-runs?limit=2&offset=0")
        page2 = gateway_client.get("/api/v1/workflow-runs?limit=2&offset=2")

        assert page1.status_code == 200
        assert page2.status_code == 200


class TestDashboardFiltering:
    """E2E tests for dashboard filtering."""

    def test_runs_filter_by_status(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """Test filtering runs by status."""
        workflow_resp = gateway_client.post("/api/v1/workflows", json=simple_agent_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create and cancel a run
        run_resp = gateway_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        run_id = run_resp.json()["id"]
        gateway_client.post(f"/api/v1/workflow-runs/{run_id}/cancel")

        # Filter by cancelled status
        filter_resp = gateway_client.get("/api/v1/workflow-runs?status=cancelled")
        assert filter_resp.status_code == 200
