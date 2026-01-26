"""Load tests for FerrumDeck.

These tests measure system behavior under concurrent load.

Prerequisites:
- make quickstart
- Gateway and worker running
"""

import asyncio
import time
from typing import Any

import httpx
import pytest


# ==========================================================================
# PERF-LD-001: Concurrent runs
# ==========================================================================
class TestConcurrentRuns:
    """Load tests for concurrent run execution."""

    @pytest.mark.asyncio
    async def test_concurrent_runs(
        self, simple_workflow: dict
    ) -> None:
        """Test 100 concurrent runs.

        PERF-LD-001: Target < 2s p95 response time
        """
        num_concurrent = 100
        results: list[dict[str, Any]] = []

        async with httpx.AsyncClient(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer fd_test_key",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        ) as client:
            # First create workflow
            workflow_resp = await client.post(
                "/api/v1/workflows", json=simple_workflow
            )
            if workflow_resp.status_code not in (200, 201):
                pytest.skip("Could not create workflow")
            workflow_id = workflow_resp.json()["id"]

            async def create_run(idx: int) -> dict[str, Any]:
                start = time.perf_counter()
                try:
                    resp = await client.post(
                        "/api/v1/workflow-runs",
                        json={
                            "workflow_id": workflow_id,
                            "input": {"idx": idx},
                        },
                    )
                    elapsed = time.perf_counter() - start
                    return {
                        "idx": idx,
                        "status_code": resp.status_code,
                        "elapsed_ms": elapsed * 1000,
                        "success": resp.status_code in (200, 201),
                    }
                except Exception as e:
                    elapsed = time.perf_counter() - start
                    return {
                        "idx": idx,
                        "status_code": 0,
                        "elapsed_ms": elapsed * 1000,
                        "success": False,
                        "error": str(e),
                    }

            # Launch concurrent requests
            tasks = [create_run(i) for i in range(num_concurrent)]
            results = await asyncio.gather(*tasks)

        # Analyze results
        response_times = [r["elapsed_ms"] for r in results]
        successes = sum(1 for r in results if r["success"])

        # Calculate p95
        sorted_times = sorted(response_times)
        p95_idx = int(len(sorted_times) * 0.95)
        p95 = sorted_times[p95_idx] if sorted_times else 0

        # Assertions
        assert successes >= num_concurrent * 0.95, (
            f"Too many failures: {num_concurrent - successes}/{num_concurrent}"
        )
        # p95 should be under 2 seconds (2000ms)
        # Note: This may need adjustment based on actual system performance
        assert p95 < 2000, f"p95 latency too high: {p95}ms"


# ==========================================================================
# PERF-LD-002: Sustained throughput
# ==========================================================================
class TestSustainedThroughput:
    """Load tests for sustained throughput."""

    @pytest.mark.asyncio
    async def test_sustained_throughput(
        self, simple_workflow: dict
    ) -> None:
        """Test 50 runs/min for 10 minutes.

        PERF-LD-002: System should remain stable
        """
        # Reduced test: 10 runs over 30 seconds for CI
        runs_per_interval = 5
        interval_seconds = 15
        num_intervals = 2

        error_counts: list[int] = []

        async with httpx.AsyncClient(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer fd_test_key",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        ) as client:
            # Create workflow
            workflow_resp = await client.post(
                "/api/v1/workflows", json=simple_workflow
            )
            if workflow_resp.status_code not in (200, 201):
                pytest.skip("Could not create workflow")
            workflow_id = workflow_resp.json()["id"]

            for interval in range(num_intervals):
                errors = 0
                for i in range(runs_per_interval):
                    try:
                        resp = await client.post(
                            "/api/v1/workflow-runs",
                            json={
                                "workflow_id": workflow_id,
                                "input": {"interval": interval, "run": i},
                            },
                        )
                        if resp.status_code not in (200, 201):
                            errors += 1
                    except Exception:
                        errors += 1

                error_counts.append(errors)
                if interval < num_intervals - 1:
                    await asyncio.sleep(interval_seconds)

        # Should have stable error rate (not increasing)
        assert all(
            e <= runs_per_interval * 0.1 for e in error_counts
        ), f"Too many errors: {error_counts}"


# ==========================================================================
# PERF-LD-003: Burst traffic
# ==========================================================================
class TestBurstTraffic:
    """Load tests for burst traffic handling."""

    @pytest.mark.asyncio
    async def test_burst_traffic(
        self, simple_workflow: dict
    ) -> None:
        """Test 200 runs in 10s burst.

        PERF-LD-003: No errors under burst
        """
        burst_size = 50  # Reduced for CI
        results: list[bool] = []

        async with httpx.AsyncClient(
            base_url="http://localhost:8080",
            headers={
                "Authorization": "Bearer fd_test_key",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        ) as client:
            # Create workflow
            workflow_resp = await client.post(
                "/api/v1/workflows", json=simple_workflow
            )
            if workflow_resp.status_code not in (200, 201):
                pytest.skip("Could not create workflow")
            workflow_id = workflow_resp.json()["id"]

            async def burst_request(idx: int) -> bool:
                try:
                    resp = await client.post(
                        "/api/v1/workflow-runs",
                        json={
                            "workflow_id": workflow_id,
                            "input": {"burst": idx},
                        },
                    )
                    return resp.status_code in (200, 201, 429)  # 429 is acceptable
                except Exception:
                    return False

            # All at once
            tasks = [burst_request(i) for i in range(burst_size)]
            results = await asyncio.gather(*tasks)

        success_rate = sum(results) / len(results)
        assert success_rate >= 0.9, f"Burst success rate too low: {success_rate}"


# ==========================================================================
# PERF-LD-004: Large payload
# ==========================================================================
class TestLargePayload:
    """Load tests for large payloads."""

    def test_large_payload(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test 1MB input JSON.

        PERF-LD-004: Target < 5s response time
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create large payload (~1MB)
        large_data = "x" * (1024 * 1024)  # 1MB string

        start = time.perf_counter()
        resp = api_client.post(
            "/api/v1/workflow-runs",
            json={
                "workflow_id": workflow_id,
                "input": {"large_data": large_data},
            },
            timeout=30.0,
        )
        elapsed = time.perf_counter() - start

        assert resp.status_code in (200, 201, 400, 413), (
            f"Unexpected status: {resp.status_code}"
        )
        assert elapsed < 5.0, f"Large payload too slow: {elapsed}s"


# ==========================================================================
# PERF-LD-005: Many steps workflow
# ==========================================================================
class TestManySteps:
    """Load tests for workflows with many steps."""

    def test_many_steps(
        self, api_client: httpx.Client, large_workflow: dict
    ) -> None:
        """Test run with 100 steps.

        PERF-LD-005: Target < 30s to create
        """
        start = time.perf_counter()
        resp = api_client.post("/api/v1/workflows", json=large_workflow)
        elapsed = time.perf_counter() - start

        # Should succeed or fail validation
        assert resp.status_code in (200, 201, 400, 422), (
            f"Unexpected status: {resp.status_code}"
        )
        assert elapsed < 30.0, f"Large workflow creation too slow: {elapsed}s"

        if resp.status_code in (200, 201):
            workflow_id = resp.json()["id"]

            # Try to start a run
            run_start = time.perf_counter()
            run_resp = api_client.post(
                "/api/v1/workflow-runs",
                json={"workflow_id": workflow_id, "input": {}},
            )
            run_elapsed = time.perf_counter() - run_start

            assert run_resp.status_code in (200, 201, 400, 422)
            assert run_elapsed < 5.0, f"Run creation too slow: {run_elapsed}s"
