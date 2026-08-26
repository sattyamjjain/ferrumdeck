"""Pytest fixtures for FerrumDeck chaos tests."""

import os
import subprocess
import time
import uuid
from collections.abc import Generator

import httpx
import pytest

# The project the dev seed creates (db/migrations/20241223000002_seed_dev_data.sql).
# `POST /v1/workflows` requires it; every workflow payload below omitted it and got
# a 400, so these scenarios never reached the behaviour they were written to test.
SEED_PROJECT_ID = os.getenv("FD_SEED_PROJECT_ID", "prj_01JFVX0000000000000000001")


# Test configuration
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
# The seeded dev key (db/migrations/20241223000002_seed_dev_data.sql). The old
# default "fd_test_key" is not seeded, so every authenticated chaos request 401'd
# — matching the fix already made in tests/security/conftest.py.
API_KEY = os.getenv("FD_API_KEY", "fd_dev_key_abc123")
# Agent seeded by the dev migration, with a known allowlist (git_read/...). Used
# to create a run so the enforcement path can be exercised under a fault.
SEED_AGENT_ID = os.getenv("FD_SEED_AGENT_ID", "agt_01JFVX0000000000000000001")


def wait_for_service(url: str, timeout: int = 30) -> bool:
    """Wait for the gateway to become available.

    The probe hit ``/health/live``, which the gateway does not serve — its
    health routes are ``/health`` and ``/ready`` (see
    ``rust/services/gateway/src/routes.rs``). The probe therefore never
    succeeded and ``ensure_services_running`` skipped the entire chaos suite
    unconditionally, including against a healthy stack. CHAOS-001 — the one
    test here that injects a real fault and asserts a real behaviour — has
    consequently never executed.

    The same bug was found and fixed in ``tests/security/conftest.py`` and not
    propagated here or to ``tests/e2e``. Both are fixed now.
    """
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = httpx.get(f"{url}/health", timeout=2.0)
            if resp.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


def unique_name(stem: str) -> str:
    """A workflow name no other test or run will collide with.

    THE bug behind issue #6's largest remaining cluster. Every
    workflow-creating fixture used a fixed name, and `POST /v1/workflows`
    rejects a duplicate with `400 Resource already exists`. The callers turned
    that into `pytest.skip("Could not create workflow")`, so:

      * the FIRST test to use a fixture created the workflow and ran;
      * every later test using the same fixture got a 400 and SKIPPED;
      * and on a database that had ever run the suite before, even the first
        one skipped.

    Twenty cases across `tests/security` and `tests/e2e` were skipping on this,
    reporting green while asserting nothing -- "a suite that never executes
    looks exactly like a suite that passes", which is the sentence at the top of
    .live-stack-known-failures.yml.

    `tests/performance/test_benchmark.py` already did this correctly with a
    `time.time()` suffix; the pattern simply never propagated.
    """
    return f"{stem}-{uuid.uuid4().hex[:10]}"


@pytest.fixture(scope="session", autouse=True)
def ensure_services_running() -> None:
    """Ensure required services are running before chaos tests."""
    if not wait_for_service(GATEWAY_URL, timeout=5):
        pytest.skip("Gateway service not running. Start with: make quickstart")


@pytest.fixture(scope="session")
def api_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for gateway API."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=60.0,
    ) as client:
        yield client


@pytest.fixture
def simple_workflow() -> dict:
    """Simple workflow for chaos testing."""
    return {
        "name": unique_name("chaos-test-workflow"),
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "step1",
                    "name": "Simple Step",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "system_prompt": "Respond with 'OK'.",
                        "max_tokens": 10,
                    },
                    "depends_on": [],
                },
            ],
        },
        "project_id": SEED_PROJECT_ID,
        "max_iterations": 5,
        "on_error": "fail",
    }


def run_docker_command(command: list[str], timeout: int = 30) -> tuple[bool, str]:
    """Run a docker command and return success status and output."""
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode == 0, result.stdout + result.stderr
    except subprocess.TimeoutExpired:
        return False, "Command timed out"
    except Exception as e:
        return False, str(e)


@pytest.fixture
def postgres_container() -> str:
    """Get PostgreSQL container name."""
    return os.getenv("POSTGRES_CONTAINER", "ferrumdeck-postgres-1")


@pytest.fixture
def redis_container() -> str:
    """Get Redis container name."""
    return os.getenv("REDIS_CONTAINER", "ferrumdeck-redis-1")


@pytest.fixture
def worker_container() -> str:
    """Get worker container name."""
    return os.getenv("WORKER_CONTAINER", "ferrumdeck-worker-1")


@pytest.fixture
def gateway_container() -> str:
    """Get gateway container name."""
    return os.getenv("GATEWAY_CONTAINER", "ferrumdeck-gateway-1")
