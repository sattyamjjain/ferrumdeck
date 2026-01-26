"""Tests for runtime data models."""

from datetime import UTC, datetime

import pytest

from fd_runtime.models import (
    Budget,
    BudgetUsage,
    Run,
    RunStatus,
    Step,
    StepStatus,
    StepType,
)


# ==========================================================================
# RT-MDL-001: RunStatus enum values
# ==========================================================================
class TestRunStatus:
    """Tests for RunStatus enum."""

    def test_run_status_created(self) -> None:
        """Test CREATED status value."""
        assert RunStatus.CREATED.value == "created"

    def test_run_status_queued(self) -> None:
        """Test QUEUED status value."""
        assert RunStatus.QUEUED.value == "queued"

    def test_run_status_running(self) -> None:
        """Test RUNNING status value."""
        assert RunStatus.RUNNING.value == "running"

    def test_run_status_waiting_approval(self) -> None:
        """Test WAITING_APPROVAL status value."""
        assert RunStatus.WAITING_APPROVAL.value == "waiting_approval"

    def test_run_status_completed(self) -> None:
        """Test COMPLETED status value."""
        assert RunStatus.COMPLETED.value == "completed"

    def test_run_status_failed(self) -> None:
        """Test FAILED status value."""
        assert RunStatus.FAILED.value == "failed"

    def test_run_status_budget_killed(self) -> None:
        """Test BUDGET_KILLED status value."""
        assert RunStatus.BUDGET_KILLED.value == "budget_killed"

    def test_run_status_policy_blocked(self) -> None:
        """Test POLICY_BLOCKED status value."""
        assert RunStatus.POLICY_BLOCKED.value == "policy_blocked"

    def test_run_status_string_comparison(self) -> None:
        """Test RunStatus can be compared as strings."""
        assert RunStatus.RUNNING == "running"
        assert RunStatus.COMPLETED != "running"


# ==========================================================================
# RT-MDL-002: StepType enum values
# ==========================================================================
class TestStepType:
    """Tests for StepType enum."""

    def test_step_type_llm(self) -> None:
        """Test LLM step type value."""
        assert StepType.LLM.value == "llm"

    def test_step_type_tool(self) -> None:
        """Test TOOL step type value."""
        assert StepType.TOOL.value == "tool"

    def test_step_type_retrieval(self) -> None:
        """Test RETRIEVAL step type value."""
        assert StepType.RETRIEVAL.value == "retrieval"

    def test_step_type_sandbox(self) -> None:
        """Test SANDBOX step type value."""
        assert StepType.SANDBOX.value == "sandbox"

    def test_step_type_approval(self) -> None:
        """Test APPROVAL step type value."""
        assert StepType.APPROVAL.value == "approval"


# ==========================================================================
# RT-MDL-003: StepStatus enum values
# ==========================================================================
class TestStepStatus:
    """Tests for StepStatus enum."""

    def test_step_status_pending(self) -> None:
        """Test PENDING status value."""
        assert StepStatus.PENDING.value == "pending"

    def test_step_status_running(self) -> None:
        """Test RUNNING status value."""
        assert StepStatus.RUNNING.value == "running"

    def test_step_status_completed(self) -> None:
        """Test COMPLETED status value."""
        assert StepStatus.COMPLETED.value == "completed"

    def test_step_status_failed(self) -> None:
        """Test FAILED status value."""
        assert StepStatus.FAILED.value == "failed"

    def test_step_status_skipped(self) -> None:
        """Test SKIPPED status value."""
        assert StepStatus.SKIPPED.value == "skipped"


# ==========================================================================
# RT-MDL-004: Budget model
# ==========================================================================
class TestBudget:
    """Tests for Budget model."""

    def test_budget_defaults(self) -> None:
        """Test Budget default values."""
        budget = Budget()
        assert budget.max_input_tokens == 100_000
        assert budget.max_output_tokens == 50_000
        assert budget.max_total_tokens == 150_000
        assert budget.max_tool_calls == 50
        assert budget.max_wall_time_ms == 5 * 60 * 1000
        assert budget.max_cost_cents == 500

    def test_budget_custom_values(self) -> None:
        """Test Budget with custom values."""
        budget = Budget(
            max_input_tokens=10_000,
            max_output_tokens=5_000,
            max_total_tokens=15_000,
            max_tool_calls=10,
            max_wall_time_ms=60_000,
            max_cost_cents=100,
        )
        assert budget.max_input_tokens == 10_000
        assert budget.max_tool_calls == 10

    def test_budget_none_values(self) -> None:
        """Test Budget with None values (unlimited)."""
        budget = Budget(
            max_input_tokens=None,
            max_cost_cents=None,
        )
        assert budget.max_input_tokens is None
        assert budget.max_cost_cents is None


# ==========================================================================
# RT-MDL-005: BudgetUsage model
# ==========================================================================
class TestBudgetUsage:
    """Tests for BudgetUsage model."""

    def test_budget_usage_defaults(self) -> None:
        """Test BudgetUsage default values."""
        usage = BudgetUsage()
        assert usage.input_tokens == 0
        assert usage.output_tokens == 0
        assert usage.tool_calls == 0
        assert usage.wall_time_ms == 0
        assert usage.cost_cents == 0

    def test_budget_usage_total_tokens(self) -> None:
        """Test total_tokens property."""
        usage = BudgetUsage(input_tokens=100, output_tokens=50)
        assert usage.total_tokens == 150

    def test_budget_usage_total_tokens_zero(self) -> None:
        """Test total_tokens when both are zero."""
        usage = BudgetUsage()
        assert usage.total_tokens == 0

    def test_budget_usage_with_values(self) -> None:
        """Test BudgetUsage with custom values."""
        usage = BudgetUsage(
            input_tokens=1000,
            output_tokens=500,
            tool_calls=5,
            wall_time_ms=30000,
            cost_cents=25,
        )
        assert usage.input_tokens == 1000
        assert usage.output_tokens == 500
        assert usage.total_tokens == 1500
        assert usage.tool_calls == 5
        assert usage.cost_cents == 25


# ==========================================================================
# RT-MDL-006: Step model
# ==========================================================================
class TestStep:
    """Tests for Step model."""

    def test_step_creation(self) -> None:
        """Test creating a basic Step."""
        step = Step(
            id="stp_123",
            run_id="run_456",
            step_type=StepType.LLM,
        )
        assert step.id == "stp_123"
        assert step.run_id == "run_456"
        assert step.step_type == StepType.LLM
        assert step.status == StepStatus.PENDING
        assert step.input == {}
        assert step.output is None
        assert step.error is None

    def test_step_with_input_output(self) -> None:
        """Test Step with input and output."""
        step = Step(
            id="stp_789",
            run_id="run_123",
            step_type=StepType.TOOL,
            input={"tool": "read_file", "path": "/tmp/test.txt"},
            output={"content": "Hello World"},
            status=StepStatus.COMPLETED,
        )
        assert step.input["tool"] == "read_file"
        assert step.output is not None
        assert step.output["content"] == "Hello World"
        assert step.status == StepStatus.COMPLETED

    def test_step_with_error(self) -> None:
        """Test Step with error."""
        step = Step(
            id="stp_err",
            run_id="run_1",
            step_type=StepType.LLM,
            status=StepStatus.FAILED,
            error="Connection timeout",
        )
        assert step.status == StepStatus.FAILED
        assert step.error == "Connection timeout"

    def test_step_with_timestamps(self) -> None:
        """Test Step with timestamps."""
        now = datetime.now(UTC)
        step = Step(
            id="stp_time",
            run_id="run_1",
            step_type=StepType.LLM,
            started_at=now,
            completed_at=now,
        )
        assert step.started_at == now
        assert step.completed_at == now

    def test_step_with_usage(self) -> None:
        """Test Step with usage tracking."""
        usage = BudgetUsage(input_tokens=100, output_tokens=50)
        step = Step(
            id="stp_usage",
            run_id="run_1",
            step_type=StepType.LLM,
            usage=usage,
        )
        assert step.usage.input_tokens == 100
        assert step.usage.total_tokens == 150

    def test_step_with_metadata(self) -> None:
        """Test Step with metadata."""
        step = Step(
            id="stp_meta",
            run_id="run_1",
            step_type=StepType.TOOL,
            metadata={"model": "claude-3-opus", "temperature": 0.7},
        )
        assert step.metadata["model"] == "claude-3-opus"
        assert step.metadata["temperature"] == 0.7


# ==========================================================================
# RT-MDL-007: Run model
# ==========================================================================
class TestRun:
    """Tests for Run model."""

    def test_run_creation(self) -> None:
        """Test creating a basic Run."""
        now = datetime.now(UTC)
        run = Run(
            id="run_abc123",
            agent_id="agt_xyz",
            tenant_id="ten_1",
            created_at=now,
        )
        assert run.id == "run_abc123"
        assert run.agent_id == "agt_xyz"
        assert run.tenant_id == "ten_1"
        assert run.status == RunStatus.CREATED
        assert run.input == {}
        assert run.output is None
        assert run.steps == []

    def test_run_with_input_output(self) -> None:
        """Test Run with input and output."""
        now = datetime.now(UTC)
        run = Run(
            id="run_1",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=now,
            input={"task": "Write a poem"},
            output={"result": "A beautiful poem..."},
            status=RunStatus.COMPLETED,
        )
        assert run.input["task"] == "Write a poem"
        assert run.output is not None
        assert run.output["result"] == "A beautiful poem..."

    def test_run_with_budget(self) -> None:
        """Test Run with custom budget."""
        now = datetime.now(UTC)
        budget = Budget(max_cost_cents=1000)
        run = Run(
            id="run_budget",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=now,
            budget=budget,
        )
        assert run.budget.max_cost_cents == 1000

    def test_run_with_usage(self) -> None:
        """Test Run with usage tracking."""
        now = datetime.now(UTC)
        usage = BudgetUsage(input_tokens=5000, output_tokens=2000, tool_calls=3)
        run = Run(
            id="run_usage",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=now,
            usage=usage,
        )
        assert run.usage.input_tokens == 5000
        assert run.usage.total_tokens == 7000
        assert run.usage.tool_calls == 3

    def test_run_with_steps(self) -> None:
        """Test Run with steps list."""
        now = datetime.now(UTC)
        steps = [
            Step(id="stp_1", run_id="run_steps", step_type=StepType.LLM),
            Step(id="stp_2", run_id="run_steps", step_type=StepType.TOOL),
        ]
        run = Run(
            id="run_steps",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=now,
            steps=steps,
        )
        assert len(run.steps) == 2
        assert run.steps[0].step_type == StepType.LLM
        assert run.steps[1].step_type == StepType.TOOL

    def test_run_with_version_info(self) -> None:
        """Test Run with version pinning."""
        now = datetime.now(UTC)
        run = Run(
            id="run_ver",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=now,
            agent_version_id="agv_123",
            config_version="v1.2.3",
        )
        assert run.agent_version_id == "agv_123"
        assert run.config_version == "v1.2.3"

    def test_run_with_error(self) -> None:
        """Test Run with error state."""
        now = datetime.now(UTC)
        run = Run(
            id="run_err",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=now,
            status=RunStatus.FAILED,
            error="Budget exceeded",
        )
        assert run.status == RunStatus.FAILED
        assert run.error == "Budget exceeded"

    def test_run_timestamps(self) -> None:
        """Test Run with all timestamps."""
        created = datetime.now(UTC)
        started = datetime.now(UTC)
        completed = datetime.now(UTC)
        run = Run(
            id="run_time",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=created,
            started_at=started,
            completed_at=completed,
            status=RunStatus.COMPLETED,
        )
        assert run.created_at == created
        assert run.started_at == started
        assert run.completed_at == completed


# ==========================================================================
# RT-MDL-008: Model serialization
# ==========================================================================
class TestModelSerialization:
    """Tests for model serialization."""

    def test_budget_to_dict(self) -> None:
        """Test Budget serialization."""
        budget = Budget(max_cost_cents=100)
        data = budget.model_dump()
        assert data["max_cost_cents"] == 100
        assert "max_input_tokens" in data

    def test_step_to_dict(self) -> None:
        """Test Step serialization."""
        step = Step(
            id="stp_1",
            run_id="run_1",
            step_type=StepType.LLM,
        )
        data = step.model_dump()
        assert data["id"] == "stp_1"
        assert data["step_type"] == "llm"

    def test_run_to_dict(self) -> None:
        """Test Run serialization."""
        now = datetime.now(UTC)
        run = Run(
            id="run_1",
            agent_id="agt_1",
            tenant_id="ten_1",
            created_at=now,
            status=RunStatus.RUNNING,
        )
        data = run.model_dump()
        assert data["id"] == "run_1"
        assert data["status"] == "running"

    def test_budget_usage_to_dict(self) -> None:
        """Test BudgetUsage serialization."""
        usage = BudgetUsage(input_tokens=100, output_tokens=50)
        data = usage.model_dump()
        assert data["input_tokens"] == 100
        assert data["output_tokens"] == 50
