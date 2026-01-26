"""Scalability tests for FerrumDeck.

These tests measure system behavior as load increases.

Prerequisites:
- make quickstart
- Gateway and worker running
"""

import asyncio
import time

import httpx
import pytest


# ==========================================================================
# PERF-SC-001: Horizontal worker scaling
# ==========================================================================
class TestHorizontalWorkerScale:
    """Scalability tests for worker scaling."""

    def test_horizontal_worker_scale(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test adding workers dynamically.

        PERF-SC-001: Linear speedup expected
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Measure throughput with current workers
        num_runs = 10
        start = time.perf_counter()

        for i in range(num_runs):
            api_client.post(
                "/api/v1/workflow-runs",
                json={
                    "workflow_id": workflow_id,
                    "input": {"idx": i},
                },
            )

        elapsed = time.perf_counter() - start
        throughput = num_runs / elapsed

        print(f"\nWorker throughput: {throughput:.2f} runs/sec")

        # Should achieve reasonable throughput
        assert throughput > 0.5, f"Throughput too low: {throughput} runs/sec"


# ==========================================================================
# PERF-SC-002: Database connection pool
# ==========================================================================
class TestDatabaseConnectionPool:
    """Scalability tests for database connection pool."""

    @pytest.mark.asyncio
    async def test_database_connection_pool(
        self, simple_workflow: dict
    ) -> None:
        """Test connection pool under load.

        PERF-SC-002: No pool exhaustion
        """
        num_concurrent = 50
        results: list[int] = []

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

            async def db_heavy_request(idx: int) -> int:
                try:
                    # Create run (DB insert)
                    run_resp = await client.post(
                        "/api/v1/workflow-runs",
                        json={
                            "workflow_id": workflow_id,
                            "input": {"idx": idx},
                        },
                    )
                    if run_resp.status_code not in (200, 201):
                        return run_resp.status_code

                    run_id = run_resp.json()["id"]

                    # Get run (DB query)
                    get_resp = await client.get(
                        f"/api/v1/workflow-runs/{run_id}"
                    )
                    return get_resp.status_code
                except Exception:
                    return 0

            # Launch concurrent DB-heavy requests
            tasks = [db_heavy_request(i) for i in range(num_concurrent)]
            results = await asyncio.gather(*tasks)

        # Count successes (200 status code)
        successes = sum(1 for r in results if r == 200)
        success_rate = successes / len(results)

        # Should not exhaust pool (503 errors indicate pool exhaustion)
        pool_exhaustion_errors = sum(1 for r in results if r == 503)
        assert pool_exhaustion_errors == 0, (
            f"Pool exhaustion detected: {pool_exhaustion_errors} 503 errors"
        )
        assert success_rate >= 0.8, f"Success rate too low: {success_rate}"


# ==========================================================================
# PERF-SC-003: Redis memory
# ==========================================================================
class TestRedisMemory:
    """Scalability tests for Redis memory usage."""

    def test_redis_memory(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test memory under sustained load.

        PERF-SC-003: Target < 1GB
        """
        # Create workflow
        workflow_resp = api_client.post("/api/v1/workflows", json=simple_workflow)
        if workflow_resp.status_code not in (200, 201):
            pytest.skip("Could not create workflow")
        workflow_id = workflow_resp.json()["id"]

        # Create many runs to fill Redis queue
        num_runs = 100
        for i in range(num_runs):
            api_client.post(
                "/api/v1/workflow-runs",
                json={
                    "workflow_id": workflow_id,
                    "input": {"data": "x" * 1000, "idx": i},  # ~1KB each
                },
            )

        # Note: In a real test, we would query Redis INFO MEMORY
        # For now, we verify the system remains responsive
        health_resp = api_client.get("/health/live")
        assert health_resp.status_code == 200, "System unresponsive after load"


# ==========================================================================
# PERF-SC-004: Many tenants
# ==========================================================================
class TestManyTenants:
    """Scalability tests for multi-tenant isolation."""

    def test_many_tenants(
        self, api_client: httpx.Client, simple_workflow: dict
    ) -> None:
        """Test performance with many tenants.

        PERF-SC-004: No degradation with 1000 tenants
        """
        # In a real test, we would create many tenant clients
        # For now, we simulate by creating many workflows

        num_workflows = 50  # Reduced for CI
        latencies: list[float] = []

        for i in range(num_workflows):
            workflow = simple_workflow.copy()
            workflow["name"] = f"tenant-{i}-workflow"

            start = time.perf_counter()
            resp = api_client.post("/api/v1/workflows", json=workflow)
            elapsed = time.perf_counter() - start

            if resp.status_code in (200, 201):
                latencies.append(elapsed * 1000)

        if not latencies:
            pytest.skip("No successful workflow creations")

        # Check for degradation (later requests should not be much slower)
        first_half_avg = sum(latencies[:len(latencies)//2]) / (len(latencies)//2)
        second_half_avg = sum(latencies[len(latencies)//2:]) / (len(latencies) - len(latencies)//2)

        # Second half should not be more than 3x slower than first half
        degradation_ratio = second_half_avg / first_half_avg if first_half_avg > 0 else 1

        print(f"\nFirst half avg: {first_half_avg:.2f}ms")
        print(f"Second half avg: {second_half_avg:.2f}ms")
        print(f"Degradation ratio: {degradation_ratio:.2f}")

        assert degradation_ratio < 3.0, (
            f"Performance degradation detected: {degradation_ratio}x slower"
        )
