"""Base scorer interface and composite scorer."""

from abc import ABC, abstractmethod
from typing import Any

from fd_evals.task import EvalTask, ScorerResult


class BaseScorer(ABC):
    """Abstract base class for all scorers.

    Scorers are deterministic evaluators that assess specific aspects
    of an agent's output. Each scorer returns a score between 0.0 and 1.0.
    """

    def __init__(self, name: str | None = None, weight: float = 1.0):
        """Initialize the scorer.

        Args:
            name: Optional custom name for the scorer.
            weight: Weight for composite scoring (default 1.0).
        """
        self._name = name or self.__class__.__name__
        self.weight = weight

    @property
    def name(self) -> str:
        """Return the scorer name."""
        return self._name

    @abstractmethod
    def score(
        self,
        task: EvalTask,
        actual_output: dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Score the agent's output against expected results.

        Args:
            task: The evaluation task with expected outputs.
            actual_output: The actual output from the agent run.
            run_context: Additional context from the run (files changed, logs, etc).

        Returns:
            ScorerResult with pass/fail, score, and details.
        """

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r}, weight={self.weight})"


class CompositeScorer(BaseScorer):
    """A scorer that combines multiple scorers.

    The composite score is calculated as a weighted average of all
    component scorer results.
    """

    def __init__(
        self,
        scorers: list[BaseScorer],
        name: str = "CompositeScorer",
        require_all_pass: bool = False,
    ):
        """Initialize the composite scorer.

        Args:
            scorers: List of scorers to combine.
            name: Name for this composite scorer.
            require_all_pass: If True, overall pass requires all scorers to pass.
        """
        super().__init__(name=name)
        self.scorers = scorers
        self.require_all_pass = require_all_pass

    def score(
        self,
        task: EvalTask,
        actual_output: dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Score using all component scorers.

        Returns:
            ScorerResult with weighted average score and all sub-results.
        """
        sub_results: list[dict[str, Any]] = []
        total_weight = 0.0
        weighted_score = 0.0
        all_passed = True

        for scorer in self.scorers:
            result = scorer.score(task, actual_output, run_context)
            sub_results.append({
                "scorer": scorer.name,
                "passed": result.passed,
                "score": result.score,
                "weight": scorer.weight,
                "message": result.message,
            })

            weighted_score += result.score * scorer.weight
            total_weight += scorer.weight
            if not result.passed:
                all_passed = False

        final_score = weighted_score / total_weight if total_weight > 0 else 0.0

        if self.require_all_pass:
            passed = all_passed
        else:
            passed = final_score >= 0.5

        passed_count = sum(1 for r in sub_results if r["passed"])
        message = f"Passed {passed_count}/{len(self.scorers)} scorers (score: {final_score:.2f})"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=final_score,
            message=message,
            details={"sub_results": sub_results},
        )
