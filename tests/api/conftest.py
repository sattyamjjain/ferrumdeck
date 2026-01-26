"""API Contract Tests Configuration.

Provides fixtures and utilities for API schema validation tests.
"""

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

# Base paths
PROJECT_ROOT = Path(__file__).parent.parent.parent
CONTRACTS_DIR = PROJECT_ROOT / "contracts"
JSONSCHEMA_DIR = CONTRACTS_DIR / "jsonschema"
OPENAPI_DIR = CONTRACTS_DIR / "openapi"


@pytest.fixture
def run_schema() -> dict[str, Any]:
    """Load the run schema."""
    schema_path = JSONSCHEMA_DIR / "run.schema.json"
    with open(schema_path) as f:
        return json.load(f)


@pytest.fixture
def policy_schema() -> dict[str, Any]:
    """Load the policy schema."""
    schema_path = JSONSCHEMA_DIR / "policy.schema.json"
    with open(schema_path) as f:
        return json.load(f)


@pytest.fixture
def tool_schema() -> dict[str, Any]:
    """Load the tool schema."""
    schema_path = JSONSCHEMA_DIR / "tool.schema.json"
    with open(schema_path) as f:
        return json.load(f)


@pytest.fixture
def tool_version_schema() -> dict[str, Any]:
    """Load the tool version schema."""
    schema_path = JSONSCHEMA_DIR / "tool-version.schema.json"
    with open(schema_path) as f:
        return json.load(f)


@pytest.fixture
def workflow_schema() -> dict[str, Any]:
    """Load the workflow schema."""
    schema_path = JSONSCHEMA_DIR / "workflow.schema.json"
    with open(schema_path) as f:
        return json.load(f)


@pytest.fixture
def openapi_spec() -> dict[str, Any]:
    """Load the OpenAPI specification."""
    spec_path = OPENAPI_DIR / "control-plane.openapi.yaml"
    with open(spec_path) as f:
        return yaml.safe_load(f)


@pytest.fixture
def valid_run_id() -> str:
    """Generate a valid run ID."""
    return "run_01HGXK00000000000000000000"


@pytest.fixture
def valid_agent_id() -> str:
    """Generate a valid agent ID."""
    return "agt_01HGXK00000000000000000000"


@pytest.fixture
def valid_tenant_id() -> str:
    """Generate a valid tenant ID."""
    return "ten_01HGXK00000000000000000000"


@pytest.fixture
def valid_step_id() -> str:
    """Generate a valid step ID."""
    return "stp_01HGXK00000000000000000000"


@pytest.fixture
def valid_tool_id() -> str:
    """Generate a valid tool ID."""
    return "tol_01HGXK00000000000000000000"


@pytest.fixture
def sample_run(valid_run_id: str, valid_agent_id: str, valid_tenant_id: str) -> dict[str, Any]:
    """Generate a sample valid run object."""
    return {
        "id": valid_run_id,
        "agent_id": valid_agent_id,
        "tenant_id": valid_tenant_id,
        "status": "running",
        "created_at": "2024-01-01T00:00:00Z",
        "input": {"prompt": "Test prompt"},
        "output": None,
        "budget": {
            "max_input_tokens": 100000,
            "max_output_tokens": 50000,
            "max_total_tokens": 150000,
            "max_tool_calls": 50,
            "max_wall_time_ms": 300000,
            "max_cost_cents": 500,
        },
        "usage": {
            "input_tokens": 1000,
            "output_tokens": 500,
            "tool_calls": 5,
            "wall_time_ms": 10000,
            "cost_cents": 10,
        },
        "steps": [],
    }


@pytest.fixture
def sample_step(valid_step_id: str, valid_run_id: str) -> dict[str, Any]:
    """Generate a sample valid step object."""
    return {
        "id": valid_step_id,
        "run_id": valid_run_id,
        "step_type": "llm",
        "status": "completed",
        "input": {"messages": []},
        "output": {"response": "Test response"},
        "started_at": "2024-01-01T00:00:00Z",
        "completed_at": "2024-01-01T00:00:01Z",
    }


@pytest.fixture
def sample_policy() -> dict[str, Any]:
    """Generate a sample valid policy object."""
    return {
        "id": "pol_01HGXK00000000000000000000",
        "name": "Test Policy",
        "description": "A test policy",
        "rules": {
            "tool_allowlist": {
                "allowed_tools": ["read_file", "search"],
                "approval_required": ["write_file"],
                "denied_tools": ["delete_file"],
            },
            "budget": {
                "default_budget": {
                    "max_input_tokens": 100000,
                    "max_output_tokens": 50000,
                    "max_tool_calls": 50,
                },
                "enforce": True,
                "action_on_exceed": "block",
            },
        },
        "created_at": "2024-01-01T00:00:00Z",
        "updated_at": "2024-01-01T00:00:00Z",
    }


@pytest.fixture
def all_schemas(
    run_schema: dict[str, Any],
    policy_schema: dict[str, Any],
    tool_schema: dict[str, Any],
    tool_version_schema: dict[str, Any],
    workflow_schema: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Load all JSON schemas."""
    return {
        "run": run_schema,
        "policy": policy_schema,
        "tool": tool_schema,
        "tool_version": tool_version_schema,
        "workflow": workflow_schema,
    }
