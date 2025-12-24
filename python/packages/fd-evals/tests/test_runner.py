"""Tests for the evaluation runner."""

import json
from pathlib import Path

import pytest

from fd_evals.runner import EvalRunner
from fd_evals.scorers import FilesChangedScorer, PRCreatedScorer, TestPassScorer
from fd_evals.task import EvalTask


@pytest.fixture
def sample_dataset(tmp_path: Path) -> Path:
    """Create a sample dataset file."""
    tasks = [
        {
            "id": "task_001",
            "name": "Add README",
            "description": "Add a README file",
            "input": {"task": "Add README.md"},
            "expected": {
                "files_changed": ["README.md"],
                "pr_created": True,
                "tests_pass": True,
            },
            "difficulty": "easy",
            "category": "documentation",
        },
        {
            "id": "task_002",
            "name": "Fix Bug",
            "description": "Fix a bug in main.py",
            "input": {"task": "Fix the bug"},
            "expected": {
                "files_changed": ["src/main.py"],
                "pr_created": True,
                "tests_pass": True,
            },
            "difficulty": "medium",
            "category": "bugfix",
        },
    ]

    dataset_path = tmp_path / "tasks.jsonl"
    with dataset_path.open("w") as f:
        for task in tasks:
            f.write(json.dumps(task) + "\n")

    return dataset_path


@pytest.fixture
def runner() -> EvalRunner:
    """Create an eval runner with standard scorers."""
    return EvalRunner(
        scorers=[
            FilesChangedScorer(weight=1.0),
            PRCreatedScorer(weight=1.0),
            TestPassScorer(weight=1.0),
        ],
    )


class TestEvalRunner:
    """Tests for EvalRunner."""

    def test_load_tasks(self, runner: EvalRunner, sample_dataset: Path) -> None:
        """Test loading tasks from JSONL."""
        tasks = runner.load_tasks(sample_dataset)

        assert len(tasks) == 2
        assert tasks[0].id == "task_001"
        assert tasks[0].name == "Add README"
        assert tasks[1].id == "task_002"

    def test_load_tasks_empty_lines(self, runner: EvalRunner, tmp_path: Path) -> None:
        """Test loading tasks with empty lines."""
        dataset_path = tmp_path / "tasks_empty.jsonl"
        with dataset_path.open("w") as f:
            f.write(
                '{"id": "task_001", "name": "Task 1", "description": "Desc", "input": {}, "expected": {}}\n'
            )
            f.write("\n")
            f.write(
                '{"id": "task_002", "name": "Task 2", "description": "Desc", "input": {}, "expected": {}}\n'
            )

        tasks = runner.load_tasks(dataset_path)
        assert len(tasks) == 2

    def test_execute_task(self, runner: EvalRunner) -> None:
        """Test executing a single task."""
        task = EvalTask(
            id="test_001",
            name="Test Task",
            description="A test task",
            input={"task": "Do something"},
            expected={
                "files_changed": ["src/main.py"],
                "pr_created": True,
                "tests_pass": True,
            },
        )

        result = runner.execute_task(task, "test-agent")

        assert result.task_id == "test_001"
        assert result.task_name == "Test Task"
        assert result.run_id is not None
        assert result.execution_time_ms >= 0  # May be 0 for fast mock executions
        assert len(result.scorer_results) > 0

    def test_run_eval(self, runner: EvalRunner, sample_dataset: Path) -> None:
        """Test running a full evaluation."""
        summary = runner.run_eval(
            dataset_path=sample_dataset,
            agent_id="test-agent",
            max_tasks=2,
        )

        assert summary.total_tasks == 2
        assert summary.run_id.startswith("eval_")
        assert summary.dataset_name == sample_dataset.parent.name
        assert len(summary.results) == 2
        assert summary.completed_at is not None

    def test_run_eval_max_tasks(self, runner: EvalRunner, sample_dataset: Path) -> None:
        """Test running eval with max_tasks limit."""
        summary = runner.run_eval(
            dataset_path=sample_dataset,
            agent_id="test-agent",
            max_tasks=1,
        )

        assert summary.total_tasks == 1
        assert len(summary.results) == 1

    def test_save_report(self, runner: EvalRunner, sample_dataset: Path, tmp_path: Path) -> None:
        """Test saving evaluation report."""
        summary = runner.run_eval(
            dataset_path=sample_dataset,
            agent_id="test-agent",
        )

        output_path = tmp_path / "report.json"
        runner.save_report(summary, output_path)

        assert output_path.exists()

        with output_path.open() as f:
            data = json.load(f)

        assert data["run_id"] == summary.run_id
        assert data["total_tasks"] == summary.total_tasks
        assert len(data["results"]) == len(summary.results)


class TestEvalTask:
    """Tests for EvalTask."""

    def test_from_dict(self) -> None:
        """Test creating EvalTask from dictionary."""
        data = {
            "id": "task_001",
            "name": "Test Task",
            "description": "Description",
            "input": {"key": "value"},
            "expected": {"output": "result"},
            "difficulty": "hard",
            "category": "testing",
        }

        task = EvalTask.from_dict(data)

        assert task.id == "task_001"
        assert task.name == "Test Task"
        assert task.difficulty == "hard"
        assert task.category == "testing"

    def test_from_dict_defaults(self) -> None:
        """Test creating EvalTask with default values."""
        data = {
            "id": "task_001",
            "name": "Test Task",
            "description": "Description",
            "input": {},
            "expected": {},
        }

        task = EvalTask.from_dict(data)

        assert task.difficulty == "medium"
        assert task.category == "general"
        assert task.tags == []

    def test_to_dict(self) -> None:
        """Test converting EvalTask to dictionary."""
        task = EvalTask(
            id="task_001",
            name="Test Task",
            description="Description",
            input={"key": "value"},
            expected={"output": "result"},
        )

        data = task.to_dict()

        assert data["id"] == "task_001"
        assert data["input"] == {"key": "value"}
        assert data["expected"] == {"output": "result"}


class TestEvalRunSummary:
    """Tests for EvalRunSummary."""

    def test_pass_rate(self, runner: EvalRunner, sample_dataset: Path) -> None:
        """Test pass rate calculation."""
        summary = runner.run_eval(
            dataset_path=sample_dataset,
            agent_id="test-agent",
        )

        expected_rate = (summary.passed_tasks / summary.total_tasks) * 100
        assert summary.pass_rate == expected_rate

    def test_to_dict(self, runner: EvalRunner, sample_dataset: Path) -> None:
        """Test summary serialization."""
        summary = runner.run_eval(
            dataset_path=sample_dataset,
            agent_id="test-agent",
        )

        data = summary.to_dict()

        assert "run_id" in data
        assert "total_tasks" in data
        assert "pass_rate" in data
        assert "results" in data
        assert isinstance(data["started_at"], str)
