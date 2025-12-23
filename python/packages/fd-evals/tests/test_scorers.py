"""Tests for deterministic scorers."""

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
        assert "2/2 scorers" in result.message

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
