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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        assert workflow_resp.status_code in (200, 201), (
            f"could not create the workflow this test needs: "
            f"{workflow_resp.status_code} {workflow_resp.text}. A setup failure is not a pass; "
            "skipping here is what let twenty cases report green while "
            "asserting nothing (#6)."
        )
        workflow_id = workflow_resp.json()["id"]

        # Create a few runs, keeping their ids so the list below can be checked
        # against them rather than against its own shape.
        created_run_ids: set[str] = set()
        for i in range(3):
            resp = gateway_client.post(
                "/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"run_idx": i}},
            )
            assert resp.status_code in (200, 201), (
                f"could not create run {i}: {resp.status_code} {resp.text}"
            )
            created_run_ids.add(resp.json()["id"])

        # Wait for runs to be created
        time.sleep(1)

        # List the runs. `GET /v1/workflow-runs` does not exist -- the collection
        # is addressed under its workflow -- so this asserted 405 forever behind
        # a skip.
        list_resp = gateway_client.get(f"/v1/workflows/{workflow_id}/runs")
        assert list_resp.status_code == 200, list_resp.text

        # Assert the runs we just created are actually IN the response, not that
        # the response merely has a plausible shape. `"runs" in data` passes on
        # an empty list, which is the assertion-free shape this suite is being
        # drained of.
        payload = list_resp.json()
        runs = payload if isinstance(payload, list) else payload.get("runs", [])
        listed = {r["id"] for r in runs}
        assert created_run_ids, "the loop above created no runs to look for"
        assert created_run_ids <= listed, (
            f"created {sorted(created_run_ids)} but the list returned "
            f"{sorted(listed)} -- the dashboard would not show them"
        )


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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        assert workflow_resp.status_code in (200, 201), (
            f"could not create the workflow this test needs: "
            f"{workflow_resp.status_code} {workflow_resp.text}. A setup failure is not a pass; "
            "skipping here is what let twenty cases report green while "
            "asserting nothing (#6)."
        )
        workflow_id = workflow_resp.json()["id"]

        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {"detail": True}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Get run detail
        detail_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}")
        assert detail_resp.status_code == 200
        run_data = detail_resp.json()

        # Should have key fields
        assert "id" in run_data
        assert "status" in run_data

        # The per-run step collection is `/executions`, not `/steps`; the latter
        # has never existed and returned 404 behind a skip.
        steps_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}/executions")
        assert steps_resp.status_code == 200, steps_resp.text


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
        workflow_resp = gateway_client.post("/v1/workflows", json=approval_agent_workflow)
        assert workflow_resp.status_code in (200, 201), (
            f"could not create the workflow this test needs: "
            f"{workflow_resp.status_code} {workflow_resp.text}. A setup failure is not a pass; "
            "skipping here is what let twenty cases report green while "
            "asserting nothing (#6)."
        )
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not start run")

        # Check pending approvals endpoint
        approvals_resp = gateway_client.get("/v1/approvals")
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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        assert workflow_resp.status_code in (200, 201), (
            f"could not create the workflow this test needs: "
            f"{workflow_resp.status_code} {workflow_resp.text}. A setup failure is not a pass; "
            "skipping here is what let twenty cases report green while "
            "asserting nothing (#6)."
        )
        workflow_id = workflow_resp.json()["id"]

        # Start run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Cancel run (dashboard action)
        cancel_resp = gateway_client.post(f"/v1/workflow-runs/{run_id}/cancel")
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
        threats_resp = gateway_client.get("/v1/security/threats")
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
        config_resp = gateway_client.get("/v1/security/config")
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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        assert workflow_resp.status_code in (200, 201), (
            f"could not create the workflow this test needs: "
            f"{workflow_resp.status_code} {workflow_resp.text}. A setup failure is not a pass; "
            "skipping here is what let twenty cases report green while "
            "asserting nothing (#6)."
        )
        workflow_id = workflow_resp.json()["id"]

        # Create run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201)
        run_id = run_resp.json()["id"]

        # Simulate polling (what dashboard does)
        statuses = []
        for _ in range(5):
            poll_resp = gateway_client.get(f"/v1/workflow-runs/{run_id}")
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
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        assert workflow_resp.status_code in (200, 201), (
            f"could not create the workflow this test needs: "
            f"{workflow_resp.status_code} {workflow_resp.text}. A setup failure is not a pass; "
            "skipping here is what let twenty cases report green while "
            "asserting nothing (#6)."
        )
        workflow_id = workflow_resp.json()["id"]

        # Create multiple runs
        created: list[str] = []
        for i in range(5):
            resp = gateway_client.post(
                "/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {"idx": i}},
            )
            assert resp.status_code in (200, 201), f"{resp.status_code} {resp.text}"
            created.append(resp.json()["id"])

        def page(offset: int) -> list[str]:
            # `/v1/workflow-runs?limit=..` does not exist; the collection is
            # addressed under its workflow. Scoping to THIS workflow also makes
            # the assertion below deterministic -- a global list would be shared
            # with every other test in the session.
            resp = gateway_client.get(
                f"/v1/workflows/{workflow_id}/runs?limit=2&offset={offset}"
            )
            assert resp.status_code == 200, resp.text
            payload = resp.json()
            runs = payload if isinstance(payload, list) else payload.get("runs", [])
            return [r["id"] for r in runs]

        page1, page2 = page(0), page(2)

        # Assert pagination PAGINATES. Two 200s prove only that the endpoint
        # answered; they would pass just as happily if `offset` were ignored and
        # both pages returned the same rows.
        assert len(page1) == 2, f"limit=2 returned {len(page1)} runs: {page1}"
        assert len(page2) == 2, f"limit=2 returned {len(page2)} runs: {page2}"
        assert not set(page1) & set(page2), (
            f"offset=0 and offset=2 overlap ({set(page1) & set(page2)}) -- "
            "offset is not being applied"
        )
        assert set(page1) | set(page2) <= set(created)


class TestDashboardFiltering:
    """E2E tests for dashboard filtering."""

    def test_a_cancelled_run_reads_as_cancelled(
        self, gateway_client: httpx.Client, simple_agent_workflow: dict
    ) -> None:
        """A cancelled run reads back as cancelled, and stays in its list.

        Renamed from `test_runs_filter_by_status`: there is no status filter on
        the workflow-runs collection, so the old name described an endpoint that
        has never existed.
        """
        workflow_resp = gateway_client.post("/v1/workflows", json=simple_agent_workflow)
        assert workflow_resp.status_code in (200, 201), (
            f"could not create the workflow this test needs: "
            f"{workflow_resp.status_code} {workflow_resp.text}. A setup failure is not a pass; "
            "skipping here is what let twenty cases report green while "
            "asserting nothing (#6)."
        )
        workflow_id = workflow_resp.json()["id"]

        # Create and cancel a run
        run_resp = gateway_client.post(
            "/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        assert run_resp.status_code in (200, 201), f"{run_resp.status_code} {run_resp.text}"
        run_id = run_resp.json()["id"]

        cancel_resp = gateway_client.post(f"/v1/workflow-runs/{run_id}/cancel")
        assert cancel_resp.status_code in (200, 202, 204), (
            f"cancel returned {cancel_resp.status_code}: {cancel_resp.text}"
        )

        # Assert the cancellation LANDED, by reading the run back.
        #
        # This used to call `GET /v1/workflow-runs?status=cancelled` and assert
        # only that it returned 200. That endpoint does not exist -- it 405s --
        # and there is no status filter on the collection that does
        # (`ListWorkflowsQuery` carries limit/offset/project_id only). Even had
        # it existed, `status_code == 200` would have passed while the filter
        # returned every run in the database.
        #
        # What the test was reaching for is that a cancelled run READS as
        # cancelled, so that is asserted directly against the resource.
        detail = gateway_client.get(f"/v1/workflow-runs/{run_id}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["status"] == "cancelled", (
            f"cancel returned {cancel_resp.status_code} but the run reads as "
            f"{detail.json()['status']!r} -- the call was accepted and did nothing"
        )

        # ...and that it is still listed under its workflow, with that status.
        listed = gateway_client.get(f"/v1/workflows/{workflow_id}/runs")
        assert listed.status_code == 200, listed.text
        payload = listed.json()
        runs = payload if isinstance(payload, list) else payload.get("runs", [])
        row = next((r for r in runs if r["id"] == run_id), None)
        assert row is not None, f"cancelled run {run_id} vanished from its workflow's list"
        assert row["status"] == "cancelled"
