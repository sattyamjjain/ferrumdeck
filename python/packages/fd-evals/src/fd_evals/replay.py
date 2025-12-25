"""Replay mode for evaluation runs.

Provides two replay modes as per spec:

1. Full Replay: Pins all versions (agent, tools, model) and replays with
   identical inputs. Useful for reproducing issues or comparing versions.

2. Simulation Replay: Uses mocked tool responses from stored artifacts.
   Useful for testing without external dependencies.
"""

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ReplayMode(Enum):
    """Replay mode types."""

    FULL = "full"  # Re-execute with pinned versions
    SIMULATION = "simulation"  # Use mocked responses


@dataclass
class ReplayConfig:
    """Configuration for replay execution."""

    mode: ReplayMode = ReplayMode.FULL
    source_run_id: str | None = None
    source_trace_file: str | None = None

    # Version pinning for full replay
    pin_agent_version: str | None = None
    pin_model: str | None = None
    pin_tool_versions: dict[str, str] = field(default_factory=dict)

    # Simulation options
    mock_llm_responses: bool = False
    mock_tool_responses: bool = True
    allow_new_tool_calls: bool = False  # If True, allows tools not in trace


@dataclass
class ReplayStep:
    """A step from a replay trace."""

    step_id: str
    step_type: str
    input: dict[str, Any]
    output: dict[str, Any] | None
    status: str
    tool_name: str | None = None
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    started_at: str | None = None
    completed_at: str | None = None


@dataclass
class ReplayTrace:
    """Complete trace for replay."""

    run_id: str
    agent_id: str
    agent_version: str
    input: dict[str, Any]
    output: dict[str, Any] | None
    status: str
    steps: list[ReplayStep]
    created_at: str
    completed_at: str | None = None
    model: str | None = None
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    cost_cents: float = 0.0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReplayTrace":
        """Create from dictionary."""
        steps = [
            ReplayStep(
                step_id=s.get("id", ""),
                step_type=s.get("step_type", ""),
                input=s.get("input", {}),
                output=s.get("output"),
                status=s.get("status", ""),
                tool_name=s.get("tool_name"),
                model=s.get("model"),
                input_tokens=s.get("input_tokens", 0),
                output_tokens=s.get("output_tokens", 0),
                started_at=s.get("started_at"),
                completed_at=s.get("completed_at"),
            )
            for s in data.get("steps", [])
        ]

        return cls(
            run_id=data.get("run_id", ""),
            agent_id=data.get("agent_id", ""),
            agent_version=data.get("agent_version", ""),
            input=data.get("input", {}),
            output=data.get("output"),
            status=data.get("status", ""),
            steps=steps,
            created_at=data.get("created_at", ""),
            completed_at=data.get("completed_at"),
            model=data.get("model"),
            total_input_tokens=data.get("input_tokens", 0),
            total_output_tokens=data.get("output_tokens", 0),
            cost_cents=data.get("cost_cents", 0.0),
        )

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary."""
        return {
            "run_id": self.run_id,
            "agent_id": self.agent_id,
            "agent_version": self.agent_version,
            "input": self.input,
            "output": self.output,
            "status": self.status,
            "steps": [
                {
                    "id": s.step_id,
                    "step_type": s.step_type,
                    "input": s.input,
                    "output": s.output,
                    "status": s.status,
                    "tool_name": s.tool_name,
                    "model": s.model,
                    "input_tokens": s.input_tokens,
                    "output_tokens": s.output_tokens,
                    "started_at": s.started_at,
                    "completed_at": s.completed_at,
                }
                for s in self.steps
            ],
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "model": self.model,
            "input_tokens": self.total_input_tokens,
            "output_tokens": self.total_output_tokens,
            "cost_cents": self.cost_cents,
        }


class MockToolExecutor:
    """Executes tool calls using mocked responses from replay trace."""

    def __init__(self, trace: ReplayTrace, allow_new_calls: bool = False):
        """Initialize with a replay trace.

        Args:
            trace: The replay trace containing tool call history.
            allow_new_calls: If True, allows tool calls not in the trace.
        """
        self.trace = trace
        self.allow_new_calls = allow_new_calls
        self._step_index = 0

        # Build index of tool calls for quick lookup
        self._tool_responses: dict[str, list[dict[str, Any]]] = {}
        for step in trace.steps:
            if step.step_type == "tool" and step.tool_name:
                if step.tool_name not in self._tool_responses:
                    self._tool_responses[step.tool_name] = []
                self._tool_responses[step.tool_name].append(
                    {
                        "input": step.input,
                        "output": step.output,
                        "status": step.status,
                    }
                )

        # Track which responses have been used
        self._response_indices: dict[str, int] = {}

    def get_mock_response(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Get a mocked response for a tool call.

        Args:
            tool_name: Name of the tool being called.
            tool_input: Input to the tool.

        Returns:
            Mocked response or None if not found.
        """
        if tool_name not in self._tool_responses:
            if self.allow_new_calls:
                logger.warning(f"No mock for tool {tool_name}, allowing new call")
                return None
            raise ValueError(f"Tool '{tool_name}' not in replay trace and allow_new_calls=False")

        # Get next response for this tool
        idx = self._response_indices.get(tool_name, 0)
        responses = self._tool_responses[tool_name]

        if idx >= len(responses):
            if self.allow_new_calls:
                logger.warning(f"No more mocked responses for {tool_name}")
                return None
            raise ValueError(
                f"No more mocked responses for tool '{tool_name}' (used {idx} of {len(responses)})"
            )

        response = responses[idx]
        self._response_indices[tool_name] = idx + 1

        logger.debug(
            f"Using mocked response for {tool_name} (index {idx}): status={response['status']}"
        )

        return response["output"]


class MockLLMExecutor:
    """Executes LLM calls using mocked responses from replay trace."""

    def __init__(self, trace: ReplayTrace):
        """Initialize with a replay trace."""
        self.trace = trace
        self._llm_steps = [s for s in trace.steps if s.step_type == "llm"]
        self._current_index = 0

    def get_mock_response(
        self,
        messages: list[dict[str, Any]],
        model: str | None = None,
    ) -> dict[str, Any] | None:
        """Get a mocked LLM response.

        Args:
            messages: Input messages (used for logging/validation).
            model: Model name (used for logging).

        Returns:
            Mocked response or None if exhausted.
        """
        if self._current_index >= len(self._llm_steps):
            logger.warning("No more mocked LLM responses available")
            return None

        step = self._llm_steps[self._current_index]
        self._current_index += 1

        logger.debug(f"Using mocked LLM response (index {self._current_index - 1})")

        return {
            "content": step.output,
            "model": step.model or model,
            "input_tokens": step.input_tokens,
            "output_tokens": step.output_tokens,
        }


class ReplayRunner:
    """Runs evaluations in replay mode."""

    def __init__(
        self,
        config: ReplayConfig,
        trace: ReplayTrace | None = None,
    ):
        """Initialize the replay runner.

        Args:
            config: Replay configuration.
            trace: Pre-loaded trace (optional, will load from file if not provided).
        """
        self.config = config
        self.trace = trace

        if self.trace is None and config.source_trace_file:
            self.trace = self._load_trace(config.source_trace_file)

        self._tool_executor: MockToolExecutor | None = None
        self._llm_executor: MockLLMExecutor | None = None

        if self.trace and config.mode == ReplayMode.SIMULATION:
            if config.mock_tool_responses:
                self._tool_executor = MockToolExecutor(
                    self.trace,
                    allow_new_calls=config.allow_new_tool_calls,
                )
            if config.mock_llm_responses:
                self._llm_executor = MockLLMExecutor(self.trace)

    def _load_trace(self, path: str) -> ReplayTrace:
        """Load a trace from file."""
        trace_path = Path(path)
        if not trace_path.exists():
            raise FileNotFoundError(f"Trace file not found: {path}")

        with trace_path.open() as f:
            data = json.load(f)

        return ReplayTrace.from_dict(data)

    def get_pinned_config(self) -> dict[str, Any]:
        """Get configuration with pinned versions for full replay."""
        if not self.trace:
            return {}

        config: dict[str, Any] = {}

        # Pin agent version
        if self.config.pin_agent_version:
            config["agent_version"] = self.config.pin_agent_version
        elif self.trace.agent_version:
            config["agent_version"] = self.trace.agent_version

        # Pin model
        if self.config.pin_model:
            config["model"] = self.config.pin_model
        elif self.trace.model:
            config["model"] = self.trace.model

        # Pin tool versions
        if self.config.pin_tool_versions:
            config["tool_versions"] = self.config.pin_tool_versions

        return config

    def get_mock_tool_response(
        self,
        tool_name: str,
        tool_input: dict[str, Any],
    ) -> dict[str, Any] | None:
        """Get mocked tool response for simulation mode."""
        if self._tool_executor:
            return self._tool_executor.get_mock_response(tool_name, tool_input)
        return None

    def get_mock_llm_response(
        self,
        messages: list[dict[str, Any]],
        model: str | None = None,
    ) -> dict[str, Any] | None:
        """Get mocked LLM response for simulation mode."""
        if self._llm_executor:
            return self._llm_executor.get_mock_response(messages, model)
        return None

    def is_simulation_mode(self) -> bool:
        """Check if running in simulation mode."""
        return self.config.mode == ReplayMode.SIMULATION


def save_trace(trace: ReplayTrace, path: str | Path) -> None:
    """Save a trace to file for later replay.

    Args:
        trace: The trace to save.
        path: Output file path.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w") as f:
        json.dump(trace.to_dict(), f, indent=2, default=str)

    logger.info(f"Saved trace to {path}")


def load_trace(path: str | Path) -> ReplayTrace:
    """Load a trace from file.

    Args:
        path: Path to trace file.

    Returns:
        Loaded ReplayTrace.
    """
    path = Path(path)
    with path.open() as f:
        data = json.load(f)

    return ReplayTrace.from_dict(data)


def create_trace_from_run(
    run_data: dict[str, Any],
    steps_data: list[dict[str, Any]],
) -> ReplayTrace:
    """Create a replay trace from run and steps data.

    Args:
        run_data: Run data from control plane.
        steps_data: Steps data from control plane.

    Returns:
        ReplayTrace ready for saving or replay.
    """
    steps = [
        ReplayStep(
            step_id=s.get("id", ""),
            step_type=s.get("step_type", ""),
            input=s.get("input", {}),
            output=s.get("output"),
            status=s.get("status", ""),
            tool_name=s.get("tool_name"),
            model=s.get("model"),
            input_tokens=s.get("input_tokens", 0),
            output_tokens=s.get("output_tokens", 0),
            started_at=s.get("started_at"),
            completed_at=s.get("completed_at"),
        )
        for s in steps_data
    ]

    return ReplayTrace(
        run_id=run_data.get("id", ""),
        agent_id=run_data.get("agent_id", ""),
        agent_version=run_data.get("agent_version_id", ""),
        input=run_data.get("input", {}),
        output=run_data.get("output"),
        status=run_data.get("status", ""),
        steps=steps,
        created_at=run_data.get("created_at", datetime.now().isoformat()),
        completed_at=run_data.get("completed_at"),
        model=run_data.get("model"),
        total_input_tokens=run_data.get("input_tokens", 0),
        total_output_tokens=run_data.get("output_tokens", 0),
        cost_cents=run_data.get("cost_cents", 0.0),
    )
