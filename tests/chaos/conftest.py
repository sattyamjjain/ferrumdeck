"""Pytest fixtures for FerrumDeck chaos tests."""

import os
import subprocess
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
    """Ensure required services are running before chaos tests."""
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


@pytest.fixture
def simple_workflow() -> dict:
    """Simple workflow for chaos testing."""
    return {
        "name": "chaos-test-workflow",
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
