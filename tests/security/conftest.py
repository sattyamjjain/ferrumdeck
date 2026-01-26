"""Pytest fixtures for FerrumDeck security tests."""

import os
import time
from typing import Generator

import httpx
import pytest

# Test configuration
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
VALID_API_KEY = os.getenv("FD_API_KEY", "fd_test_key")
ADMIN_API_KEY = os.getenv("FD_ADMIN_API_KEY", "fd_admin_key")
READ_ONLY_API_KEY = os.getenv("FD_READ_ONLY_API_KEY", "fd_readonly_key")


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
    """Ensure required services are running before security tests."""
    if not wait_for_service(GATEWAY_URL, timeout=5):
        pytest.skip(
            "Gateway service not running. Start with: make quickstart"
        )


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
        "max_iterations": 5,
        "on_error": "fail",
    }
