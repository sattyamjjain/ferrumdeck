"""File-related scorers."""

from typing import Any

from fd_evals.scorers.base import BaseScorer
from fd_evals.task import EvalTask, ScorerResult


class FilesChangedScorer(BaseScorer):
    """Scorer that checks if expected files were changed.

    Verifies that the agent modified the correct files as specified
    in the task's expected output.
    """

    def __init__(self, strict: bool = False, weight: float = 1.0):
        """Initialize the scorer.

        Args:
            strict: If True, require exact match. If False, allow extra files.
            weight: Weight for composite scoring.
        """
        super().__init__(name="FilesChangedScorer", weight=weight)
        self.strict = strict

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check if expected files were changed.

        Args:
            task: Task with expected.files_changed list.
            actual_output: Agent output (string or dict).
            run_context: Must contain 'files_changed' list.

        Returns:
            ScorerResult based on file changes.
        """
        expected_files = set(task.expected.get("files_changed", []))
        actual_files = set(run_context.get("files_changed", []))

        if not expected_files:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="No specific files expected to change",
                details={"skipped": True},
            )

        # Check which expected files were actually changed
        matched = expected_files & actual_files
        missing = expected_files - actual_files
        extra = actual_files - expected_files

        # Calculate score
        match_ratio = len(matched) / len(expected_files) if expected_files else 1.0

        if self.strict:
            # In strict mode, extra files count against the score
            if extra:
                score = match_ratio * 0.5
                passed = False
            else:
                score = match_ratio
                passed = len(missing) == 0
        else:
            # In non-strict mode, extra files are okay
            score = match_ratio
            passed = len(missing) == 0

        if passed:
            message = f"All expected files changed: {list(matched)}"
        elif missing:
            message = f"Missing expected files: {list(missing)}"
        else:
            message = f"Unexpected files changed: {list(extra)}"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=message,
            details={
                "expected": list(expected_files),
                "actual": list(actual_files),
                "matched": list(matched),
                "missing": list(missing),
                "extra": list(extra),
                "strict_mode": self.strict,
            },
        )


class FilesCreatedScorer(BaseScorer):
    """Scorer that checks if expected files were created."""

    def __init__(self, weight: float = 1.0):
        super().__init__(name="FilesCreatedScorer", weight=weight)

    def score(
        self,
        task: EvalTask,
        actual_output: str | dict[str, Any],
        run_context: dict[str, Any],
    ) -> ScorerResult:
        """Check if expected files were created.

        Args:
            task: Task with expected.file_created or expected.files_created.
            actual_output: Agent output (string or dict).
            run_context: Must contain 'files_created' list.

        Returns:
            ScorerResult based on file creation.
        """
        # Support both singular and plural
        file_created = task.expected.get("file_created", False)
        files_created = task.expected.get("files_created", [])

        if not file_created and not files_created:
            return ScorerResult(
                scorer_name=self.name,
                passed=True,
                score=1.0,
                message="No file creation expected",
                details={"skipped": True},
            )

        actual_created = set(run_context.get("files_created", []))

        if file_created and isinstance(file_created, bool):
            # Just check if any file was created
            passed = len(actual_created) > 0
            score = 1.0 if passed else 0.0
            message = (
                f"Files created: {list(actual_created)}" if passed else "No files were created"
            )
        else:
            # Check specific files
            expected_set = set(files_created) if files_created else {file_created}
            matched = expected_set & actual_created
            missing = expected_set - actual_created

            score = len(matched) / len(expected_set) if expected_set else 1.0
            passed = len(missing) == 0
            message = f"Created {len(matched)}/{len(expected_set)} expected files"

        return ScorerResult(
            scorer_name=self.name,
            passed=passed,
            score=score,
            message=message,
            details={"files_created": list(actual_created)},
        )
