"""Pytest fixtures for FerrumDeck security tests.

These tests run against a live gateway (`make quickstart`) and are excluded from
the CI-gating count. Two things previously made the whole suite a no-op:

* the readiness probe hit ``/health/live``, which the gateway does not serve
  (its health routes are ``/health`` and ``/ready``), so `ensure_services_running`
  skipped **unconditionally** — even against a running gateway; and
* the default API key was ``fd_test_key``, which is not the seeded dev key.

Both are fixed here so the suite actually exercises the gateway. The gateway API
is served under ``/v1`` (``/api/v1`` is the Next.js BFF, a different service);
behavioural tests below therefore call ``/v1/...`` directly.
"""

import os
import time
from collections.abc import Generator

import httpx
import pytest

# The project the dev seed creates (db/migrations/20241223000002_seed_dev_data.sql).
# `POST /v1/workflows` requires it; every workflow payload below omitted it and got
# a 400, so these scenarios never reached the behaviour they were written to test.
SEED_PROJECT_ID = os.getenv("FD_SEED_PROJECT_ID", "prj_01JFVX0000000000000000001")


# Test configuration
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
# The seeded dev key (db/migrations/20241223000002_seed_dev_data.sql), scopes
# read/write/admin. Override with FD_API_KEY for a differently-seeded stack.
VALID_API_KEY = os.getenv("FD_API_KEY", "fd_dev_key_abc123")
ADMIN_API_KEY = os.getenv("FD_ADMIN_API_KEY", "fd_dev_key_abc123")
READ_ONLY_API_KEY = os.getenv("FD_READ_ONLY_API_KEY", "fd_dev_key_abc123")

# Agent seeded by the dev migration, with a known allowlist
# (git_read / git_write / test_run / github_create_pr). Used to create a run so
# the enforcement path (`/v1/runs/{id}/check-tool`) can be exercised.
SEED_AGENT_ID = os.getenv("FD_SEED_AGENT_ID", "agt_01JFVX0000000000000000001")


def wait_for_service(url: str, timeout: int = 30) -> bool:
    """Wait for the gateway to become available (its health route is `/health`)."""
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


@pytest.fixture(scope="session", autouse=True)
def ensure_services_running() -> None:
    """Ensure required services are running before security tests."""
    if not wait_for_service(GATEWAY_URL, timeout=5):
        pytest.skip("Gateway service not running. Start with: make quickstart")


@pytest.fixture(scope="session")
def api_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client with valid authentication."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {VALID_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    ) as client:
        yield client


@pytest.fixture(scope="session")
def admin_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client with admin authentication."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {ADMIN_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    ) as client:
        yield client


@pytest.fixture(scope="session")
def readonly_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client with read-only authentication."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {READ_ONLY_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    ) as client:
        yield client


@pytest.fixture(scope="session")
def unauthenticated_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client without authentication."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={"Content-Type": "application/json"},
        timeout=30.0,
    ) as client:
        yield client


@pytest.fixture
def created_run(api_client: httpx.Client) -> str:
    """Create a run against the seeded agent and return its id.

    The Airlock enforcement path is `POST /v1/runs/{run_id}/check-tool`, so a
    behavioural test needs a real run to check tools against. Fails loudly if the
    run cannot be created — a security test must not silently pass when its setup
    is broken.
    """
    resp = api_client.post(
        "/v1/runs",
        json={"agent_id": SEED_AGENT_ID, "input": {"task": "security-test"}},
    )
    assert resp.status_code in (200, 201), (
        f"could not create run for the seeded agent {SEED_AGENT_ID}: {resp.status_code} {resp.text}"
    )
    run_id = resp.json()["id"]
    assert run_id
    return run_id


@pytest.fixture
def check_tool(api_client: httpx.Client):
    """Return a helper that calls the enforcement endpoint and returns the JSON.

    The response carries `allowed`, `blocked_by_airlock`, `risk_score`,
    `risk_level`, and `violation_type` (present whenever Airlock detects a
    violation, in shadow OR enforce mode). `violation_type` is the gateway's
    debug-lowercased form of the Rust `ViolationType` variant — e.g.
    `RcePattern` -> "rcepattern", `ExfiltrationAttempt` -> "exfiltrationattempt",
    `IpAddressUsed` -> "ipaddressused".
    """

    def _check(run_id: str, tool_name: str, tool_input: dict) -> dict:
        resp = api_client.post(
            f"/v1/runs/{run_id}/check-tool",
            json={"tool_name": tool_name, "tool_input": tool_input},
        )
        assert resp.status_code == 200, (
            f"check-tool should evaluate the call, got {resp.status_code}: {resp.text}"
        )
        return resp.json()

    return _check


@pytest.fixture
def simple_workflow() -> dict:
    """Simple workflow for security testing."""
    return {
        "name": "security-test-workflow",
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
