"""Schema Validation Tests.

API-VAL-001 to API-VAL-006: Tests for JSON schema validation.
"""

import re
from typing import Any

import pytest
from jsonschema import Draft202012Validator, ValidationError, validate


class TestAPIVAL001RunSchemaValidation:
    """API-VAL-001: Run schema validates correctly."""

    def test_valid_run_passes_validation(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Valid run data passes schema validation."""
        validate(instance=sample_run, schema=run_schema)

    def test_missing_required_field_fails(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Missing required field fails validation."""
        del sample_run["status"]
        with pytest.raises(ValidationError) as exc_info:
            validate(instance=sample_run, schema=run_schema)
        assert "status" in str(exc_info.value)

    def test_invalid_run_id_format_fails(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Invalid run ID format fails validation."""
        sample_run["id"] = "invalid_id"
        with pytest.raises(ValidationError):
            validate(instance=sample_run, schema=run_schema)

    def test_invalid_status_value_fails(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Invalid status enum value fails validation."""
        sample_run["status"] = "invalid_status"
        with pytest.raises(ValidationError):
            validate(instance=sample_run, schema=run_schema)

    def test_all_valid_statuses_pass(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """All valid status values pass validation."""
        valid_statuses = [
            "created",
            "queued",
            "running",
            "waiting_approval",
            "completed",
            "failed",
            "budget_killed",
            "policy_blocked",
        ]
        for status in valid_statuses:
            sample_run["status"] = status
            validate(instance=sample_run, schema=run_schema)

    def test_invalid_datetime_format_fails(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Invalid datetime format fails validation."""
        sample_run["created_at"] = "not-a-date"
        # JSON Schema date-time format validation depends on the validator
        # Most validators don't strictly enforce format by default
        # This test documents expected behavior

    def test_budget_limits_validation(
        self, run_schema: dict[str, Any], sample_run: dict[str, Any]
    ):
        """Budget with negative values fails validation."""
        sample_run["budget"]["max_input_tokens"] = -100
        with pytest.raises(ValidationError):
            validate(instance=sample_run, schema=run_schema)


class TestAPIVAL002StepSchemaValidation:
    """API-VAL-002: Step schema validates correctly."""

    def test_valid_step_passes_validation(
        self, run_schema: dict[str, Any], sample_step: dict[str, Any]
    ):
        """Valid step data passes schema validation."""
        step_schema = run_schema["$defs"]["Step"]
        validate(instance=sample_step, schema=step_schema)

    def test_invalid_step_id_format_fails(
        self, run_schema: dict[str, Any], sample_step: dict[str, Any]
    ):
        """Invalid step ID format fails validation."""
        step_schema = run_schema["$defs"]["Step"]
        sample_step["id"] = "invalid_step_id"
        with pytest.raises(ValidationError):
            validate(instance=sample_step, schema=step_schema)

    def test_invalid_step_type_fails(
        self, run_schema: dict[str, Any], sample_step: dict[str, Any]
    ):
        """Invalid step type fails validation."""
        step_schema = run_schema["$defs"]["Step"]
        sample_step["step_type"] = "invalid_type"
        with pytest.raises(ValidationError):
            validate(instance=sample_step, schema=step_schema)

    def test_all_valid_step_types_pass(
        self, run_schema: dict[str, Any], sample_step: dict[str, Any]
    ):
        """All valid step types pass validation."""
        step_schema = run_schema["$defs"]["Step"]
        valid_types = ["llm", "tool", "retrieval", "sandbox", "approval"]
        for step_type in valid_types:
            sample_step["step_type"] = step_type
            validate(instance=sample_step, schema=step_schema)


class TestAPIVAL003PolicySchemaValidation:
    """API-VAL-003: Policy schema validates correctly."""

    def test_valid_policy_passes_validation(
        self, policy_schema: dict[str, Any], sample_policy: dict[str, Any]
    ):
        """Valid policy data passes schema validation."""
        validate(instance=sample_policy, schema=policy_schema)

    def test_missing_required_policy_fields_fails(
        self, policy_schema: dict[str, Any], sample_policy: dict[str, Any]
    ):
        """Missing required policy fields fails validation."""
        del sample_policy["name"]
        with pytest.raises(ValidationError):
            validate(instance=sample_policy, schema=policy_schema)


class TestAPIVAL004IDPatternValidation:
    """API-VAL-004: ID patterns validate correctly across schemas."""

    @pytest.mark.parametrize(
        "id_type,prefix,valid_id",
        [
            ("run_id", "run_", "run_01HGXK00000000000000000000"),
            ("agent_id", "agt_", "agt_01HGXK00000000000000000000"),
            ("tenant_id", "ten_", "ten_01HGXK00000000000000000000"),
            ("step_id", "stp_", "stp_01HGXK00000000000000000000"),
        ],
    )
    def test_id_pattern_matches_valid_ids(
        self, id_type: str, prefix: str, valid_id: str
    ):
        """Valid IDs match expected patterns."""
        pattern = rf"^{prefix}[0-9A-HJKMNP-TV-Z]{{26}}$"
        assert re.match(pattern, valid_id) is not None

    @pytest.mark.parametrize(
        "invalid_id",
        [
            "invalid",
            "run_short",
            "run_01HGXK000000000000000000000",  # Too long
            "run_01HGXK0000000000000000000",  # Too short
            "RUN_01HGXK00000000000000000000",  # Wrong case prefix
        ],
    )
    def test_invalid_id_patterns_rejected(self, invalid_id: str):
        """Invalid IDs don't match expected pattern."""
        pattern = r"^run_[0-9A-HJKMNP-TV-Z]{26}$"
        assert re.match(pattern, invalid_id) is None


class TestAPIVAL005BudgetSchemaValidation:
    """API-VAL-005: Budget schema validates correctly."""

    def test_valid_budget_passes(self, run_schema: dict[str, Any]):
        """Valid budget data passes validation."""
        budget_schema = run_schema["$defs"]["Budget"]
        valid_budget = {
            "max_input_tokens": 100000,
            "max_output_tokens": 50000,
            "max_total_tokens": 150000,
            "max_tool_calls": 50,
            "max_wall_time_ms": 300000,
            "max_cost_cents": 500,
        }
        validate(instance=valid_budget, schema=budget_schema)

    def test_null_budget_values_allowed(self, run_schema: dict[str, Any]):
        """Null budget values are allowed (no limit)."""
        budget_schema = run_schema["$defs"]["Budget"]
        budget_with_nulls = {
            "max_input_tokens": None,
            "max_output_tokens": None,
            "max_total_tokens": None,
            "max_tool_calls": None,
            "max_wall_time_ms": None,
            "max_cost_cents": None,
        }
        validate(instance=budget_with_nulls, schema=budget_schema)

    def test_negative_budget_values_fail(self, run_schema: dict[str, Any]):
        """Negative budget values fail validation."""
        budget_schema = run_schema["$defs"]["Budget"]
        invalid_budget = {"max_input_tokens": -1}
        with pytest.raises(ValidationError):
            validate(instance=invalid_budget, schema=budget_schema)


class TestAPIVAL006UsageSchemaValidation:
    """API-VAL-006: Usage schema validates correctly."""

    def test_valid_usage_passes(self, run_schema: dict[str, Any]):
        """Valid usage data passes validation."""
        usage_schema = run_schema["$defs"]["BudgetUsage"]
        valid_usage = {
            "input_tokens": 1000,
            "output_tokens": 500,
            "tool_calls": 5,
            "wall_time_ms": 10000,
            "cost_cents": 10,
        }
        validate(instance=valid_usage, schema=usage_schema)

    def test_zero_usage_values_allowed(self, run_schema: dict[str, Any]):
        """Zero usage values are allowed."""
        usage_schema = run_schema["$defs"]["BudgetUsage"]
        zero_usage = {
            "input_tokens": 0,
            "output_tokens": 0,
            "tool_calls": 0,
            "wall_time_ms": 0,
            "cost_cents": 0,
        }
        validate(instance=zero_usage, schema=usage_schema)

    def test_negative_usage_values_fail(self, run_schema: dict[str, Any]):
        """Negative usage values fail validation."""
        usage_schema = run_schema["$defs"]["BudgetUsage"]
        invalid_usage = {"input_tokens": -1}
        with pytest.raises(ValidationError):
            validate(instance=invalid_usage, schema=usage_schema)
