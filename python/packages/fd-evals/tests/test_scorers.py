"""Tests for deterministic scorers."""

from datetime import UTC, datetime

import pytest

from fd_evals.scorers import (
    CompositeScorer,
    FilesChangedScorer,
    LintScorer,
    PRCreatedScorer,
    TestPassScorer,
)
from fd_evals.task import EvalTask


@pytest.fixture
def sample_task() -> EvalTask:
    """Create a sample evaluation task."""
    return EvalTask(
        id="task_001",
        name="Test Task",
        description="A test task",
        input={"task": "Do something"},
        expected={
            "files_changed": ["src/main.py", "tests/test_main.py"],
            "pr_created": True,
            "tests_pass": True,
            "lint_pass": True,
        },
        difficulty="medium",
        category="testing",
    )


class TestFilesChangedScorer:
    """Tests for FilesChangedScorer."""

    def test_all_files_changed(self, sample_task: EvalTask) -> None:
        """Test when all expected files are changed."""
        scorer = FilesChangedScorer()
        result = scorer.score(
            sample_task,
            {},
            {"files_changed": ["src/main.py", "tests/test_main.py"]},
        )

        assert result.passed is True
        assert result.score == 1.0
        assert "All expected files changed" in result.message

    def test_missing_files(self, sample_task: EvalTask) -> None:
        """Test when some expected files are missing."""
        scorer = FilesChangedScorer()
        result = scorer.score(
            sample_task,
            {},
            {"files_changed": ["src/main.py"]},
        )

        assert result.passed is False
        assert result.score == 0.5
        assert "Missing expected files" in result.message

    def test_extra_files_non_strict(self, sample_task: EvalTask) -> None:
        """Test with extra files in non-strict mode."""
        scorer = FilesChangedScorer(strict=False)
        result = scorer.score(
            sample_task,
            {},
            {"files_changed": ["src/main.py", "tests/test_main.py", "extra.py"]},
        )

        assert result.passed is True
        assert result.score == 1.0

    def test_extra_files_strict(self, sample_task: EvalTask) -> None:
        """Test with extra files in strict mode."""
        scorer = FilesChangedScorer(strict=True)
        result = scorer.score(
            sample_task,
            {},
            {"files_changed": ["src/main.py", "tests/test_main.py", "extra.py"]},
        )

        assert result.passed is False
        assert result.score < 1.0

    def test_no_expected_files(self) -> None:
        """Test when task doesn't expect specific files."""
        task = EvalTask(
            id="task_002",
            name="No Files Task",
            description="Task with no file expectations",
            input={},
            expected={},
        )
        scorer = FilesChangedScorer()
        result = scorer.score(task, {}, {"files_changed": ["anything.py"]})

        assert result.passed is True
        assert result.details.get("skipped") is True


class TestTestPassScorer:
    """Tests for TestPassScorer."""

    def test_all_tests_pass(self, sample_task: EvalTask) -> None:
        """Test when all tests pass."""
        scorer = TestPassScorer()
        result = scorer.score(
            sample_task,
            {},
            {"test_results": {"passed": 10, "failed": 0, "total": 10}},
        )

        assert result.passed is True
        assert result.score == 1.0
        assert "10/10 passed" in result.message

    def test_some_tests_fail(self, sample_task: EvalTask) -> None:
        """Test when some tests fail."""
        scorer = TestPassScorer()
        result = scorer.score(
            sample_task,
            {},
            {"test_results": {"passed": 8, "failed": 2, "total": 10}},
        )

        assert result.passed is False
        assert result.score == 0.8
        assert "8/10 passed" in result.message

    def test_no_test_results(self, sample_task: EvalTask) -> None:
        """Test when no test results are provided."""
        scorer = TestPassScorer()
        result = scorer.score(sample_task, {}, {})

        assert result.passed is False
        assert result.score == 0.0
        assert "No test results found" in result.message

    def test_tests_not_required(self) -> None:
        """Test when tests are not required by the task."""
        task = EvalTask(
            id="task_003",
            name="No Tests Task",
            description="Task without test requirement",
            input={},
            expected={"tests_pass": False},
        )
        scorer = TestPassScorer()
        result = scorer.score(task, {}, {})

        assert result.passed is True
        assert result.details.get("skipped") is True


class TestPRCreatedScorer:
    """Tests for PRCreatedScorer."""

    def test_pr_created_with_url(self, sample_task: EvalTask) -> None:
        """Test when PR is created with URL."""
        scorer = PRCreatedScorer()
        result = scorer.score(
            sample_task,
            {},
            {"pr_url": "https://github.com/org/repo/pull/123"},
        )

        assert result.passed is True
        assert result.score == 1.0
        assert "PR created successfully" in result.message

    def test_pr_created_with_number(self, sample_task: EvalTask) -> None:
        """Test when PR is created with number only."""
        scorer = PRCreatedScorer()
        result = scorer.score(sample_task, {}, {"pr_number": 123})

        assert result.passed is True
        assert result.score == 1.0

    def test_pr_not_created(self, sample_task: EvalTask) -> None:
        """Test when PR is not created."""
        scorer = PRCreatedScorer()
        result = scorer.score(sample_task, {}, {})

        assert result.passed is False
        assert result.score == 0.0

    def test_pr_not_required(self) -> None:
        """Test when PR creation is not required."""
        task = EvalTask(
            id="task_004",
            name="No PR Task",
            description="Task without PR requirement",
            input={},
            expected={"pr_created": False},
        )
        scorer = PRCreatedScorer()
        result = scorer.score(task, {}, {})

        assert result.passed is True
        assert result.details.get("skipped") is True


class TestLintScorer:
    """Tests for LintScorer."""

    def test_lint_passes(self, sample_task: EvalTask) -> None:
        """Test when linting passes."""
        scorer = LintScorer()
        result = scorer.score(
            sample_task,
            {},
            {"lint_results": {"errors": [], "warnings": []}},
        )

        assert result.passed is True
        assert result.score == 1.0

    def test_lint_warnings_only(self, sample_task: EvalTask) -> None:
        """Test with warnings but no errors."""
        scorer = LintScorer()
        result = scorer.score(
            sample_task,
            {},
            {"lint_results": {"errors": [], "warnings": ["warning1", "warning2"]}},
        )

        assert result.passed is True
        assert 0.7 <= result.score < 1.0

    def test_lint_errors(self, sample_task: EvalTask) -> None:
        """Test with lint errors."""
        scorer = LintScorer()
        result = scorer.score(
            sample_task,
            {},
            {"lint_results": {"errors": ["error1"], "warnings": []}},
        )

        assert result.passed is False
        assert result.score < 1.0


class TestCompositeScorer:
    """Tests for CompositeScorer."""

    def test_all_scorers_pass(self, sample_task: EvalTask) -> None:
        """Test when all scorers pass."""
        composite = CompositeScorer(
            scorers=[
                FilesChangedScorer(weight=1.0),
                TestPassScorer(weight=1.0),
            ],
            require_all_pass=True,
        )

        result = composite.score(
            sample_task,
            {},
            {
                "files_changed": ["src/main.py", "tests/test_main.py"],
                "test_results": {"passed": 10, "failed": 0, "total": 10},
            },
        )

        assert result.passed is True
        assert result.score == 1.0
        assert "2/2 asserting scorers" in result.message
        assert result.details["assertion_coverage"] == 1.0

    def test_some_scorers_fail(self, sample_task: EvalTask) -> None:
        """Test when some scorers fail."""
        composite = CompositeScorer(
            scorers=[
                FilesChangedScorer(weight=1.0),
                TestPassScorer(weight=1.0),
            ],
            require_all_pass=True,
        )

        result = composite.score(
            sample_task,
            {},
            {
                "files_changed": ["src/main.py"],  # Missing one file
                "test_results": {"passed": 10, "failed": 0, "total": 10},
            },
        )

        assert result.passed is False
        assert 0 < result.score < 1.0

    def test_weighted_scoring(self, sample_task: EvalTask) -> None:
        """Test weighted scoring."""
        composite = CompositeScorer(
            scorers=[
                FilesChangedScorer(weight=2.0),  # Double weight
                TestPassScorer(weight=1.0),
            ],
            require_all_pass=False,
        )

        # Files score = 0.5 (weight 2.0), Tests score = 1.0 (weight 1.0)
        # Weighted average = (0.5 * 2.0 + 1.0 * 1.0) / 3.0 = 2.0 / 3.0 = 0.667
        result = composite.score(
            sample_task,
            {},
            {
                "files_changed": ["src/main.py"],  # Half score
                "test_results": {"passed": 10, "failed": 0, "total": 10},
            },
        )

        expected_score = (0.5 * 2.0 + 1.0 * 1.0) / 3.0
        assert abs(result.score - expected_score) < 0.01


class TestSkipsAreNotPasses:
    """A scorer that had nothing to assert must not lift the score.

    This is the second half of issue #31. Once the suite's declared scorers
    were loaded, the safe-PR suites reported a flat 1.00 -- but half of every
    run's scorer results were skips returning a full score for having nothing
    to check. `CompositeScorer` folded them into the weighted average, so a
    skip was arithmetically identical to an earned pass and the number said
    nothing about the agent.
    """

    @staticmethod
    def _task(**expected) -> EvalTask:
        return EvalTask(
            id="t1",
            name="t",
            description="d",
            input={},
            expected=expected,
        )

    def test_a_skip_is_excluded_from_the_average(self) -> None:
        from fd_evals.scorers.output_match import ExpectedOutputMatchScorer
        from fd_evals.scorers.schema import SchemaScorer

        # No output_schema declared -> SchemaScorer skips. min_length declared
        # and unmet -> ExpectedOutputMatch genuinely fails.
        task = self._task(min_length=500)
        composite = CompositeScorer(
            scorers=[SchemaScorer(weight=1.0), ExpectedOutputMatchScorer(weight=1.0)],
        )
        result = composite.score(task, "short", {})

        # Folding the skip in would give (1.0 + 0.0) / 2 = 0.5 and read as a pass.
        assert result.score == 0.0, "the skip must not average away a real failure"
        assert result.passed is False
        assert result.details["skipped_scorers"] == ["SchemaScorer"]
        assert result.details["asserted_scorers"] == ["ExpectedOutputMatch"]
        assert result.details["assertion_coverage"] == 0.5

    def test_all_scorers_skipping_is_not_a_pass(self) -> None:
        from fd_evals.scorers.output_match import ExpectedOutputMatchScorer
        from fd_evals.scorers.schema import SchemaScorer

        task = self._task(files_changed=["README.md"])  # nothing either scorer reads
        composite = CompositeScorer(
            scorers=[SchemaScorer(weight=1.0), ExpectedOutputMatchScorer(weight=1.0)],
        )
        result = composite.score(task, "anything at all", {})

        assert result.passed is False, "an unscored task must never report as passed"
        assert result.score == 0.0
        assert result.details["unscored"] is True
        assert result.details["assertion_coverage"] == 0.0
        assert "No scorer asserted anything" in result.message

    def test_skip_flag_survives_into_the_report(self) -> None:
        from fd_evals.scorers.schema import SchemaScorer

        result = SchemaScorer().score(self._task(), "out", {})
        assert result.skipped is True
        assert result.score == 1.0, "score stays 1.0 for readers that only see the float"

    def test_summary_assertion_coverage_counts_skips(self) -> None:
        from fd_evals.task import EvalResult, EvalRunSummary, ScorerResult

        def _result(*skips: bool) -> EvalResult:
            return EvalResult(
                task_id="t",
                task_name="t",
                run_id=None,
                passed=True,
                total_score=1.0,
                scorer_results=[
                    ScorerResult(
                        scorer_name=f"s{i}",
                        passed=True,
                        score=1.0,
                        message="",
                        skipped=s,
                    )
                    for i, s in enumerate(skips)
                ],
                execution_time_ms=0,
                input_tokens=0,
                output_tokens=0,
                cost_cents=0.0,
            )

        summary = EvalRunSummary(
            run_id="r",
            dataset_name="d",
            total_tasks=2,
            passed_tasks=2,
            failed_tasks=0,
            average_score=1.0,
            total_cost_cents=0.0,
            total_input_tokens=0,
            total_output_tokens=0,
            total_execution_time_ms=0,
            results=[_result(True, False), _result(True, False)],
            started_at=datetime.now(tz=UTC),
        )
        # This is exactly the shape of the committed safe-PR reports: a perfect
        # average over half-vacuous scoring.
        assert summary.average_score == 1.0
        assert summary.assertion_coverage == 0.5
        assert summary.to_dict()["assertion_coverage"] == 0.5
