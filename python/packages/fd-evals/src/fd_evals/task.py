"""Evaluation task definitions."""

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fd_evals.claim_grounding import ClaimGrounding
from fd_evals.cost_decomposition import CallRecord, CostBreakdown, sum_breakdowns
from fd_evals.harness import HarnessConfig


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
    """Result from a single scorer.

    ``skipped`` marks the case where the scorer had nothing to assert — the
    task declared no schema, no output expectation, no lint requirement. Such
    a result still carries ``score=1.0`` for backward compatibility with
    readers that only look at the float, but it is **excluded from the
    composite average** by :class:`~fd_evals.scorers.base.CompositeScorer`.

    Folding skips into the average at 1.0 is how the safe-PR suite reported a
    perfect 1.00 while half of every run's scorer results asserted nothing at
    all. A scorer that did not run is not evidence that the agent succeeded.
    """

    scorer_name: str
    passed: bool
    score: float  # 0.0 to 1.0
    message: str
    details: dict[str, Any] = field(default_factory=dict)
    skipped: bool = False


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
    # Debt-vs-tax cost decomposition (§2605.27320). Both fields are
    # additive Option-equivalents — older callers that don't populate
    # them continue to work, and `to_dict` emits the keys only when
    # present so legacy readers are unaffected.
    call_records: list[CallRecord] | None = None
    cost_breakdown: CostBreakdown | None = None
    # Claim-grounding-rate reliability metric (VeriGraph, arXiv:2606.16603).
    # Additive Option-equivalent — populated when the run's output + steps are
    # available; `to_dict` emits the key only when present so legacy readers
    # are unaffected.
    claim_grounding: ClaimGrounding | None = None
    # Persisted agent trajectory, in the coherence event shape
    # (`fd_evals.trajectory`). OPT-IN: populated only when the operator asks
    # for it, because writing raw model output to disk is a data-handling
    # decision, not a default. Additive Option-equivalent — `to_dict` emits the
    # key only when present, so a run without it is byte-identical to a
    # pre-0.8.19 record.
    trajectory: list[dict[str, str]] | None = None

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization.

        ``call_records``, ``cost_breakdown``, ``claim_grounding`` and
        ``trajectory`` are emitted only when present so the wire shape stays
        byte-identical for runs that predate each rollout.
        """
        out: dict[str, Any] = {
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
                    "skipped": sr.skipped,
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
        if self.call_records is not None:
            out["call_records"] = [c.to_dict() for c in self.call_records]
        if self.cost_breakdown is not None:
            out["cost_breakdown"] = self.cost_breakdown.to_dict()
        if self.claim_grounding is not None:
            out["claim_grounding"] = self.claim_grounding.to_dict()
        if self.trajectory is not None:
            out["trajectory"] = self.trajectory
        return out


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
    # The model under evaluation (e.g. "claude-opus-4-7"). Optional — older
    # reports omitted it; runner now plumbs it through so dashboard grouping
    # by `(model × harness_config)` works without reaching into per-step
    # data. Backward-compatible: None survives through to_dict/from_dict.
    model: str | None = None
    # Harness-Bench configuration in effect for this run. Additive Option-
    # equivalent field — when None, dashboards/CLI render "no harness" and
    # downstream comparisons skip per-harness grouping. See
    # `fd_evals.harness.HarnessConfig` for the dimensions.
    harness_config: "HarnessConfig | None" = None
    # Run-level debt-vs-tax decomposition (§2605.27320). Aggregated from the
    # per-task `EvalResult.cost_breakdown` rollups via
    # `cost_decomposition.sum_breakdowns`. Optional: only populated when at
    # least one task on the run carried a breakdown.
    cost_breakdown: CostBreakdown | None = None

    @property
    def pass_rate(self) -> float:
        """Calculate pass rate as percentage."""
        if self.total_tasks == 0:
            return 0.0
        return (self.passed_tasks / self.total_tasks) * 100

    @property
    def assertion_coverage(self) -> float:
        """Fraction of scorer results on this run that asserted something.

        1.0 means every scorer fired on every task. 0.5 means half of them
        skipped -- they had nothing to check and returned a full score anyway.
        The safe-PR smoke and regression suites both sit at exactly 0.5, which
        is the number that makes their 1.00 average readable: it is an average
        over the half of the scorers that ran.

        Publish this next to the score. A score without it cannot be
        distinguished from a score the harness gave itself.
        """
        total = 0
        asserted = 0
        for result in self.results:
            for scorer_result in result.scorer_results:
                total += 1
                if not scorer_result.skipped:
                    asserted += 1
        return asserted / total if total else 0.0

    def derive_cost_breakdown(self) -> CostBreakdown | None:
        """Aggregate per-task cost breakdowns into the run-level one.

        Returns ``None`` when no task on the run carries a breakdown — the
        runner uses this to populate :attr:`cost_breakdown` exactly when
        the data exists; legacy runs still emit a `None` field that
        `to_dict` strips out.
        """
        per_task = [r.cost_breakdown for r in self.results]
        if all(b is None for b in per_task):
            return None
        return sum_breakdowns(per_task)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization.

        ``model`` and ``harness_config`` are emitted only when present so an
        old reader that ignores unknown keys continues to work unchanged.
        """
        out: dict[str, Any] = {
            "run_id": self.run_id,
            "dataset_name": self.dataset_name,
            "total_tasks": self.total_tasks,
            "passed_tasks": self.passed_tasks,
            "failed_tasks": self.failed_tasks,
            "pass_rate": self.pass_rate,
            "average_score": self.average_score,
            "assertion_coverage": self.assertion_coverage,
            "total_cost_cents": self.total_cost_cents,
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_execution_time_ms": self.total_execution_time_ms,
            "results": [r.to_dict() for r in self.results],
            "started_at": self.started_at.isoformat(),
            "completed_at": self.completed_at.isoformat() if self.completed_at else None,
        }
        if self.model is not None:
            out["model"] = self.model
        if self.harness_config is not None:
            out["harness_config"] = self.harness_config.to_dict()
        if self.cost_breakdown is not None:
            out["cost_breakdown"] = self.cost_breakdown.to_dict()
        return out
