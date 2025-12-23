"""Runtime data models."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class RunStatus(str, Enum):
    """Run lifecycle states."""

    CREATED = "created"
    QUEUED = "queued"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    BUDGET_KILLED = "budget_killed"
    POLICY_BLOCKED = "policy_blocked"


class StepType(str, Enum):
    """Types of execution steps."""

    LLM = "llm"
    TOOL = "tool"
    RETRIEVAL = "retrieval"
    SANDBOX = "sandbox"
    APPROVAL = "approval"


class StepStatus(str, Enum):
    """Step execution states."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


class Budget(BaseModel):
    """Budget limits for a run."""

    max_input_tokens: int | None = 100_000
    max_output_tokens: int | None = 50_000
    max_total_tokens: int | None = 150_000
    max_tool_calls: int | None = 50
    max_wall_time_ms: int | None = 5 * 60 * 1000  # 5 minutes
    max_cost_cents: int | None = 500  # $5


class BudgetUsage(BaseModel):
    """Current usage against budget."""

    input_tokens: int = 0
    output_tokens: int = 0
    tool_calls: int = 0
    wall_time_ms: int = 0
    cost_cents: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


class Step(BaseModel):
    """An execution step within a run."""

    id: str
    run_id: str
    step_type: StepType
    status: StepStatus = StepStatus.PENDING
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] | None = None
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    usage: BudgetUsage = Field(default_factory=BudgetUsage)
    metadata: dict[str, Any] = Field(default_factory=dict)


class Run(BaseModel):
    """An agent run."""

    id: str
    agent_id: str
    tenant_id: str
    status: RunStatus = RunStatus.CREATED
    input: dict[str, Any] = Field(default_factory=dict)
    output: dict[str, Any] | None = None
    budget: Budget = Field(default_factory=Budget)
    usage: BudgetUsage = Field(default_factory=BudgetUsage)
    steps: list[Step] = Field(default_factory=list)
    created_at: datetime
    started_at: datetime | None = None
    completed_at: datetime | None = None
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)

    # Version pins for reproducibility
    agent_version_id: str | None = None
    config_version: str | None = None
