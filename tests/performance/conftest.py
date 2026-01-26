"""Pytest fixtures for FerrumDeck performance tests."""

import os
import time
from typing import Generator

import httpx
import pytest

# Test configuration
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
API_KEY = os.getenv("FD_API_KEY", "fd_test_key")


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
def ensure_services_running() -> None:
    """Ensure required services are running before perf tests."""
    if not wait_for_service(GATEWAY_URL, timeout=5):
        pytest.skip(
            "Gateway service not running. Start with: make quickstart"
        )


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


@pytest.fixture(scope="session")
def async_client_config() -> dict:
    """Configuration for async HTTP client."""
    return {
        "base_url": GATEWAY_URL,
        "headers": {
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        "timeout": 60.0,
    }


@pytest.fixture
def simple_workflow() -> dict:
    """Simple workflow for performance testing."""
    return {
        "name": "perf-test-workflow",
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
        "max_iterations": 5,
        "on_error": "fail",
    }


@pytest.fixture
def large_workflow() -> dict:
    """Workflow with many steps for scalability testing."""
    steps = []
    for i in range(100):
        step = {
            "id": f"step_{i}",
            "name": f"Step {i}",
            "type": "llm",
            "config": {
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 10,
            },
            "depends_on": [f"step_{i-1}"] if i > 0 else [],
        }
        steps.append(step)

    return {
        "name": "perf-large-workflow",
        "version": "1.0.0",
        "definition": {"steps": steps},
        "max_iterations": 200,
        "on_error": "fail",
    }
