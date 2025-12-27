"""Test-related scorers."""

from typing import Any

from fd_evals.scorers.base import BaseScorer
from fd_evals.task import EvalTask, ScorerResult


class TestPassScorer(BaseScorer):
    """Scorer that checks if tests passed.

    This is a deterministic scorer that checks the test results
    from the run context.
    """

    def __init__(self, weight: float = 1.0):
        super().__init__(name="TestPassScorer", weight=weight)

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check if tests passed.

        Args:
            task: The evaluation task.
            actual_output: Agent output (string or dict, not used directly).
            run_context: Must contain 'test_results' with 'passed' and 'total'.

        Returns:
            ScorerResult based on test pass rate.
        """
        # Check if tests_pass is expected
        expected_tests_pass = task.expected.get("tests_pass", True)
        if not expected_tests_pass:
            # Task doesn't require tests to pass
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="Tests not required for this task",
                details={"skipped": True},
            )

        test_results = run_context.get("test_results", {})

        if not test_results:
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message="No test results found in run context",
                details={"error": "missing_test_results"},
            )

        passed = test_results.get("passed", 0)
        failed = test_results.get("failed", 0)
        total = test_results.get("total", passed + failed)

        if total == 0:
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message="No tests were run",
                details={"error": "no_tests"},
            )

        pass_rate = passed / total
        all_passed = failed == 0

        return ScorerResult(
            scorer_name=self.name,
            passed=all_passed,
            score=pass_rate,
            message=f"Tests: {passed}/{total} passed ({pass_rate * 100:.1f}%)",
            details={
                "passed": passed,
                "failed": failed,
                "total": total,
                "pass_rate": pass_rate,
            },
        )


class TestCoverageScorer(BaseScorer):
    """Scorer that checks test coverage improvement."""

    def __init__(self, min_coverage: float = 0.0, weight: float = 1.0):
        super().__init__(name="TestCoverageScorer", weight=weight)
        self.min_coverage = min_coverage

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check test coverage.

        Args:
            task: The evaluation task.
            actual_output: Agent output (string or dict).
            run_context: Must contain 'coverage' with coverage percentage.

        Returns:
            ScorerResult based on coverage.
        """
        expected_improved = task.expected.get("test_coverage_improved", False)
        if not expected_improved:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="Coverage improvement not required",
                details={"skipped": True},
            )

        coverage_before = run_context.get("coverage_before", 0.0)
        coverage_after = run_context.get("coverage_after", 0.0)

        improved = coverage_after > coverage_before
        meets_minimum = coverage_after >= self.min_coverage

        if improved and meets_minimum:
            score = 1.0
            passed = True
            message = f"Coverage improved: {coverage_before:.1f}% -> {coverage_after:.1f}%"
        elif improved:
            score = 0.75
            passed = True
            message = f"Coverage improved but below minimum: {coverage_after:.1f}% < {self.min_coverage:.1f}%"
        else:
            score = 0.0
            passed = False
            message = f"Coverage did not improve: {coverage_before:.1f}% -> {coverage_after:.1f}%"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=message,
            details={
                "coverage_before": coverage_before,
                "coverage_after": coverage_after,
                "improved": improved,
                "min_coverage": self.min_coverage,
            },
        )
