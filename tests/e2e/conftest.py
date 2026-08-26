"""Pytest fixtures for FerrumDeck E2E tests."""

import os
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
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "http://localhost:3000")

# The seeded dev key (db/migrations/20241223000002_seed_dev_data.sql), used for
# single-tenant flows. `gateway_client` previously used TENANT_A_KEY, whose
# default is not seeded, so every authenticated request 401'd — the same class
# of silent no-op already fixed in tests/security/conftest.py.
GATEWAY_API_KEY = os.getenv("FD_API_KEY", "fd_dev_key_abc123")

# Agent seeded by the dev migration, with a known allowlist
# (git_read / git_write / test_run / github_create_pr).
SEED_AGENT_ID = os.getenv("FD_SEED_AGENT_ID", "agt_01JFVX0000000000000000001")

# API keys for the multi-tenant isolation tests. These genuinely need two
# separately-seeded tenants; they stay unseeded by default and those tests
# should skip rather than pretend.
TENANT_A_KEY = os.getenv("TENANT_A_API_KEY", "fd_tenant_a_test_key")
TENANT_B_KEY = os.getenv("TENANT_B_API_KEY", "fd_tenant_b_test_key")


def wait_for_service(url: str, timeout: int = 30) -> bool:
    """Wait for the gateway to become available.

    The probe hit ``/health/live``, which the gateway does not serve — its
    health routes are ``/health`` and ``/ready``. The probe never succeeded, so
    ``ensure_services_running`` skipped the whole E2E suite unconditionally,
    even against a healthy stack. Same bug as ``tests/chaos/conftest.py``;
    already fixed in ``tests/security/conftest.py`` and never propagated.
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
def ensure_services_running():
    """Ensure required services are running before E2E tests."""
    if not wait_for_service(GATEWAY_URL, timeout=5):
        pytest.skip("Gateway service not running. Start with: make quickstart")


@pytest.fixture(scope="session")
def gateway_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for gateway API, authenticated with the seeded key."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {GATEWAY_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=60.0,  # Longer timeout for E2E
    ) as client:
        yield client


def _tenant_client(key: str, label: str) -> Generator[httpx.Client, None, None]:
    """Client for a separately-seeded tenant, or a skip if it is not seeded.

    The module docstring already says these keys "stay unseeded by default and
    those tests should skip rather than pretend" -- but nothing enforced it, so
    the fixture handed back a client whose every request 401s and the tests
    failed on the auth error instead of skipping. A red suite for a tenant the
    operator never created is noise, and noise is what gets a suite pulled out
    of CI.

    The probe is one request per session. A 401/403 means the key is not
    seeded, which is a statement about the fixture data, not about the gateway.
    """
    client = httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        timeout=60.0,
    )
    try:
        probe = client.get("/v1/workflows")
    except httpx.HTTPError as exc:  # gateway not reachable at all
        client.close()
        pytest.skip(f"gateway unreachable while probing {label}: {exc}")
    if probe.status_code in (401, 403):
        client.close()
        pytest.skip(
            f"{label} is not seeded in this stack (set {label} to a real key to "
            "exercise the multi-tenant isolation tests)"
        )
    try:
        yield client
    finally:
        client.close()


@pytest.fixture(scope="session")
def tenant_a_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for tenant A."""
    yield from _tenant_client(TENANT_A_KEY, "TENANT_A_API_KEY")


@pytest.fixture(scope="session")
def tenant_b_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for tenant B."""
    yield from _tenant_client(TENANT_B_KEY, "TENANT_B_API_KEY")


@pytest.fixture
def simple_agent_workflow() -> dict:
    """Simple agent workflow for testing."""
    return {
        "name": unique_name("e2e-simple-agent"),
        "description": "Simple agent for E2E testing",
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "think",
                    "name": "Think Step",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "system_prompt": "You are a helpful assistant. Respond briefly.",
                        "max_tokens": 100,
                    },
                    "depends_on": [],
                },
            ],
        },
        "project_id": SEED_PROJECT_ID,
        "max_iterations": 5,
        "on_error": "fail",
    }


@pytest.fixture
def tool_agent_workflow() -> dict:
    """Agent workflow with tool calls."""
    return {
        "name": unique_name("e2e-tool-agent"),
        "description": "Agent with tool calls for E2E testing",
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "plan",
                    "name": "Plan Step",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "system_prompt": "Plan the task.",
                        "max_tokens": 100,
                    },
                    "depends_on": [],
                },
                {
                    "id": "execute",
                    "name": "Execute Step",
                    "type": "tool",
                    "config": {
                        "tool_name": "read_file",
                        "tool_input": {"path": "/tmp/test.txt"},
                    },
                    "depends_on": ["plan"],
                },
            ],
        },
        "project_id": SEED_PROJECT_ID,
        "max_iterations": 10,
        "on_error": "fail",
    }


@pytest.fixture
def approval_agent_workflow() -> dict:
    """Agent workflow requiring approval."""
    return {
        "name": unique_name("e2e-approval-agent"),
        "description": "Agent requiring approval for E2E testing",
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "propose",
                    "name": "Propose Changes",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "max_tokens": 100,
                    },
                    "depends_on": [],
                },
                {
                    "id": "approval",
                    "name": "Wait for Approval",
                    "type": "approval",
                    "config": {
                        "approval_message": "Please approve these changes",
                    },
                    "depends_on": ["propose"],
                },
                {
                    "id": "apply",
                    "name": "Apply Changes",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "max_tokens": 100,
                    },
                    "depends_on": ["approval"],
                },
            ],
        },
        "project_id": SEED_PROJECT_ID,
        "max_iterations": 10,
        "on_error": "fail",
    }


@pytest.fixture
def budget_limited_workflow() -> dict:
    """Workflow with strict budget limits."""
    return {
        "name": unique_name("e2e-budget-limited"),
        "description": "Budget-limited workflow",
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "expensive",
                    "name": "Expensive Step",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "max_tokens": 1000,
                    },
                    "depends_on": [],
                },
            ],
        },
        "project_id": SEED_PROJECT_ID,
        "max_iterations": 1,
        "on_error": "fail",
        "budget": {
            "max_tokens": 10,  # Very low limit
            "max_cost_cents": 1,
        },
    }
