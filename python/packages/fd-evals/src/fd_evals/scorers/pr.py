"""Pull request related scorers."""

from typing import Any

from fd_evals.scorers.base import BaseScorer
from fd_evals.task import EvalTask, ScorerResult


class PRCreatedScorer(BaseScorer):
    """Scorer that checks if a PR was created successfully."""

    def __init__(self, weight: float = 1.0):
        super().__init__(name="PRCreatedScorer", weight=weight)

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check if a PR was created.

        Args:
            task: Task with expected.pr_created.
            actual_output: Agent output, may contain pr_url (string or dict).
            run_context: Additional context.

        Returns:
            ScorerResult based on PR creation.
        """
        expected_pr = task.expected.get("pr_created", False)

        if not expected_pr:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="PR creation not required",
                details={"skipped": True},
            )

        # Handle both string and dict outputs
        output_dict = actual_output if isinstance(actual_output, dict) else {}
        pr_url = run_context.get("pr_url") or output_dict.get("pr_url")
        pr_number = run_context.get("pr_number") or output_dict.get("pr_number")

        if pr_url or pr_number:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message=f"PR created successfully: {pr_url or f'#{pr_number}'}",
                details={
                    "pr_url": pr_url,
                    "pr_number": pr_number,
                },
            )

        return ScorerResult(
            scorer_name=self.name,
            passed=False,
            score=0.0,
            message="PR was not created",
            details={"error": "pr_not_created"},
        )


class PRQualityScorer(BaseScorer):
    """Scorer that checks PR quality (title, description, etc)."""

    def __init__(
        self,
        require_title: bool = True,
        require_description: bool = True,
        min_description_length: int = 50,
        weight: float = 1.0,
    ):
        super().__init__(name="PRQualityScorer", weight=weight)
        self.require_title = require_title
        self.require_description = require_description
        self.min_description_length = min_description_length

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check PR quality metrics.

        Args:
            task: The evaluation task.
            actual_output: Agent output with pr_title, pr_description (string or dict).
            run_context: Additional context.

        Returns:
            ScorerResult based on PR quality.
        """
        # Handle both string and dict outputs
        output_dict = actual_output if isinstance(actual_output, dict) else {}
        pr_title = run_context.get("pr_title") or output_dict.get("pr_title", "")
        pr_description = run_context.get("pr_description") or output_dict.get("pr_description", "")

        issues = []
        score_deductions = 0.0

        # Check title
        if self.require_title:
            if not pr_title:
                issues.append("Missing PR title")
                score_deductions += 0.3
            elif len(pr_title) < 10:
                issues.append("PR title too short")
                score_deductions += 0.1

        # Check description
        if self.require_description:
            if not pr_description:
                issues.append("Missing PR description")
                score_deductions += 0.4
            elif len(pr_description) < self.min_description_length:
                issues.append(f"PR description too short (< {self.min_description_length} chars)")
                score_deductions += 0.2

        score = max(0.0, 1.0 - score_deductions)
        passed = len(issues) == 0

        if passed:
            message = "PR meets quality standards"
        else:
            message = f"PR quality issues: {', '.join(issues)}"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=message,
            details={
                "title": pr_title,
                "description_length": len(pr_description),
                "issues": issues,
            },
        )
