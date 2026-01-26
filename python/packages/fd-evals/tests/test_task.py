"""Tests for evaluation task data structures."""

from datetime import UTC, datetime

from fd_evals.task import EvalResult, EvalRunSummary, EvalTask, ScorerResult


# ==========================================================================
# EVL-TSK-001: EvalTask creation and serialization
# ==========================================================================
class TestEvalTask:
    """Tests for EvalTask dataclass."""

    def test_eval_task_creation(self) -> None:
        """Test creating an EvalTask."""
        task = EvalTask(
            id="task_001",
            name="Test Task",
            description="A test task description",
            input={"prompt": "Do something"},
            expected={"files_changed": ["main.py"]},
        )

        assert task.id == "task_001"
        assert task.name == "Test Task"
        assert task.description == "A test task description"
        assert task.input == {"prompt": "Do something"}
        assert task.expected == {"files_changed": ["main.py"]}

    def test_eval_task_defaults(self) -> None:
        """Test EvalTask default values."""
        task = EvalTask(
            id="task_001",
            name="Test",
            description="Desc",
            input={},
            expected={},
        )

        assert task.difficulty == "medium"
        assert task.category == "general"
        assert task.tags == []
        assert task.config == {}

    def test_eval_task_with_tags(self) -> None:
        """Test EvalTask with tags."""
        task = EvalTask(
            id="task_002",
            name="Tagged Task",
            description="Desc",
            input={},
            expected={},
            tags=["python", "testing", "api"],
        )

        assert len(task.tags) == 3
        assert "python" in task.tags

    def test_eval_task_with_config(self) -> None:
        """Test EvalTask with custom config."""
        task = EvalTask(
            id="task_003",
            name="Configured Task",
            description="Desc",
            input={},
            expected={},
            config={"timeout": 300, "max_retries": 3},
        )

        assert task.config["timeout"] == 300
        assert task.config["max_retries"] == 3

    def test_eval_task_from_dict_full(self) -> None:
        """Test creating EvalTask from complete dictionary."""
        data = {
            "id": "task_full",
            "name": "Full Task",
            "description": "Complete task definition",
            "input": {"task": "complete"},
            "expected": {"result": "success"},
            "difficulty": "hard",
            "category": "integration",
            "tags": ["complex", "multi-step"],
            "config": {"parallel": False},
        }

        task = EvalTask.from_dict(data)

        assert task.id == "task_full"
        assert task.difficulty == "hard"
        assert task.category == "integration"
        assert task.tags == ["complex", "multi-step"]
        assert task.config == {"parallel": False}

    def test_eval_task_to_dict_roundtrip(self) -> None:
        """Test EvalTask serialization roundtrip."""
        original = EvalTask(
            id="task_roundtrip",
            name="Roundtrip Task",
            description="Testing roundtrip",
            input={"key": "value"},
            expected={"output": "result"},
            difficulty="easy",
            category="testing",
            tags=["test"],
            config={"debug": True},
        )

        data = original.to_dict()
        restored = EvalTask.from_dict(data)

        assert restored.id == original.id
        assert restored.name == original.name
        assert restored.difficulty == original.difficulty
        assert restored.tags == original.tags


# ==========================================================================
# EVL-TSK-002: ScorerResult dataclass
# ==========================================================================
class TestScorerResult:
    """Tests for ScorerResult dataclass."""

    def test_scorer_result_passed(self) -> None:
        """Test creating a passed ScorerResult."""
        result = ScorerResult(
            scorer_name="files_changed",
            passed=True,
            score=1.0,
            message="All files changed correctly",
        )

        assert result.scorer_name == "files_changed"
        assert result.passed is True
        assert result.score == 1.0
        assert "files changed" in result.message

    def test_scorer_result_failed(self) -> None:
        """Test creating a failed ScorerResult."""
        result = ScorerResult(
            scorer_name="tests_pass",
            passed=False,
            score=0.5,
            message="Only 5/10 tests passed",
        )

        assert result.passed is False
        assert result.score == 0.5

    def test_scorer_result_with_details(self) -> None:
        """Test ScorerResult with details."""
        result = ScorerResult(
            scorer_name="lint",
            passed=False,
            score=0.8,
            message="2 lint errors found",
            details={
                "errors": ["Line 10: missing semicolon", "Line 20: unused import"],
                "warnings": [],
                "error_count": 2,
            },
        )

        assert result.details["error_count"] == 2
        assert len(result.details["errors"]) == 2

    def test_scorer_result_defaults(self) -> None:
        """Test ScorerResult default values."""
        result = ScorerResult(
            scorer_name="test",
            passed=True,
            score=1.0,
            message="OK",
        )

        assert result.details == {}


# ==========================================================================
# EVL-TSK-003: EvalResult dataclass
# ==========================================================================
class TestEvalResult:
    """Tests for EvalResult dataclass."""

    def test_eval_result_success(self) -> None:
        """Test creating a successful EvalResult."""
        result = EvalResult(
            task_id="task_001",
            task_name="Test Task",
            run_id="run_123",
            passed=True,
            total_score=0.95,
            scorer_results=[
                ScorerResult("files", True, 1.0, "OK"),
                ScorerResult("tests", True, 0.9, "9/10 passed"),
            ],
            execution_time_ms=5000,
            input_tokens=1000,
            output_tokens=500,
            cost_cents=0.05,
        )

        assert result.task_id == "task_001"
        assert result.passed is True
        assert result.total_score == 0.95
        assert len(result.scorer_results) == 2
        assert result.error is None

    def test_eval_result_failure(self) -> None:
        """Test creating a failed EvalResult."""
        result = EvalResult(
            task_id="task_002",
            task_name="Failed Task",
            run_id="run_456",
            passed=False,
            total_score=0.3,
            scorer_results=[
                ScorerResult("files", False, 0.3, "Missing files"),
            ],
            execution_time_ms=3000,
            input_tokens=500,
            output_tokens=200,
            cost_cents=0.02,
            error="Task failed: insufficient output",
        )

        assert result.passed is False
        assert result.error is not None

    def test_eval_result_with_trace(self) -> None:
        """Test EvalResult with trace ID."""
        result = EvalResult(
            task_id="task_003",
            task_name="Traced Task",
            run_id="run_789",
            passed=True,
            total_score=1.0,
            scorer_results=[],
            execution_time_ms=1000,
            input_tokens=100,
            output_tokens=50,
            cost_cents=0.01,
            trace_id="trace_abc123",
        )

        assert result.trace_id == "trace_abc123"

    def test_eval_result_to_dict(self) -> None:
        """Test EvalResult serialization."""
        result = EvalResult(
            task_id="task_ser",
            task_name="Serialized Task",
            run_id="run_ser",
            passed=True,
            total_score=0.9,
            scorer_results=[
                ScorerResult("test", True, 0.9, "OK", {"detail": "value"}),
            ],
            execution_time_ms=2000,
            input_tokens=200,
            output_tokens=100,
            cost_cents=0.02,
        )

        data = result.to_dict()

        assert data["task_id"] == "task_ser"
        assert data["passed"] is True
        assert len(data["scorer_results"]) == 1
        assert data["scorer_results"][0]["score"] == 0.9
        assert "timestamp" in data

    def test_eval_result_timestamp_auto(self) -> None:
        """Test that timestamp is auto-generated."""
        before = datetime.now(tz=UTC)
        result = EvalResult(
            task_id="task_time",
            task_name="Timed Task",
            run_id="run_time",
            passed=True,
            total_score=1.0,
            scorer_results=[],
            execution_time_ms=0,
            input_tokens=0,
            output_tokens=0,
            cost_cents=0,
        )
        after = datetime.now(tz=UTC)

        assert result.timestamp >= before
        assert result.timestamp <= after


# ==========================================================================
# EVL-TSK-004: EvalRunSummary dataclass
# ==========================================================================
class TestEvalRunSummary:
    """Tests for EvalRunSummary dataclass."""

    def test_eval_run_summary_creation(self) -> None:
        """Test creating EvalRunSummary."""
        now = datetime.now(tz=UTC)
        summary = EvalRunSummary(
            run_id="eval_001",
            dataset_name="test_dataset",
            total_tasks=10,
            passed_tasks=8,
            failed_tasks=2,
            average_score=0.85,
            total_cost_cents=5.0,
            total_input_tokens=10000,
            total_output_tokens=5000,
            total_execution_time_ms=60000,
            results=[],
            started_at=now,
        )

        assert summary.run_id == "eval_001"
        assert summary.total_tasks == 10
        assert summary.passed_tasks == 8
        assert summary.failed_tasks == 2

    def test_eval_run_summary_pass_rate(self) -> None:
        """Test pass_rate property calculation."""
        now = datetime.now(tz=UTC)
        summary = EvalRunSummary(
            run_id="eval_rate",
            dataset_name="rate_test",
            total_tasks=10,
            passed_tasks=7,
            failed_tasks=3,
            average_score=0.7,
            total_cost_cents=1.0,
            total_input_tokens=1000,
            total_output_tokens=500,
            total_execution_time_ms=10000,
            results=[],
            started_at=now,
        )

        assert summary.pass_rate == 70.0

    def test_eval_run_summary_pass_rate_all_pass(self) -> None:
        """Test pass_rate when all tasks pass."""
        now = datetime.now(tz=UTC)
        summary = EvalRunSummary(
            run_id="eval_all_pass",
            dataset_name="all_pass",
            total_tasks=5,
            passed_tasks=5,
            failed_tasks=0,
            average_score=1.0,
            total_cost_cents=1.0,
            total_input_tokens=500,
            total_output_tokens=250,
            total_execution_time_ms=5000,
            results=[],
            started_at=now,
        )

        assert summary.pass_rate == 100.0

    def test_eval_run_summary_pass_rate_zero_tasks(self) -> None:
        """Test pass_rate with zero tasks."""
        now = datetime.now(tz=UTC)
        summary = EvalRunSummary(
            run_id="eval_zero",
            dataset_name="empty",
            total_tasks=0,
            passed_tasks=0,
            failed_tasks=0,
            average_score=0.0,
            total_cost_cents=0.0,
            total_input_tokens=0,
            total_output_tokens=0,
            total_execution_time_ms=0,
            results=[],
            started_at=now,
        )

        assert summary.pass_rate == 0.0

    def test_eval_run_summary_to_dict(self) -> None:
        """Test EvalRunSummary serialization."""
        started = datetime.now(tz=UTC)
        completed = datetime.now(tz=UTC)

        summary = EvalRunSummary(
            run_id="eval_ser",
            dataset_name="serialized",
            total_tasks=5,
            passed_tasks=4,
            failed_tasks=1,
            average_score=0.8,
            total_cost_cents=2.5,
            total_input_tokens=2000,
            total_output_tokens=1000,
            total_execution_time_ms=30000,
            results=[],
            started_at=started,
            completed_at=completed,
        )

        data = summary.to_dict()

        assert data["run_id"] == "eval_ser"
        assert data["pass_rate"] == 80.0
        assert data["started_at"] is not None
        assert data["completed_at"] is not None
        assert isinstance(data["started_at"], str)

    def test_eval_run_summary_to_dict_no_completion(self) -> None:
        """Test serialization without completion time."""
        started = datetime.now(tz=UTC)

        summary = EvalRunSummary(
            run_id="eval_incomplete",
            dataset_name="incomplete",
            total_tasks=3,
            passed_tasks=0,
            failed_tasks=0,
            average_score=0.0,
            total_cost_cents=0.0,
            total_input_tokens=0,
            total_output_tokens=0,
            total_execution_time_ms=0,
            results=[],
            started_at=started,
        )

        data = summary.to_dict()

        assert data["completed_at"] is None

    def test_eval_run_summary_with_results(self) -> None:
        """Test summary with actual results."""
        started = datetime.now(tz=UTC)

        results = [
            EvalResult(
                task_id=f"task_{i}",
                task_name=f"Task {i}",
                run_id=f"run_{i}",
                passed=i % 2 == 0,
                total_score=0.5 + (i * 0.1),
                scorer_results=[],
                execution_time_ms=1000,
                input_tokens=100,
                output_tokens=50,
                cost_cents=0.01,
            )
            for i in range(5)
        ]

        summary = EvalRunSummary(
            run_id="eval_with_results",
            dataset_name="results_test",
            total_tasks=5,
            passed_tasks=3,
            failed_tasks=2,
            average_score=0.7,
            total_cost_cents=0.05,
            total_input_tokens=500,
            total_output_tokens=250,
            total_execution_time_ms=5000,
            results=results,
            started_at=started,
        )

        assert len(summary.results) == 5
        data = summary.to_dict()
        assert len(data["results"]) == 5
