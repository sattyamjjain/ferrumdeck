"""Score and Cost Delta Reports for Evaluation Runs.

Compares eval runs across versions to track regressions and improvements.
Provides detailed breakdowns by task, scorer, and cost metrics.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class DeltaStatus(Enum):
    """Status of a delta comparison."""

    IMPROVED = "improved"
    REGRESSED = "regressed"
    UNCHANGED = "unchanged"
    NEW = "new"
    REMOVED = "removed"


@dataclass
class ScoreDelta:
    """Delta for a single score metric."""

    scorer_name: str
    baseline_score: float | None
    current_score: float | None
    delta: float
    delta_percent: float
    status: DeltaStatus

    @property
    def is_regression(self) -> bool:
        """Check if this represents a regression."""
        return self.status == DeltaStatus.REGRESSED

    @property
    def is_improvement(self) -> bool:
        """Check if this represents an improvement."""
        return self.status == DeltaStatus.IMPROVED


@dataclass
class CostDelta:
    """Delta for cost metrics."""

    baseline_input_tokens: int
    baseline_output_tokens: int
    baseline_cost_cents: float
    current_input_tokens: int
    current_output_tokens: int
    current_cost_cents: float
    token_delta: int
    cost_delta_cents: float
    cost_delta_percent: float
    status: DeltaStatus


@dataclass
class TaskDelta:
    """Delta for a single task across runs."""

    task_id: str
    task_name: str
    baseline_passed: bool | None
    current_passed: bool | None
    score_deltas: list[ScoreDelta]
    cost_delta: CostDelta | None
    status: DeltaStatus

    @property
    def has_regressions(self) -> bool:
        """Check if any scorer regressed."""
        return any(sd.is_regression for sd in self.score_deltas)

    @property
    def overall_score_delta(self) -> float:
        """Get average score delta across all scorers."""
        if not self.score_deltas:
            return 0.0
        return sum(sd.delta for sd in self.score_deltas) / len(self.score_deltas)


@dataclass
class DeltaReport:
    """Complete delta report comparing two eval runs."""

    baseline_run_id: str
    current_run_id: str
    baseline_version: str
    current_version: str
    created_at: str
    task_deltas: list[TaskDelta]
    summary: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Compute summary statistics."""
        if not self.summary:
            self.summary = self._compute_summary()

    def _compute_summary(self) -> dict[str, Any]:
        """Compute summary statistics for the report."""
        total_tasks = len(self.task_deltas)
        improved = sum(1 for td in self.task_deltas if td.status == DeltaStatus.IMPROVED)
        regressed = sum(
            1 for td in self.task_deltas if td.status == DeltaStatus.REGRESSED
        )
        unchanged = sum(
            1 for td in self.task_deltas if td.status == DeltaStatus.UNCHANGED
        )
        new_tasks = sum(1 for td in self.task_deltas if td.status == DeltaStatus.NEW)
        removed_tasks = sum(
            1 for td in self.task_deltas if td.status == DeltaStatus.REMOVED
        )

        # Score statistics
        score_deltas = [
            td.overall_score_delta
            for td in self.task_deltas
            if td.status not in (DeltaStatus.NEW, DeltaStatus.REMOVED)
        ]
        avg_score_delta = sum(score_deltas) / len(score_deltas) if score_deltas else 0.0

        # Cost statistics
        baseline_cost = sum(
            td.cost_delta.baseline_cost_cents
            for td in self.task_deltas
            if td.cost_delta
        )
        current_cost = sum(
            td.cost_delta.current_cost_cents
            for td in self.task_deltas
            if td.cost_delta
        )
        cost_delta = current_cost - baseline_cost
        cost_delta_percent = (
            (cost_delta / baseline_cost * 100) if baseline_cost > 0 else 0.0
        )

        return {
            "total_tasks": total_tasks,
            "improved": improved,
            "regressed": regressed,
            "unchanged": unchanged,
            "new_tasks": new_tasks,
            "removed_tasks": removed_tasks,
            "avg_score_delta": round(avg_score_delta, 4),
            "baseline_cost_cents": round(baseline_cost, 2),
            "current_cost_cents": round(current_cost, 2),
            "cost_delta_cents": round(cost_delta, 2),
            "cost_delta_percent": round(cost_delta_percent, 2),
            "has_regressions": regressed > 0,
            "regression_rate": round(regressed / total_tasks * 100, 2)
            if total_tasks > 0
            else 0.0,
        }

    @property
    def has_regressions(self) -> bool:
        """Check if any task regressed."""
        return self.summary.get("has_regressions", False)

    @property
    def regression_count(self) -> int:
        """Get count of regressed tasks."""
        return self.summary.get("regressed", 0)

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for serialization."""
        return {
            "baseline_run_id": self.baseline_run_id,
            "current_run_id": self.current_run_id,
            "baseline_version": self.baseline_version,
            "current_version": self.current_version,
            "created_at": self.created_at,
            "summary": self.summary,
            "task_deltas": [
                {
                    "task_id": td.task_id,
                    "task_name": td.task_name,
                    "baseline_passed": td.baseline_passed,
                    "current_passed": td.current_passed,
                    "status": td.status.value,
                    "overall_score_delta": td.overall_score_delta,
                    "score_deltas": [
                        {
                            "scorer_name": sd.scorer_name,
                            "baseline_score": sd.baseline_score,
                            "current_score": sd.current_score,
                            "delta": sd.delta,
                            "delta_percent": sd.delta_percent,
                            "status": sd.status.value,
                        }
                        for sd in td.score_deltas
                    ],
                    "cost_delta": {
                        "baseline_input_tokens": td.cost_delta.baseline_input_tokens,
                        "baseline_output_tokens": td.cost_delta.baseline_output_tokens,
                        "baseline_cost_cents": td.cost_delta.baseline_cost_cents,
                        "current_input_tokens": td.cost_delta.current_input_tokens,
                        "current_output_tokens": td.cost_delta.current_output_tokens,
                        "current_cost_cents": td.cost_delta.current_cost_cents,
                        "token_delta": td.cost_delta.token_delta,
                        "cost_delta_cents": td.cost_delta.cost_delta_cents,
                        "cost_delta_percent": td.cost_delta.cost_delta_percent,
                        "status": td.cost_delta.status.value,
                    }
                    if td.cost_delta
                    else None,
                }
                for td in self.task_deltas
            ],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "DeltaReport":
        """Create from dictionary."""
        task_deltas = []
        for td_data in data.get("task_deltas", []):
            score_deltas = [
                ScoreDelta(
                    scorer_name=sd["scorer_name"],
                    baseline_score=sd["baseline_score"],
                    current_score=sd["current_score"],
                    delta=sd["delta"],
                    delta_percent=sd["delta_percent"],
                    status=DeltaStatus(sd["status"]),
                )
                for sd in td_data.get("score_deltas", [])
            ]

            cost_delta = None
            if td_data.get("cost_delta"):
                cd = td_data["cost_delta"]
                cost_delta = CostDelta(
                    baseline_input_tokens=cd["baseline_input_tokens"],
                    baseline_output_tokens=cd["baseline_output_tokens"],
                    baseline_cost_cents=cd["baseline_cost_cents"],
                    current_input_tokens=cd["current_input_tokens"],
                    current_output_tokens=cd["current_output_tokens"],
                    current_cost_cents=cd["current_cost_cents"],
                    token_delta=cd["token_delta"],
                    cost_delta_cents=cd["cost_delta_cents"],
                    cost_delta_percent=cd["cost_delta_percent"],
                    status=DeltaStatus(cd["status"]),
                )

            task_deltas.append(
                TaskDelta(
                    task_id=td_data["task_id"],
                    task_name=td_data["task_name"],
                    baseline_passed=td_data["baseline_passed"],
                    current_passed=td_data["current_passed"],
                    score_deltas=score_deltas,
                    cost_delta=cost_delta,
                    status=DeltaStatus(td_data["status"]),
                )
            )

        return cls(
            baseline_run_id=data["baseline_run_id"],
            current_run_id=data["current_run_id"],
            baseline_version=data["baseline_version"],
            current_version=data["current_version"],
            created_at=data["created_at"],
            task_deltas=task_deltas,
            summary=data.get("summary", {}),
        )


class DeltaReporter:
    """Generates delta reports comparing eval runs."""

    def __init__(
        self,
        regression_threshold: float = 0.05,
        cost_threshold_percent: float = 10.0,
    ):
        """Initialize the delta reporter.

        Args:
            regression_threshold: Minimum score decrease to count as regression.
            cost_threshold_percent: Minimum cost increase % to flag as significant.
        """
        self.regression_threshold = regression_threshold
        self.cost_threshold_percent = cost_threshold_percent

    def compare_runs(
        self,
        baseline_results: dict[str, Any],
        current_results: dict[str, Any],
    ) -> DeltaReport:
        """Compare two eval run results and generate a delta report.

        Args:
            baseline_results: Results from the baseline run.
            current_results: Results from the current run.

        Returns:
            DeltaReport with detailed comparison.
        """
        baseline_tasks = {
            r["task_id"]: r for r in baseline_results.get("task_results", [])
        }
        current_tasks = {
            r["task_id"]: r for r in current_results.get("task_results", [])
        }

        all_task_ids = set(baseline_tasks.keys()) | set(current_tasks.keys())
        task_deltas = []

        for task_id in sorted(all_task_ids):
            baseline_task = baseline_tasks.get(task_id)
            current_task = current_tasks.get(task_id)

            task_delta = self._compare_task(task_id, baseline_task, current_task)
            task_deltas.append(task_delta)

        return DeltaReport(
            baseline_run_id=baseline_results.get("run_id", "unknown"),
            current_run_id=current_results.get("run_id", "unknown"),
            baseline_version=baseline_results.get("version", "unknown"),
            current_version=current_results.get("version", "unknown"),
            created_at=datetime.now().isoformat(),
            task_deltas=task_deltas,
        )

    def _compare_task(
        self,
        task_id: str,
        baseline: dict[str, Any] | None,
        current: dict[str, Any] | None,
    ) -> TaskDelta:
        """Compare a single task across runs."""
        # Handle new/removed tasks
        if baseline is None:
            return TaskDelta(
                task_id=task_id,
                task_name=current.get("task_name", task_id) if current else task_id,
                baseline_passed=None,
                current_passed=current.get("passed") if current else None,
                score_deltas=[],
                cost_delta=None,
                status=DeltaStatus.NEW,
            )

        if current is None:
            return TaskDelta(
                task_id=task_id,
                task_name=baseline.get("task_name", task_id),
                baseline_passed=baseline.get("passed"),
                current_passed=None,
                score_deltas=[],
                cost_delta=None,
                status=DeltaStatus.REMOVED,
            )

        # Compare scores
        score_deltas = self._compare_scores(
            baseline.get("scorer_results", {}),
            current.get("scorer_results", {}),
        )

        # Compare costs
        cost_delta = self._compare_costs(baseline, current)

        # Determine overall status
        status = self._determine_task_status(
            baseline.get("passed"),
            current.get("passed"),
            score_deltas,
        )

        return TaskDelta(
            task_id=task_id,
            task_name=current.get("task_name", task_id),
            baseline_passed=baseline.get("passed"),
            current_passed=current.get("passed"),
            score_deltas=score_deltas,
            cost_delta=cost_delta,
            status=status,
        )

    def _compare_scores(
        self,
        baseline_scores: dict[str, Any],
        current_scores: dict[str, Any],
    ) -> list[ScoreDelta]:
        """Compare scorer results between runs."""
        all_scorers = set(baseline_scores.keys()) | set(current_scores.keys())
        score_deltas = []

        for scorer_name in sorted(all_scorers):
            baseline_result = baseline_scores.get(scorer_name, {})
            current_result = current_scores.get(scorer_name, {})

            baseline_score = baseline_result.get("score")
            current_score = current_result.get("score")

            if baseline_score is None and current_score is not None:
                status = DeltaStatus.NEW
                delta = 0.0
                delta_percent = 0.0
            elif current_score is None and baseline_score is not None:
                status = DeltaStatus.REMOVED
                delta = 0.0
                delta_percent = 0.0
            elif baseline_score is not None and current_score is not None:
                delta = current_score - baseline_score
                delta_percent = (
                    (delta / baseline_score * 100) if baseline_score > 0 else 0.0
                )

                if delta < -self.regression_threshold:
                    status = DeltaStatus.REGRESSED
                elif delta > self.regression_threshold:
                    status = DeltaStatus.IMPROVED
                else:
                    status = DeltaStatus.UNCHANGED
            else:
                continue  # Both None, skip

            score_deltas.append(
                ScoreDelta(
                    scorer_name=scorer_name,
                    baseline_score=baseline_score,
                    current_score=current_score,
                    delta=round(delta, 4),
                    delta_percent=round(delta_percent, 2),
                    status=status,
                )
            )

        return score_deltas

    def _compare_costs(
        self,
        baseline: dict[str, Any],
        current: dict[str, Any],
    ) -> CostDelta:
        """Compare cost metrics between runs."""
        baseline_input = baseline.get("input_tokens", 0)
        baseline_output = baseline.get("output_tokens", 0)
        baseline_cost = baseline.get("cost_cents", 0.0)

        current_input = current.get("input_tokens", 0)
        current_output = current.get("output_tokens", 0)
        current_cost = current.get("cost_cents", 0.0)

        token_delta = (current_input + current_output) - (
            baseline_input + baseline_output
        )
        cost_delta = current_cost - baseline_cost
        cost_delta_percent = (
            (cost_delta / baseline_cost * 100) if baseline_cost > 0 else 0.0
        )

        if cost_delta_percent > self.cost_threshold_percent:
            status = DeltaStatus.REGRESSED  # Cost increase is a regression
        elif cost_delta_percent < -self.cost_threshold_percent:
            status = DeltaStatus.IMPROVED  # Cost decrease is an improvement
        else:
            status = DeltaStatus.UNCHANGED

        return CostDelta(
            baseline_input_tokens=baseline_input,
            baseline_output_tokens=baseline_output,
            baseline_cost_cents=baseline_cost,
            current_input_tokens=current_input,
            current_output_tokens=current_output,
            current_cost_cents=current_cost,
            token_delta=token_delta,
            cost_delta_cents=round(cost_delta, 4),
            cost_delta_percent=round(cost_delta_percent, 2),
            status=status,
        )

    def _determine_task_status(
        self,
        baseline_passed: bool | None,
        current_passed: bool | None,
        score_deltas: list[ScoreDelta],
    ) -> DeltaStatus:
        """Determine overall task status based on pass/fail and score changes."""
        # Pass/fail flip is most important
        if baseline_passed and not current_passed:
            return DeltaStatus.REGRESSED
        if not baseline_passed and current_passed:
            return DeltaStatus.IMPROVED

        # Otherwise, look at score deltas
        regressions = sum(1 for sd in score_deltas if sd.status == DeltaStatus.REGRESSED)
        improvements = sum(
            1 for sd in score_deltas if sd.status == DeltaStatus.IMPROVED
        )

        if regressions > improvements:
            return DeltaStatus.REGRESSED
        elif improvements > regressions:
            return DeltaStatus.IMPROVED
        else:
            return DeltaStatus.UNCHANGED


def generate_markdown_report(report: DeltaReport) -> str:
    """Generate a markdown-formatted delta report.

    Args:
        report: The delta report to format.

    Returns:
        Markdown-formatted string.
    """
    lines = [
        "# Eval Delta Report",
        "",
        f"**Baseline**: {report.baseline_version} (`{report.baseline_run_id}`)",
        f"**Current**: {report.current_version} (`{report.current_run_id}`)",
        f"**Generated**: {report.created_at}",
        "",
        "## Summary",
        "",
        f"| Metric | Value |",
        f"|--------|-------|",
        f"| Total Tasks | {report.summary['total_tasks']} |",
        f"| Improved | {report.summary['improved']} |",
        f"| Regressed | {report.summary['regressed']} |",
        f"| Unchanged | {report.summary['unchanged']} |",
        f"| Avg Score Delta | {report.summary['avg_score_delta']:+.4f} |",
        f"| Cost Delta | ${report.summary['cost_delta_cents'] / 100:.2f} ({report.summary['cost_delta_percent']:+.1f}%) |",
        "",
    ]

    # Add regression alert if needed
    if report.has_regressions:
        lines.extend(
            [
                "## :warning: Regressions Detected",
                "",
                f"**{report.regression_count} task(s) regressed.** Review before merging.",
                "",
            ]
        )

    # Add task details
    lines.extend(
        [
            "## Task Details",
            "",
            "| Task | Status | Score Delta | Cost Delta |",
            "|------|--------|-------------|------------|",
        ]
    )

    status_emoji = {
        DeltaStatus.IMPROVED: ":white_check_mark:",
        DeltaStatus.REGRESSED: ":x:",
        DeltaStatus.UNCHANGED: ":heavy_minus_sign:",
        DeltaStatus.NEW: ":new:",
        DeltaStatus.REMOVED: ":wastebasket:",
    }

    for td in report.task_deltas:
        emoji = status_emoji.get(td.status, "")
        score_delta = (
            f"{td.overall_score_delta:+.4f}"
            if td.status not in (DeltaStatus.NEW, DeltaStatus.REMOVED)
            else "N/A"
        )
        cost_delta = (
            f"${td.cost_delta.cost_delta_cents / 100:+.2f}"
            if td.cost_delta
            else "N/A"
        )
        lines.append(f"| {td.task_name} | {emoji} {td.status.value} | {score_delta} | {cost_delta} |")

    lines.append("")

    # Add detailed breakdown for regressions
    regressions = [td for td in report.task_deltas if td.status == DeltaStatus.REGRESSED]
    if regressions:
        lines.extend(
            [
                "## Regression Details",
                "",
            ]
        )
        for td in regressions:
            lines.extend(
                [
                    f"### {td.task_name}",
                    "",
                    f"- **Baseline Passed**: {td.baseline_passed}",
                    f"- **Current Passed**: {td.current_passed}",
                    "",
                    "**Score Changes:**",
                    "",
                ]
            )
            for sd in td.score_deltas:
                status_str = f"({sd.status.value})" if sd.status != DeltaStatus.UNCHANGED else ""
                baseline_str = f"{sd.baseline_score:.4f}" if sd.baseline_score is not None else "N/A"
                current_str = f"{sd.current_score:.4f}" if sd.current_score is not None else "N/A"
                lines.append(
                    f"- {sd.scorer_name}: {baseline_str} → {current_str} "
                    f"({sd.delta:+.4f}) {status_str}"
                )
            lines.append("")

    return "\n".join(lines)


def save_report(report: DeltaReport, path: str | Path) -> None:
    """Save a delta report to file.

    Args:
        report: The report to save.
        path: Output file path (JSON or Markdown based on extension).
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    if path.suffix == ".md":
        content = generate_markdown_report(report)
        path.write_text(content)
    else:
        with path.open("w") as f:
            json.dump(report.to_dict(), f, indent=2)

    logger.info(f"Saved delta report to {path}")


def load_report(path: str | Path) -> DeltaReport:
    """Load a delta report from file.

    Args:
        path: Path to report file (must be JSON).

    Returns:
        Loaded DeltaReport.
    """
    path = Path(path)
    with path.open() as f:
        data = json.load(f)

    return DeltaReport.from_dict(data)
