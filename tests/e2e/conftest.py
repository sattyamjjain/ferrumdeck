"""Pytest fixtures for FerrumDeck E2E tests."""

import os
import time
from typing import Generator

import httpx
import pytest

# Test configuration
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
DASHBOARD_URL = os.getenv("DASHBOARD_URL", "http://localhost:3000")

# API keys for different tenants
TENANT_A_KEY = os.getenv("TENANT_A_API_KEY", "fd_tenant_a_test_key")
TENANT_B_KEY = os.getenv("TENANT_B_API_KEY", "fd_tenant_b_test_key")


def wait_for_service(url: str, timeout: int = 30) -> bool:
    """Wait for a service to become available."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = httpx.get(f"{url}/health/live", timeout=2.0)
            if resp.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False


@pytest.fixture(scope="session", autouse=True)
def ensure_services_running():
    """Ensure required services are running before E2E tests."""
    if not wait_for_service(GATEWAY_URL, timeout=5):
        pytest.skip(
            "Gateway service not running. Start with: make quickstart"
        )


@pytest.fixture(scope="session")
def gateway_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for gateway API."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {TENANT_A_KEY}",
            "Content-Type": "application/json",
        },
        timeout=60.0,  # Longer timeout for E2E
    ) as client:
        yield client


@pytest.fixture(scope="session")
def tenant_a_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for tenant A."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {TENANT_A_KEY}",
            "Content-Type": "application/json",
        },
        timeout=60.0,
    ) as client:
        yield client


@pytest.fixture(scope="session")
def tenant_b_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for tenant B."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": f"Bearer {TENANT_B_KEY}",
            "Content-Type": "application/json",
        },
        timeout=60.0,
    ) as client:
        yield client


@pytest.fixture
def simple_agent_workflow() -> dict:
    """Simple agent workflow for testing."""
    return {
        "name": "e2e-simple-agent",
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
        "max_iterations": 5,
        "on_error": "fail",
    }


@pytest.fixture
def tool_agent_workflow() -> dict:
    """Agent workflow with tool calls."""
    return {
        "name": "e2e-tool-agent",
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
        "max_iterations": 10,
        "on_error": "fail",
    }


@pytest.fixture
def approval_agent_workflow() -> dict:
    """Agent workflow requiring approval."""
    return {
        "name": "e2e-approval-agent",
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
        "max_iterations": 10,
        "on_error": "fail",
    }


@pytest.fixture
def budget_limited_workflow() -> dict:
    """Workflow with strict budget limits."""
    return {
        "name": "e2e-budget-limited",
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
        "max_iterations": 1,
        "on_error": "fail",
        "budget": {
            "max_tokens": 10,  # Very low limit
            "max_cost_cents": 1,
        },
    }
