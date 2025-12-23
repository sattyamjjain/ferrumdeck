"""Code quality scorers."""

from typing import Any

from fd_evals.scorers.base import BaseScorer
from fd_evals.task import EvalTask, ScorerResult


class LintScorer(BaseScorer):
    """Scorer that checks if code passes linting."""

    def __init__(self, linter: str = "ruff", weight: float = 1.0):
        super().__init__(name="LintScorer", weight=weight)
        self.linter = linter

    def score(
        self,
        task: EvalTask,
        actual_output: dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check if linting passes.

        Args:
            task: Task with expected.lint_pass.
            actual_output: Agent output.
            run_context: Must contain 'lint_results'.

        Returns:
            ScorerResult based on lint results.
        """
        expected_lint_pass = task.expected.get("lint_pass", False)

        if not expected_lint_pass:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="Linting not required for this task",
                details={"skipped": True},
            )

        lint_results = run_context.get("lint_results", {})

        if not lint_results:
            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message="No lint results found",
                details={"error": "missing_lint_results"},
            )

        errors = lint_results.get("errors", [])
        warnings = lint_results.get("warnings", [])
        passed = len(errors) == 0

        # Score based on issues found
        if len(errors) == 0 and len(warnings) == 0:
            score = 1.0
        elif len(errors) == 0:
            # Warnings only - slight penalty
            score = max(0.7, 1.0 - (len(warnings) * 0.05))
        else:
            # Errors - significant penalty
            score = max(0.0, 1.0 - (len(errors) * 0.2) - (len(warnings) * 0.02))

        if passed:
            message = f"Linting passed ({len(warnings)} warnings)"
        else:
            message = f"Linting failed: {len(errors)} errors, {len(warnings)} warnings"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=message,
            details={
                "linter": self.linter,
                "errors": errors[:10],  # Limit to first 10
                "warnings": warnings[:10],
                "total_errors": len(errors),
                "total_warnings": len(warnings),
            },
        )


class TypeCheckScorer(BaseScorer):
    """Scorer that checks if type checking passes."""

    def __init__(self, type_checker: str = "mypy", weight: float = 1.0):
        super().__init__(name="TypeCheckScorer", weight=weight)
        self.type_checker = type_checker

    def score(
        self,
        task: EvalTask,
        actual_output: dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check if type checking passes.

        Args:
            task: Task with expected.type_check_pass.
            actual_output: Agent output.
            run_context: Must contain 'type_check_results'.

        Returns:
            ScorerResult based on type check results.
        """
        expected_type_hints = task.expected.get("type_hints_added", False)
        expected_type_check = task.expected.get("type_check_pass", False)

        if not expected_type_hints and not expected_type_check:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="Type checking not required",
                details={"skipped": True},
            )

        type_results = run_context.get("type_check_results", {})

        if not type_results:
            # If type hints were added, that's a partial success
            if expected_type_hints and run_context.get("type_hints_found", False):
                return ScorerResult(
                    scorer_name=self.name,
                    passed=True,
                    score=0.8,
                    message="Type hints added (no type check ran)",
                    details={"type_hints_added": True},
                )

            return ScorerResult(
                scorer_name=self.name,
                passed=False,
                score=0.0,
                message="No type check results found",
                details={"error": "missing_type_results"},
            )

        errors = type_results.get("errors", [])
        passed = len(errors) == 0

        if passed:
            score = 1.0
            message = "Type checking passed"
        else:
            score = max(0.0, 1.0 - (len(errors) * 0.1))
            message = f"Type checking failed: {len(errors)} errors"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=message,
            details={
                "type_checker": self.type_checker,
                "errors": errors[:10],
                "total_errors": len(errors),
            },
        )
