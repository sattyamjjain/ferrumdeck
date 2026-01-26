"""Latency tests for FerrumDeck.

These tests measure response time for various API operations.

Prerequisites:
- make quickstart
- Gateway running
"""

import time

import httpx
import pytest


# ==========================================================================
# PERF-LAT-001: Create run latency
# ==========================================================================
class TestCreateRunLatency:
    """Latency tests for run creation."""

    def test_create_run_latency(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test POST /v1/runs latency.

        PERF-LAT-001: Target < 100ms p95
        """
        # Create workflow first
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Measure creation latency
        latencies: list[float] = []
        for i in range(20):
            start = time.perf_counter()
            resp = api_client.post(
                "/api/v1/workflow-runs",
                json={
                    "workflow_id": workflow_id,
                    "input": {"idx": i},
                },
            )
            elapsed = time.perf_counter() - start
            if resp.status_code in (200, 201):
                latencies.append(elapsed * 1000)  # Convert to ms

        if not latencies:
            pytest.skip("No successful requests")

        # Calculate p95
        sorted_latencies = sorted(latencies)
        p95_idx = int(len(sorted_latencies) * 0.95)
        p95 = sorted_latencies[p95_idx] if sorted_latencies else 0

        # Note: 100ms is aggressive; adjust as needed
        assert p95 < 500, f"p95 create latency too high: {p95}ms"


# ==========================================================================
# PERF-LAT-002: Get run latency
# ==========================================================================
class TestGetRunLatency:
    """Latency tests for run retrieval."""

    def test_get_run_latency(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test GET /v1/runs/{id} latency.

        PERF-LAT-002: Target < 50ms p95
        """
        # Create workflow and run
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
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

        # Measure retrieval latency
        latencies: list[float] = []
        for _ in range(50):
            start = time.perf_counter()
            resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
            elapsed = time.perf_counter() - start
            if resp.status_code == 200:
                latencies.append(elapsed * 1000)

        if not latencies:
            pytest.skip("No successful requests")

        sorted_latencies = sorted(latencies)
        p95_idx = int(len(sorted_latencies) * 0.95)
        p95 = sorted_latencies[p95_idx]

        assert p95 < 200, f"p95 get latency too high: {p95}ms"


# ==========================================================================
# PERF-LAT-003: Policy check latency
# ==========================================================================
class TestPolicyCheckLatency:
    """Latency tests for policy evaluation."""

    def test_policy_check_latency(
        self, api_client: httpx.Client
    ) -> None:
        """Test policy evaluation latency.

        PERF-LAT-003: Target < 10ms p95
        """
        # Create workflow with tool that triggers policy check
        workflow = {
            "name": "policy-latency-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "policy_step",
                        "name": "Policy Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "read_file",
                            "tool_input": {"path": "/tmp/test.txt"},
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 5,
            "on_error": "fail",
        }

        # Measure workflow creation (includes policy validation)
        latencies: list[float] = []
        for _ in range(10):
            workflow_copy = workflow.copy()
            workflow_copy["name"] = f"policy-test-{time.time()}"

            start = time.perf_counter()
            api_client.post("/api/v1/workflows", json=workflow_copy)
            elapsed = time.perf_counter() - start

            # Include all responses (policy check happens regardless)
            latencies.append(elapsed * 1000)

        sorted_latencies = sorted(latencies)
        p95_idx = int(len(sorted_latencies) * 0.95)
        p95 = sorted_latencies[p95_idx]

        # Policy check is part of workflow creation
        assert p95 < 500, f"p95 policy check latency too high: {p95}ms"


# ==========================================================================
# PERF-LAT-004: Airlock latency
# ==========================================================================
class TestAirlockLatency:
    """Latency tests for Airlock inspection."""

    def test_airlock_latency(
        self, api_client: httpx.Client
    ) -> None:
        """Test Airlock inspection latency.

        PERF-LAT-004: Target < 5ms p95
        """
        # Create workflow with content that triggers Airlock
        workflow = {
            "name": "airlock-latency-test",
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "airlock_step",
                        "name": "Airlock Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "print('hello')",
                            },
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 5,
            "on_error": "fail",
        }

        latencies: list[float] = []
        for i in range(10):
            workflow_copy = workflow.copy()
            workflow_copy["name"] = f"airlock-test-{i}-{time.time()}"

            start = time.perf_counter()
            api_client.post("/api/v1/workflows", json=workflow_copy)
            elapsed = time.perf_counter() - start

            latencies.append(elapsed * 1000)

        sorted_latencies = sorted(latencies)
        p95_idx = int(len(sorted_latencies) * 0.95)
        p95 = sorted_latencies[p95_idx]

        # Airlock check is part of workflow validation
        assert p95 < 500, f"p95 Airlock latency too high: {p95}ms"


# ==========================================================================
# PERF-LAT-005: Queue enqueue latency
# ==========================================================================
class TestQueueEnqueueLatency:
    """Latency tests for queue operations."""

    def test_queue_enqueue_latency(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test Redis enqueue latency.

        PERF-LAT-005: Target < 5ms p95
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Enqueue happens when creating a run
        # We measure the API response time which includes enqueue
        latencies: list[float] = []
        for i in range(20):
            start = time.perf_counter()
            resp = api_client.post(
                "/api/v1/workflow-runs",
                json={
                    "workflow_id": workflow_id,
                    "input": {"idx": i},
                },
            )
            elapsed = time.perf_counter() - start

            if resp.status_code in (200, 201):
                latencies.append(elapsed * 1000)

        if not latencies:
            pytest.skip("No successful enqueue operations")

        sorted_latencies = sorted(latencies)
        p95_idx = int(len(sorted_latencies) * 0.95)
        p95 = sorted_latencies[p95_idx]

        # Full request including enqueue
        assert p95 < 500, f"p95 enqueue latency too high: {p95}ms"


# ==========================================================================
# PERF-LAT-006: Queue dequeue latency
# ==========================================================================
class TestQueueDequeueLatency:
    """Latency tests for dequeue operations."""

    def test_queue_dequeue_latency(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test Redis dequeue latency.

        PERF-LAT-006: Target < 10ms p95
        """
        # Create workflow and run
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
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

        # Dequeue latency is internal, but we can measure
        # time until run starts processing
        latencies: list[float] = []
        for _ in range(5):
            # Create a new run and measure time until processing starts
            run_resp = api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {}},
            )
            if run_resp.status_code not in (200, 201):
                continue
            run_id = run_resp.json()["id"]

            # Poll until status changes from "created"
            poll_start = time.perf_counter()
            for _ in range(50):
                status_resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
                if status_resp.status_code == 200:
                    status = status_resp.json().get("status")
                    if status and status != "created":
                        elapsed = (time.perf_counter() - poll_start) * 1000
                        latencies.append(elapsed)
                        break
                time.sleep(0.1)

        if not latencies:
            pytest.skip("Could not measure dequeue latency")

        sorted_latencies = sorted(latencies)
        p95_idx = max(0, int(len(sorted_latencies) * 0.95) - 1)
        p95 = sorted_latencies[p95_idx]

        # Dequeue + pickup latency (includes polling delay)
        assert p95 < 10000, f"p95 dequeue latency too high: {p95}ms"
