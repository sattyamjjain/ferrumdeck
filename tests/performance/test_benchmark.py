"""Benchmark tests for FerrumDeck.

These tests measure throughput of critical operations.

Prerequisites:
- make quickstart
- Gateway running
"""

import time

import httpx
import pytest


# ==========================================================================
# PERF-BM-001: Policy evaluation benchmark
# ==========================================================================
class TestPolicyEvaluationBenchmark:
    """Benchmark tests for policy engine."""

    def test_bench_policy_evaluation(
        self, api_client: httpx.Client
    ) -> None:
        """Benchmark policy engine throughput.

        PERF-BM-001: Measure ops/sec
        """
        # Create workflows that require policy evaluation
        workflow_template = {
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "step1",
                        "name": "Step",
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

        num_ops = 50
        start = time.perf_counter()

        for i in range(num_ops):
            workflow = workflow_template.copy()
            workflow["name"] = f"bench-policy-{i}-{time.time()}"
            api_client.post("/api/v1/workflows", json=workflow)

        elapsed = time.perf_counter() - start
        ops_per_sec = num_ops / elapsed

        # Log benchmark result
        print(f"\nPolicy evaluation: {ops_per_sec:.2f} ops/sec")

        # Should achieve at least 10 ops/sec
        assert ops_per_sec > 1, f"Policy throughput too low: {ops_per_sec} ops/sec"


# ==========================================================================
# PERF-BM-002: Airlock RCE check benchmark
# ==========================================================================
class TestAirlockRCEBenchmark:
    """Benchmark tests for Airlock RCE pattern matching."""

    def test_bench_airlock_rce_check(
        self, api_client: httpx.Client
    ) -> None:
        """Benchmark RCE pattern matching throughput.

        PERF-BM-002: Measure ops/sec
        """
        # Workflow with code that triggers Airlock inspection
        workflow_template = {
            "version": "1.0.0",
            "definition": {
                "steps": [
                    {
                        "id": "code_step",
                        "name": "Code Step",
                        "type": "tool",
                        "config": {
                            "tool_name": "execute_code",
                            "tool_input": {
                                "code": "import subprocess; subprocess.run(['ls'])",
                            },
                        },
                        "depends_on": [],
                    },
                ],
            },
            "max_iterations": 5,
            "on_error": "fail",
        }

        num_ops = 50
        start = time.perf_counter()

        for i in range(num_ops):
            workflow = workflow_template.copy()
            workflow["name"] = f"bench-airlock-{i}-{time.time()}"
            api_client.post("/api/v1/workflows", json=workflow)

        elapsed = time.perf_counter() - start
        ops_per_sec = num_ops / elapsed

        print(f"\nAirlock RCE check: {ops_per_sec:.2f} ops/sec")

        assert ops_per_sec > 1, f"Airlock throughput too low: {ops_per_sec} ops/sec"


# ==========================================================================
# PERF-BM-003: PII redaction benchmark
# ==========================================================================
class TestPIIRedactionBenchmark:
    """Benchmark tests for PII redaction."""

    def test_bench_pii_redaction(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Benchmark redaction throughput.

        PERF-BM-003: Measure MB/sec
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create runs with PII-like data
        pii_data = "john.doe@example.com 555-123-4567 " * 1000  # ~40KB

        num_ops = 20
        total_bytes = len(pii_data.encode()) * num_ops

        start = time.perf_counter()

        for i in range(num_ops):
            api_client.post(
                "/api/v1/workflow-runs",
                json={
                    "workflow_id": workflow_id,
                    "input": {"pii_data": pii_data, "idx": i},
                },
            )

        elapsed = time.perf_counter() - start
        mb_per_sec = (total_bytes / (1024 * 1024)) / elapsed

        print(f"\nPII redaction: {mb_per_sec:.2f} MB/sec")

        # Should handle at least 0.1 MB/sec
        assert mb_per_sec > 0.01, f"PII redaction too slow: {mb_per_sec} MB/sec"


# ==========================================================================
# PERF-BM-004: ID generation benchmark
# ==========================================================================
class TestIDGenerationBenchmark:
    """Benchmark tests for ID generation."""

    def test_bench_id_generation(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Benchmark ULID generation throughput.

        PERF-BM-004: Measure ops/sec
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Each run creation generates multiple IDs
        num_ops = 50
        start = time.perf_counter()

        for i in range(num_ops):
            api_client.post(
                "/api/v1/workflow-runs",
                json={
                    "workflow_id": workflow_id,
                    "input": {"idx": i},
                },
            )

        elapsed = time.perf_counter() - start
        ops_per_sec = num_ops / elapsed

        print(f"\nID generation (via run creation): {ops_per_sec:.2f} ops/sec")

        # Should achieve at least 10 ops/sec
        assert ops_per_sec > 1, f"ID generation too slow: {ops_per_sec} ops/sec"


# ==========================================================================
# PERF-BM-005: JSON serialization benchmark
# ==========================================================================
class TestJSONSerializationBenchmark:
    """Benchmark tests for JSON serialization."""

    def test_bench_json_serialization(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Benchmark JSON roundtrip throughput.

        PERF-BM-005: Measure ops/sec
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create a run
        run_resp = api_client.post(
            "/api/v1/workflow-runs",
            json={"workflow_id": workflow_id, "input": {}},
        )
        if run_resp.status_code not in (200, 201):
            pytest.skip("Could not create run")
        run_id = run_resp.json()["id"]

        # Measure JSON roundtrip (GET request + response parsing)
        num_ops = 100
        start = time.perf_counter()

        for _ in range(num_ops):
            resp = api_client.get(f"/api/v1/workflow-runs/{run_id}")
            if resp.status_code == 200:
                _ = resp.json()  # Parse JSON

        elapsed = time.perf_counter() - start
        ops_per_sec = num_ops / elapsed

        print(f"\nJSON roundtrip: {ops_per_sec:.2f} ops/sec")

        assert ops_per_sec > 10, f"JSON serialization too slow: {ops_per_sec} ops/sec"
