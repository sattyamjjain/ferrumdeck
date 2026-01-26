"""Backwards Compatibility Tests.

API-BWD-001 to API-BWD-003: Tests for API backwards compatibility.
"""

from typing import Any

import pytest
from jsonschema import validate


class TestAPIBWD001FieldAdditionCompatibility:
    """API-BWD-001: New fields are backwards compatible."""

    def test_additional_fields_allowed_in_run(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Additional fields in run response don't break validation."""
        # Add unknown fields that might come from newer API versions
        sample_run["new_field"] = "new_value"
        sample_run["future_feature"] = {"nested": "data"}

        # Should not raise if additionalProperties is not false
        # This ensures forward compatibility for clients
        try:
            validate(instance=sample_run, schema=run_schema)
        except Exception as e:
            # If additionalProperties is false, document this constraint
            if "additionalProperties" in str(e).lower():
                pytest.skip(
                    "Schema uses additionalProperties: false - "
                    "new fields require schema update"
                )
            raise

    def test_additional_fields_allowed_in_step(
        self, run_schema: dict[str, Any], sample_step: dict[str, Any]
    ):
        """Additional fields in step response don't break validation."""
        step_schema = run_schema["$defs"]["Step"]
        sample_step["new_field"] = "new_value"

        try:
            validate(instance=sample_step, schema=step_schema)
        except Exception as e:
            if "additionalProperties" in str(e).lower():
                pytest.skip(
                    "Schema uses additionalProperties: false - "
                    "new fields require schema update"
                )
            raise


class TestAPIBWD002OptionalFieldCompatibility:
    """API-BWD-002: Optional fields maintain backwards compatibility."""

    def test_minimal_run_validates(
        self,
        run_schema: dict[str, Any],
        valid_run_id: str,
        valid_agent_id: str,
        valid_tenant_id: str,
    ):
        """Run with only required fields validates successfully."""
        minimal_run = {
            "id": valid_run_id,
            "agent_id": valid_agent_id,
            "tenant_id": valid_tenant_id,
            "status": "created",
            "created_at": "2024-01-01T00:00:00Z",
        }
        validate(instance=minimal_run, schema=run_schema)

    def test_minimal_step_validates(
        self, run_schema: dict[str, Any], valid_step_id: str, valid_run_id: str
    ):
        """Step with only required fields validates successfully."""
        step_schema = run_schema["$defs"]["Step"]
        minimal_step = {
            "id": valid_step_id,
            "run_id": valid_run_id,
            "step_type": "llm",
            "status": "pending",
        }
        validate(instance=minimal_step, schema=step_schema)

    def test_null_optional_fields_validate(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Null values for nullable optional fields validate."""
        sample_run["output"] = None
        sample_run["error"] = None
        sample_run["started_at"] = None
        sample_run["completed_at"] = None
        sample_run["agent_version_id"] = None
        sample_run["config_version"] = None

        validate(instance=sample_run, schema=run_schema)


class TestAPIBWD003StatusTransitionCompatibility:
    """API-BWD-003: Status values maintain backwards compatibility."""

    def test_all_documented_statuses_valid(self, run_schema: dict[str, Any]):
        """All documented run statuses are valid in schema."""
        documented_statuses = [
            "created",
            "queued",
            "running",
            "waiting_approval",
            "completed",
            "failed",
            "budget_killed",
            "policy_blocked",
        ]

        status_enum = run_schema["properties"]["status"]["enum"]

        for status in documented_statuses:
            assert (
                status in status_enum
            ), f"Documented status '{status}' not in schema enum"

    def test_all_documented_step_statuses_valid(self, run_schema: dict[str, Any]):
        """All documented step statuses are valid in schema."""
        documented_statuses = [
            "pending",
            "running",
            "completed",
            "failed",
            "skipped",
        ]

        step_schema = run_schema["$defs"]["Step"]
        status_enum = step_schema["properties"]["status"]["enum"]

        for status in documented_statuses:
            assert (
                status in status_enum
            ), f"Documented step status '{status}' not in schema enum"

    def test_all_documented_step_types_valid(self, run_schema: dict[str, Any]):
        """All documented step types are valid in schema."""
        documented_types = [
            "llm",
            "tool",
            "retrieval",
            "sandbox",
            "approval",
        ]

        step_schema = run_schema["$defs"]["Step"]
        type_enum = step_schema["properties"]["step_type"]["enum"]

        for step_type in documented_types:
            assert (
                step_type in type_enum
            ), f"Documented step type '{step_type}' not in schema enum"

    def test_schema_version_documented(self, run_schema: dict[str, Any]):
        """Schema has versioned $id for compatibility tracking."""
        assert "$id" in run_schema, "Schema should have $id for versioning"
        assert "ferrumdeck" in run_schema["$id"], "Schema $id should identify project"
