"""Pytest fixtures for FerrumDeck integration tests."""

import asyncio
import os
import subprocess
import time
from typing import Generator

import httpx
import pytest
import redis.asyncio as redis

# Test configuration
GATEWAY_URL = os.getenv("GATEWAY_URL", "http://localhost:8080")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
DATABASE_URL = os.getenv("DATABASE_URL", "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck")


@pytest.fixture(scope="session")
def event_loop() -> Generator[asyncio.AbstractEventLoop, None, None]:
    """Create event loop for async tests."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(scope="session")
def api_client() -> Generator[httpx.Client, None, None]:
    """Create HTTP client for API tests."""
    with httpx.Client(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": "Bearer fd_test_abc123xyz789",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    ) as client:
        yield client


@pytest.fixture(scope="session")
async def async_api_client() -> httpx.AsyncClient:
    """Create async HTTP client for API tests."""
    async with httpx.AsyncClient(
        base_url=GATEWAY_URL,
        headers={
            "Authorization": "Bearer fd_test_abc123xyz789",
            "Content-Type": "application/json",
        },
        timeout=30.0,
    ) as client:
        yield client


@pytest.fixture(scope="session")
async def redis_client() -> redis.Redis:
    """Create Redis client for queue inspection."""
    client = redis.from_url(REDIS_URL)
    yield client
    await client.aclose()


@pytest.fixture
def sample_workflow() -> dict:
    """Sample workflow definition for testing."""
    return {
        "name": "test-workflow",
        "description": "Integration test workflow",
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "init",
                    "name": "Initialize",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "system_prompt": "You are a helpful assistant.",
                        "max_tokens": 100,
                    },
                    "depends_on": [],
                },
                {
                    "id": "process",
                    "name": "Process",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "system_prompt": "Process the input.",
                        "max_tokens": 100,
                    },
                    "depends_on": ["init"],
                },
                {
                    "id": "finalize",
                    "name": "Finalize",
                    "type": "llm",
                    "config": {
                        "model": "claude-sonnet-4-20250514",
                        "system_prompt": "Finalize the output.",
                        "max_tokens": 100,
                    },
                    "depends_on": ["process"],
                },
            ],
        },
        "max_iterations": 10,
        "on_error": "fail",
    }


@pytest.fixture
def parallel_workflow() -> dict:
    """Workflow with parallel (fanout/fanin) steps."""
    return {
        "name": "parallel-test-workflow",
        "description": "Test parallel execution",
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "init",
                    "name": "Initialize",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                    "depends_on": [],
                },
                {
                    "id": "branch_a",
                    "name": "Branch A",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                    "depends_on": ["init"],
                },
                {
                    "id": "branch_b",
                    "name": "Branch B",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                    "depends_on": ["init"],
                },
                {
                    "id": "branch_c",
                    "name": "Branch C",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                    "depends_on": ["init"],
                },
                {
                    "id": "merge",
                    "name": "Merge Results",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 100},
                    "depends_on": ["branch_a", "branch_b", "branch_c"],
                },
            ],
        },
        "max_iterations": 10,
        "on_error": "fail",
    }


@pytest.fixture
def conditional_workflow() -> dict:
    """Workflow with conditional steps."""
    return {
        "name": "conditional-test-workflow",
        "description": "Test conditional execution",
        "version": "1.0.0",
        "definition": {
            "steps": [
                {
                    "id": "check",
                    "name": "Check Condition",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                    "depends_on": [],
                },
                {
                    "id": "if_true",
                    "name": "If True",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                    "depends_on": ["check"],
                    "condition": "$.check.result == true",
                },
                {
                    "id": "if_false",
                    "name": "If False",
                    "type": "llm",
                    "config": {"model": "claude-sonnet-4-20250514", "max_tokens": 50},
                    "depends_on": ["check"],
                    "condition": "$.check.result == false",
                },
            ],
        },
        "max_iterations": 10,
        "on_error": "fail",
    }


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
    """Ensure required services are running before tests."""
    if not wait_for_service(GATEWAY_URL, timeout=5):
        pytest.skip(
            "Gateway service not running. Start with: cargo run --package gateway"
        )
