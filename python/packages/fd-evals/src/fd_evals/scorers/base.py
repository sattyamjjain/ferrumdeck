"""Base scorer interface and composite scorer."""

from abc import ABC, abstractmethod
from typing import Any

from fd_evals.task import EvalTask, ScorerResult


class BaseScorer(ABC):
    """Abstract base class for all scorers.

    Scorers are deterministic evaluators that assess specific aspects
    of an agent's output. Each scorer returns a score between 0.0 and 1.0.

    ``EXPECTED_KEYS`` names the keys this scorer reads out of ``task.expected``.
    It is what lets :func:`fd_evals.suite.unasserted_expectations` answer the
    question the safe-PR suite could not: *does any scorer in this suite
    actually look at what the dataset claims to expect?* A dataset key that no
    declared scorer reads is an expectation the eval is silently not testing.
    """

    #: Keys in ``task.expected`` this scorer consults. Empty means the scorer
    #: asserts on run context or output shape rather than a declared key.
    EXPECTED_KEYS: tuple[str, ...] = ()

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
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Score the agent's output against expected results.

        Args:
            task: The evaluation task with expected outputs.
            actual_output: The actual output from the agent run (string or dict).
            run_context: Additional context from the run (files changed, logs, etc).

        Returns:
            ScorerResult with pass/fail, score, and details.
        """

    def __repr__(self) -> str:
        return f"{self.__class__.__name__}(name={self.name!r}, weight={self.weight})"


class CompositeScorer(BaseScorer):
    """A scorer that combines multiple scorers.

    The composite score is the weighted average of the component scorers that
    **actually asserted something**. Scorers that skipped — because the task
    declared no schema, no output expectation, no lint requirement — are
    excluded from the average and counted separately.

    This exclusion is the point of the class. Previously every scorer's
    ``score * weight`` was folded in regardless, so a skip returning 1.0 was
    arithmetically identical to an earned pass. On the safe-PR regression suite
    that meant 40 of 80 scorer results per run were vacuous, and the suite
    reported a flat 1.00 while asserting nothing about whether the agent had
    done the task. A scorer that did not run is not evidence of success.

    When *every* scorer skips there is no assertion to average, so the task is
    reported as not passed with score 0.0 and a message saying so. An eval that
    asserted nothing must never be counted as evidence that anything worked.
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
        actual_output: str | dict[str, Any],
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
        skipped_names: list[str] = []
        asserted_names: list[str] = []

        for scorer in self.scorers:
            result = scorer.score(task, actual_output, run_context)
            sub_results.append(
                {
                    "scorer": scorer.name,
                    "passed": result.passed,
                    "score": result.score,
                    "weight": scorer.weight,
                    "message": result.message,
                    "skipped": result.skipped,
                }
            )

            if result.skipped:
                # Contributes neither score nor weight: it asserted nothing, so
                # it can neither raise nor lower the average.
                skipped_names.append(scorer.name)
                continue

            asserted_names.append(scorer.name)
            weighted_score += result.score * scorer.weight
            total_weight += scorer.weight
            if not result.passed:
                all_passed = False

        if total_weight == 0.0:
            # Every scorer skipped. There is no measurement here, and reporting
            # 1.0 would state a success nothing observed.
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message=(
                    f"No scorer asserted anything on this task "
                    f"({len(skipped_names)}/{len(self.scorers)} skipped: "
                    f"{', '.join(skipped_names)})"
                ),
                details={
                    "sub_results": sub_results,
                    "asserted_scorers": [],
                    "skipped_scorers": skipped_names,
                    "assertion_coverage": 0.0,
                    "unscored": True,
                },
            )

        final_score = weighted_score / total_weight

        if self.require_all_pass:
            passed = all_passed
        else:
            passed = final_score >= 0.5

        passed_count = sum(1 for r in sub_results if r["passed"] and not r["skipped"])
        coverage = len(asserted_names) / len(self.scorers) if self.scorers else 0.0
        message = (
            f"Passed {passed_count}/{len(asserted_names)} asserting scorers "
            f"(score: {final_score:.2f})"
        )
        if skipped_names:
            message += f"; {len(skipped_names)} skipped: {', '.join(skipped_names)}"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=final_score,
            message=message,
            details={
                "sub_results": sub_results,
                "asserted_scorers": asserted_names,
                "skipped_scorers": skipped_names,
                "assertion_coverage": coverage,
            },
        )
