"""Evaluation runner for executing eval tasks."""

import asyncio
import json
import logging
import os
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from fd_evals.scorers.base import BaseScorer, CompositeScorer
from fd_evals.task import EvalResult, EvalRunSummary, EvalTask, ScorerResult

logger = logging.getLogger(__name__)

# Terminal run statuses
TERMINAL_STATUSES = {"completed", "failed", "cancelled", "budget_killed", "policy_blocked"}

# Default poll interval in seconds
DEFAULT_POLL_INTERVAL = 1.0


class ControlPlaneError(Exception):
    """Error communicating with the control plane."""

    pass


class EvalRunner:
    """Runner for executing evaluation tasks against an agent.

    This runner coordinates the execution of eval tasks and scoring
    of results using deterministic scorers.
    """

    def __init__(
        self,
        scorers: list[BaseScorer] | None = None,
        control_plane_url: str | None = None,
        api_key: str | None = None,
        use_mock: bool = False,
    ):
        """Initialize the eval runner.

        Args:
            scorers: List of scorers to apply to results.
            control_plane_url: URL of the FerrumDeck control plane.
            api_key: API key for authentication.
            use_mock: If True, use mock execution instead of real control plane.
        """
        self.scorers = scorers or []
        self.control_plane_url = (
            control_plane_url or os.getenv("FD_CONTROL_PLANE_URL") or "http://localhost:8080"
        ).rstrip("/")
        self.api_key = api_key or os.getenv("FD_API_KEY")
        self.use_mock = use_mock
        self._composite_scorer = (
            CompositeScorer(self.scorers, name="EvalScorer", require_all_pass=False)
            if self.scorers
            else None
        )

        # HTTP client headers
        self.headers: dict[str, str] = {"Content-Type": "application/json"}
        if self.api_key:
            self.headers["Authorization"] = f"Bearer {self.api_key}"

    def load_tasks(self, dataset_path: str | Path) -> list[EvalTask]:
        """Load evaluation tasks from a JSONL file.

        Args:
            dataset_path: Path to the tasks.jsonl file.

        Returns:
            List of EvalTask objects.
        """
        tasks = []
        dataset_path = Path(dataset_path)

        with dataset_path.open() as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                data = json.loads(line)
                tasks.append(EvalTask.from_dict(data))

        return tasks

    def execute_task(
        self,
        task: EvalTask,
        agent_id: str,
        timeout_ms: int = 300000,
    ) -> EvalResult:
        """Execute a single evaluation task.

        Args:
            task: The task to execute.
            agent_id: ID of the agent to run.
            timeout_ms: Maximum time to wait for completion.

        Returns:
            EvalResult with scores and metrics.
        """
        start_time = time.time()
        run_id = None
        error = None
        actual_output: dict[str, Any] = {}
        run_context: dict[str, Any] = {}
        input_tokens = 0
        output_tokens = 0
        cost_cents = 0.0

        try:
            # Create and execute the run
            run_id, actual_output, run_context = self._execute_run(task, agent_id, timeout_ms)

            # Extract metrics
            input_tokens = run_context.get("input_tokens", 0)
            output_tokens = run_context.get("output_tokens", 0)
            cost_cents = run_context.get("cost_cents", 0.0)

        except Exception as e:
            error = str(e)
            actual_output = {}
            run_context = {"error": error}
            logger.exception(f"Task {task.id} failed: {e}")

        execution_time_ms = int((time.time() - start_time) * 1000)

        # Score the results
        scorer_results = []
        total_score = 0.0

        if self._composite_scorer and not error:
            result = self._composite_scorer.score(task, actual_output, run_context)
            scorer_results = [
                ScorerResult(
                    scorer_name=sr["scorer"],
                    passed=sr["passed"],
                    score=sr["score"],
                    message=sr["message"],
                )
                for sr in result.details.get("sub_results", [])
            ]
            total_score = result.score
            passed = result.passed
        elif error:
            passed = False
            total_score = 0.0
            scorer_results = [
                ScorerResult(
                    scorer_name="Error",
                    passed=False,
                    score=0.0,
                    message=f"Execution error: {error}",
                )
            ]
        else:
            # No scorers, assume passed if no error
            passed = True
            total_score = 1.0

        return EvalResult(
            task_id=task.id,
            task_name=task.name,
            run_id=run_id,
            passed=passed,
            total_score=total_score,
            scorer_results=scorer_results,
            execution_time_ms=execution_time_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_cents=cost_cents,
            error=error,
            trace_id=run_context.get("trace_id"),
        )

    def _execute_run(
        self,
        task: EvalTask,
        agent_id: str,
        timeout_ms: int,
    ) -> tuple[str, dict[str, Any], dict[str, Any]]:
        """Execute a run via the control plane.

        Returns:
            Tuple of (run_id, output, context).
        """
        if self.use_mock:
            return self._execute_mock_run(task, agent_id)

        # Run the async execution synchronously
        return asyncio.get_event_loop().run_until_complete(
            self._execute_run_async(task, agent_id, timeout_ms)
        )

    async def _execute_run_async(
        self,
        task: EvalTask,
        agent_id: str,
        timeout_ms: int,
    ) -> tuple[str, dict[str, Any], dict[str, Any]]:
        """Execute a run via the control plane (async).

        Returns:
            Tuple of (run_id, output, context).
        """
        timeout_seconds = timeout_ms / 1000.0
        deadline = time.time() + timeout_seconds

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Create the run
            try:
                response = await client.post(
                    f"{self.control_plane_url}/v1/runs",
                    headers=self.headers,
                    json={
                        "agent_id": agent_id,
                        "input": task.input,
                        "config": task.config or {},
                    },
                )
                response.raise_for_status()
                run_data = response.json()
                run_id = run_data["id"]
                logger.info(f"Created run {run_id} for task {task.id}")
            except httpx.HTTPStatusError as e:
                raise ControlPlaneError(f"Failed to create run: {e.response.text}") from e
            except httpx.RequestError as e:
                raise ControlPlaneError(f"Failed to connect to control plane: {e}") from e

            # Poll for completion
            while time.time() < deadline:
                try:
                    response = await client.get(
                        f"{self.control_plane_url}/v1/runs/{run_id}",
                        headers=self.headers,
                    )
                    response.raise_for_status()
                    run_data = response.json()
                except httpx.HTTPStatusError as e:
                    raise ControlPlaneError(f"Failed to get run status: {e.response.text}") from e
                except httpx.RequestError as e:
                    raise ControlPlaneError(f"Failed to connect to control plane: {e}") from e

                status = run_data.get("status", "")

                if status in TERMINAL_STATUSES:
                    logger.info(f"Run {run_id} finished with status: {status}")
                    break

                # Wait before next poll
                await asyncio.sleep(DEFAULT_POLL_INTERVAL)
            else:
                raise ControlPlaneError(f"Run {run_id} timed out after {timeout_ms}ms")

            # Extract output and context
            output = run_data.get("output") or {}
            context = self._build_run_context(run_data)

            # Get step details for additional context
            try:
                response = await client.get(
                    f"{self.control_plane_url}/v1/runs/{run_id}/steps",
                    headers=self.headers,
                )
                if response.status_code == 200:
                    steps = response.json()
                    context["steps"] = steps
                    context["step_count"] = len(steps)
            except Exception as e:
                logger.warning(f"Failed to fetch steps for run {run_id}: {e}")

            return run_id, output, context

    def _build_run_context(self, run_data: dict[str, Any]) -> dict[str, Any]:
        """Build context dictionary from run data."""
        return {
            "status": run_data.get("status"),
            "input_tokens": run_data.get("input_tokens", 0),
            "output_tokens": run_data.get("output_tokens", 0),
            "tool_calls": run_data.get("tool_calls", 0),
            "cost_cents": run_data.get("cost_cents", 0) / 100.0,  # Convert to cents
            "trace_id": run_data.get("trace_id"),
            "started_at": run_data.get("started_at"),
            "completed_at": run_data.get("completed_at"),
            "project_id": run_data.get("project_id"),
            "agent_version_id": run_data.get("agent_version_id"),
        }

    def _execute_mock_run(
        self,
        task: EvalTask,
        agent_id: str,
    ) -> tuple[str, dict[str, Any], dict[str, Any]]:
        """Execute a mock run for testing the framework.

        Returns:
            Tuple of (run_id, output, context).
        """
        import uuid

        run_id = f"run_{uuid.uuid4().hex[:12]}"

        # Simulate execution by returning expected values for testing
        mock_output = {
            "pr_url": "https://github.com/example/project/pull/1",
            "pr_number": 1,
            "pr_title": f"[Task {task.id}] {task.name}",
            "pr_description": f"Automated PR for: {task.description}",
        }

        mock_context = {
            "status": "completed",
            "files_changed": task.expected.get("files_changed", []),
            "files_created": task.expected.get("files_created", []),
            "test_results": {
                "passed": 10,
                "failed": 0,
                "total": 10,
            },
            "lint_results": {
                "errors": [],
                "warnings": [],
            },
            "input_tokens": 1500,
            "output_tokens": 800,
            "cost_cents": 0.05,
            "trace_id": f"trace_{uuid.uuid4().hex[:16]}",
        }

        return run_id, mock_output, mock_context

    def run_eval(
        self,
        dataset_path: str | Path,
        agent_id: str,
        max_tasks: int | None = None,
        timeout_ms: int = 300000,
    ) -> EvalRunSummary:
        """Run a full evaluation on a dataset.

        Args:
            dataset_path: Path to the tasks.jsonl file.
            agent_id: ID of the agent to evaluate.
            max_tasks: Maximum number of tasks to run (for testing).
            timeout_ms: Maximum time per task.

        Returns:
            EvalRunSummary with all results and metrics.
        """
        import uuid

        run_id = f"eval_{uuid.uuid4().hex[:12]}"
        started_at = datetime.now(tz=UTC)
        dataset_name = Path(dataset_path).parent.name

        tasks = self.load_tasks(dataset_path)
        if max_tasks:
            tasks = tasks[:max_tasks]

        results: list[EvalResult] = []
        total_cost = 0.0
        total_input_tokens = 0
        total_output_tokens = 0
        total_execution_time = 0
        passed_count = 0

        for task in tasks:
            logger.info(f"Executing task {task.id}: {task.name}")
            result = self.execute_task(task, agent_id, timeout_ms)
            results.append(result)

            total_cost += result.cost_cents
            total_input_tokens += result.input_tokens
            total_output_tokens += result.output_tokens
            total_execution_time += result.execution_time_ms
            if result.passed:
                passed_count += 1

        completed_at = datetime.now(tz=UTC)
        average_score = sum(r.total_score for r in results) / len(results) if results else 0.0

        return EvalRunSummary(
            run_id=run_id,
            dataset_name=dataset_name,
            total_tasks=len(results),
            passed_tasks=passed_count,
            failed_tasks=len(results) - passed_count,
            average_score=average_score,
            total_cost_cents=total_cost,
            total_input_tokens=total_input_tokens,
            total_output_tokens=total_output_tokens,
            total_execution_time_ms=total_execution_time,
            results=results,
            started_at=started_at,
            completed_at=completed_at,
        )

    def save_report(
        self,
        summary: EvalRunSummary,
        output_path: str | Path,
    ) -> None:
        """Save evaluation report to a JSON file.

        Args:
            summary: The evaluation summary to save.
            output_path: Path for the output JSON file.
        """
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with output_path.open("w") as f:
            json.dump(summary.to_dict(), f, indent=2)
