"""Evaluation task definitions."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any


def _utc_now() -> datetime:
    """Return current UTC time."""
    return datetime.now(tz=UTC)


@dataclass
class EvalTask:
    """An evaluation task to run against the agent."""

    id: str
    name: str
    description: str
    input: dict[str, Any]
    expected: dict[str, Any]
    difficulty: str = "medium"
    category: str = "general"
    tags: list[str] = field(default_factory=list)
    config: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "EvalTask":
        """Create an EvalTask from a dictionary."""
        return cls(
            id=data["id"],
            name=data["name"],
            description=data["description"],
            input=data["input"],
            expected=data["expected"],
            difficulty=data.get("difficulty", "medium"),
            category=data.get("category", "general"),
            tags=data.get("tags", []),
            config=data.get("config", {}),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "input": self.input,
            "expected": self.expected,
            "difficulty": self.difficulty,
            "category": self.category,
            "tags": self.tags,
            "config": self.config,
        }


@dataclass
class ScorerResult:
    """Result from a single scorer."""

    scorer_name: str
    passed: bool
    score: float  # 0.0 to 1.0
    message: str
    details: dict[str, Any] = field(default_factory=dict)


@dataclass
class EvalResult:
    """Result of evaluating a single task."""

    task_id: str
    task_name: str
    run_id: str | None
    passed: bool
    total_score: float  # 0.0 to 1.0
    scorer_results: list[ScorerResult]
    execution_time_ms: int
    input_tokens: int
    output_tokens: int
    cost_cents: float
    error: str | None = None
    trace_id: str | None = None
    timestamp: datetime = field(default_factory=_utc_now)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "task_id": self.task_id,
            "task_name": self.task_name,
            "run_id": self.run_id,
            "passed": self.passed,
            "total_score": self.total_score,
            "scorer_results": [
                {
                    "scorer_name": sr.scorer_name,
                    "passed": sr.passed,
                    "score": sr.score,
                    "message": sr.message,
                    "details": sr.details,
                }
                for sr in self.scorer_results
            ],
            "execution_time_ms": self.execution_time_ms,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_cents": self.cost_cents,
            "error": self.error,
            "trace_id": self.trace_id,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class EvalRunSummary:
    """Summary of an evaluation run."""

    run_id: str
    dataset_name: str
    total_tasks: int
    passed_tasks: int
    failed_tasks: int
    average_score: float
    total_cost_cents: float
    total_input_tokens: int
    total_output_tokens: int
    total_execution_time_ms: int
    results: list[EvalResult]
    started_at: datetime
    completed_at: datetime | None = None

    @property
    def pass_rate(self) -> float:
        """Calculate pass rate as percentage."""
        if self.total_tasks == 0:
            return 0.0
        return (self.passed_tasks / self.total_tasks) * 100

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "run_id": self.run_id,
            "dataset_name": self.dataset_name,
            "total_tasks": self.total_tasks,
            "passed_tasks": self.passed_tasks,
            "failed_tasks": self.failed_tasks,
            "pass_rate": self.pass_rate,
            "average_score": self.average_score,
            "total_cost_cents": self.total_cost_cents,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_execution_time_ms": self.total_execution_time_ms,
            "results": [r.to_dict() for r in self.results],
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }
