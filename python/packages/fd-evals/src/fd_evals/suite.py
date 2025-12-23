"""Evaluation suite runner."""

import json
import logging
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class EvalTask(BaseModel):
    """A single evaluation task."""

    id: str
    input: dict[str, Any]
    expected: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class EvalResult(BaseModel):
    """Result of running an evaluation task."""

    task_id: str
    passed: bool
    score: float
    actual: dict[str, Any] | None = None
    expected: dict[str, Any] | None = None
    error: str | None = None
    duration_ms: int = 0


class EvalSuite:
    """Load and run evaluation suites."""

    def __init__(self, dataset_path: str | Path):
        self.dataset_path = Path(dataset_path)
        self.tasks: list[EvalTask] = []

    def load(self) -> None:
        """Load tasks from dataset file (JSONL format)."""
        tasks_file = self.dataset_path / "tasks.jsonl"
        if not tasks_file.exists():
            raise FileNotFoundError(f"Tasks file not found: {tasks_file}")

        self.tasks = []
        with tasks_file.open() as f:
            for line in f:
                if line.strip():
                    data = json.loads(line)
                    self.tasks.append(EvalTask(**data))

        logger.info(f"Loaded {len(self.tasks)} evaluation tasks")

    async def run(self, runner: Callable[["EvalTask"], Awaitable["EvalResult"]]) -> list[EvalResult]:
        """Run all tasks through the provided runner."""
        results = []
        for task in self.tasks:
            logger.info(f"Running task: {task.id}")
            try:
                result = await runner(task)
                results.append(result)
            except Exception as e:
                logger.exception(f"Task {task.id} failed")
                results.append(
                    EvalResult(
                        task_id=task.id,
                        passed=False,
                        score=0.0,
                        error=str(e),
                    )
                )
        return results

    def summary(self, results: list[EvalResult]) -> dict[str, Any]:
        """Generate summary statistics."""
        total = len(results)
        passed = sum(1 for r in results if r.passed)
        failed = total - passed
        avg_score = sum(r.score for r in results) / total if total > 0 else 0.0
        total_duration = sum(r.duration_ms for r in results)

        return {
            "total": total,
            "passed": passed,
            "failed": failed,
            "pass_rate": passed / total if total > 0 else 0.0,
            "average_score": avg_score,
            "total_duration_ms": total_duration,
        }
