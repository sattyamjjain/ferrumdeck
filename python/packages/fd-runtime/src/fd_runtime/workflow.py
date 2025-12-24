"""Workflow orchestration engine for FerrumDeck.

Executes structured workflows with step sequencing, conditions,
loops, and approval gates.
"""

import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

import yaml

logger = logging.getLogger(__name__)


class StepType(Enum):
    """Types of workflow steps."""

    LLM = "llm"
    TOOL = "tool"
    CONDITION = "condition"
    LOOP = "loop"
    PARALLEL = "parallel"
    APPROVAL = "approval"


class StepStatus(Enum):
    """Step execution status."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"
    WAITING_APPROVAL = "waiting_approval"


@dataclass
class StepResult:
    """Result of step execution."""

    step_id: str
    status: StepStatus
    output: dict[str, Any] | None = None
    error: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    duration_ms: int = 0


@dataclass
class WorkflowStep:
    """A step in a workflow."""

    id: str
    name: str
    step_type: StepType
    config: dict[str, Any] = field(default_factory=dict)
    depends_on: list[str] = field(default_factory=list)
    condition: str | None = None
    timeout_ms: int = 30000
    retry_config: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "WorkflowStep":
        """Create step from dictionary."""
        return cls(
            id=data["id"],
            name=data.get("name", data["id"]),
            step_type=StepType(data["type"]),
            config=data.get("config", {}),
            depends_on=data.get("depends_on", []),
            condition=data.get("condition"),
            timeout_ms=data.get("timeout_ms", 30000),
            retry_config=data.get("retry"),
        )


@dataclass
class Workflow:
    """A complete workflow definition."""

    id: str
    name: str
    description: str
    version: str
    steps: list[WorkflowStep]
    max_iterations: int = 10
    on_error: str = "fail"

    @classmethod
    def from_yaml(cls, yaml_content: str) -> "Workflow":
        """Parse workflow from YAML content."""
        data = yaml.safe_load(yaml_content)
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Workflow":
        """Create workflow from dictionary."""
        steps = [WorkflowStep.from_dict(s) for s in data.get("steps", [])]
        return cls(
            id=data["id"],
            name=data["name"],
            description=data.get("description", ""),
            version=data.get("version", "1.0.0"),
            steps=steps,
            max_iterations=data.get("max_iterations", 10),
            on_error=data.get("on_error", "fail"),
        )


@dataclass
class WorkflowContext:
    """Execution context for a workflow."""

    workflow: Workflow
    run_id: str
    input_data: dict[str, Any]
    step_results: dict[str, StepResult] = field(default_factory=dict)
    variables: dict[str, Any] = field(default_factory=dict)
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    iteration_count: int = 0

    def get_step_output(self, step_id: str) -> dict[str, Any] | None:
        """Get output from a completed step."""
        result = self.step_results.get(step_id)
        return result.output if result else None

    def resolve_jsonpath(self, path: str) -> Any:
        """Resolve a JSONPath expression against context.

        Supports simple paths like:
        - $.input.task
        - $.step_id.field
        - $.variables.name
        """
        if not path.startswith("$."):
            return path

        parts = path[2:].split(".")
        current: Any = None

        if parts[0] == "input":
            current = self.input_data
            parts = parts[1:]
        elif parts[0] == "variables":
            current = self.variables
            parts = parts[1:]
        elif parts[0] in self.step_results:
            result = self.step_results[parts[0]]
            current = result.output if result else None
            parts = parts[1:]
        else:
            return None

        for part in parts:
            if current is None:
                return None
            if isinstance(current, dict):
                current = current.get(part)
            elif isinstance(current, list) and part.isdigit():
                idx = int(part)
                current = current[idx] if idx < len(current) else None
            else:
                return None

        return current

    def evaluate_condition(self, condition: str) -> bool:
        """Evaluate a condition expression.

        Supports simple expressions like:
        - $.step_id.field == true
        - $.step_id.field != "value"
        """
        if not condition:
            return True

        # Parse simple conditions
        for op, py_op in [("==", "=="), ("!=", "!="), (">=", ">="), ("<=", "<=")]:
            if op in condition:
                left, right = condition.split(op, 1)
                left_val = self.resolve_jsonpath(left.strip())
                right_val = right.strip()

                # Parse right value
                if right_val.lower() == "true":
                    right_val = True
                elif right_val.lower() == "false":
                    right_val = False
                elif right_val.startswith('"') and right_val.endswith('"'):
                    right_val = right_val[1:-1]
                elif right_val.isdigit():
                    right_val = int(right_val)

                # Evaluate using operator mapping
                ops = {
                    "==": lambda a, b: a == b,
                    "!=": lambda a, b: a != b,
                    ">=": lambda a, b: a >= b,  # type: ignore[operator]
                    "<=": lambda a, b: a <= b,  # type: ignore[operator]
                }
                return ops[py_op](left_val, right_val)

        return True


class WorkflowEngine:
    """Orchestrates workflow execution."""

    def __init__(
        self,
        llm_executor: Any = None,
        tool_router: Any = None,
        approval_handler: Any = None,
    ):
        self.llm_executor = llm_executor
        self.tool_router = tool_router
        self.approval_handler = approval_handler

    def build_execution_order(self, workflow: Workflow) -> list[list[WorkflowStep]]:
        """Build execution order respecting dependencies.

        Returns a list of "layers", where each layer contains steps
        that can be executed in parallel.
        """
        remaining = {s.id: s for s in workflow.steps}
        completed: set[str] = set()
        layers: list[list[WorkflowStep]] = []

        while remaining:
            # Find steps with all dependencies satisfied
            ready = []
            for step in remaining.values():
                if all(dep in completed for dep in step.depends_on):
                    ready.append(step)

            if not ready:
                # Circular dependency or missing dependency
                raise ValueError(f"Cannot resolve dependencies for steps: {list(remaining.keys())}")

            layers.append(ready)
            for step in ready:
                del remaining[step.id]
                completed.add(step.id)

        return layers

    async def execute_step(
        self,
        step: WorkflowStep,
        context: WorkflowContext,
    ) -> StepResult:
        """Execute a single workflow step."""
        import time

        start_time = time.time()
        logger.info(f"Executing step: {step.id} ({step.step_type.value})")

        # Check condition
        if step.condition and not context.evaluate_condition(step.condition):
            logger.info(f"Step {step.id} skipped due to condition: {step.condition}")
            return StepResult(
                step_id=step.id,
                status=StepStatus.SKIPPED,
                output={"skipped": True, "reason": "Condition not met"},
            )

        try:
            if step.step_type == StepType.LLM:
                result = await self._execute_llm_step(step, context)
            elif step.step_type == StepType.TOOL:
                result = await self._execute_tool_step(step, context)
            elif step.step_type == StepType.LOOP:
                result = await self._execute_loop_step(step, context)
            elif step.step_type == StepType.APPROVAL:
                result = await self._execute_approval_step(step, context)
            elif step.step_type == StepType.PARALLEL:
                result = await self._execute_parallel_step(step, context)
            else:
                raise ValueError(f"Unknown step type: {step.step_type}")

            duration_ms = int((time.time() - start_time) * 1000)
            result.duration_ms = duration_ms

            # Update context totals
            context.total_input_tokens += result.input_tokens
            context.total_output_tokens += result.output_tokens

            return result

        except Exception as e:
            logger.exception(f"Step {step.id} failed: {e}")
            duration_ms = int((time.time() - start_time) * 1000)
            return StepResult(
                step_id=step.id,
                status=StepStatus.FAILED,
                error=str(e),
                duration_ms=duration_ms,
            )

    async def _execute_llm_step(
        self,
        step: WorkflowStep,
        context: WorkflowContext,
    ) -> StepResult:
        """Execute an LLM step."""
        if not self.llm_executor:
            raise RuntimeError("LLM executor not configured")

        config = step.config
        model = config.get("model", "claude-sonnet-4-20250514")
        system_prompt = config.get("system_prompt", "")
        max_tokens = config.get("max_tokens", 1000)
        temperature = config.get("temperature", 0.7)

        # Build context message from previous steps
        context_parts = []
        for dep_id in step.depends_on:
            dep_output = context.get_step_output(dep_id)
            if dep_output:
                context_parts.append(f"Output from {dep_id}:\n{json.dumps(dep_output, indent=2)}")

        user_message = (
            "\n\n".join(context_parts) if context_parts else json.dumps(context.input_data)
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]

        response = await self.llm_executor.complete(
            messages=messages,
            model=model,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        # Try to parse JSON response
        content = response.content
        if isinstance(content, str):
            try:
                # Extract JSON from markdown code blocks if present
                if "```json" in content:
                    start = content.find("```json") + 7
                    end = content.find("```", start)
                    content = json.loads(content[start:end].strip())
                elif content.strip().startswith("{"):
                    content = json.loads(content)
            except json.JSONDecodeError:
                pass  # Keep as string

        return StepResult(
            step_id=step.id,
            status=StepStatus.COMPLETED,
            output={"response": content} if isinstance(content, str) else content,
            input_tokens=response.usage.input_tokens,
            output_tokens=response.usage.output_tokens,
        )

    async def _execute_tool_step(
        self,
        step: WorkflowStep,
        context: WorkflowContext,
    ) -> StepResult:
        """Execute a tool step."""
        if not self.tool_router:
            raise RuntimeError("Tool router not configured")

        config = step.config
        tool_name = config.get("tool_name")
        tool_input = config.get("tool_input", {})

        # Resolve tool input from context if specified
        if "tool_input_from" in config:
            resolved = context.resolve_jsonpath(config["tool_input_from"])
            if isinstance(resolved, dict):
                tool_input = resolved
            elif resolved:
                tool_input = {"value": resolved}

        # Check if approval is required
        if config.get("requires_approval"):
            if not self.approval_handler:
                raise RuntimeError("Approval handler not configured for tool requiring approval")
            approved = await self.approval_handler.request_approval(
                tool_name=tool_name,
                tool_input=tool_input,
                context=context,
            )
            if not approved:
                return StepResult(
                    step_id=step.id,
                    status=StepStatus.WAITING_APPROVAL,
                    output={"approval_required": True, "tool": tool_name},
                )

        result = await self.tool_router.call_tool(
            tool_name=tool_name,
            tool_input=tool_input,
            run_id=context.run_id,
        )

        return StepResult(
            step_id=step.id,
            status=StepStatus.COMPLETED if result.success else StepStatus.FAILED,
            output={"result": result.output, "server": result.server},
            error=result.error if not result.success else None,
        )

    async def _execute_loop_step(
        self,
        step: WorkflowStep,
        context: WorkflowContext,
    ) -> StepResult:
        """Execute a loop step (nested workflow)."""
        config = step.config
        max_iterations = config.get("max_iterations", 10)
        nested_steps = config.get("steps", [])

        # Parse nested steps
        nested_workflow_steps = [WorkflowStep.from_dict(s) for s in nested_steps]

        loop_results = []
        for i in range(max_iterations):
            context.iteration_count = i + 1
            logger.info(f"Loop {step.id} iteration {i + 1}/{max_iterations}")

            # Execute nested steps in order
            iteration_outputs = {}
            should_break = False

            for nested_step in nested_workflow_steps:
                # Check condition - skip if condition exists and evaluates to false
                if nested_step.condition and not context.evaluate_condition(nested_step.condition):
                    continue

                result = await self.execute_step(nested_step, context)
                context.step_results[nested_step.id] = result
                iteration_outputs[nested_step.id] = result.output

                if result.status == StepStatus.FAILED:
                    return StepResult(
                        step_id=step.id,
                        status=StepStatus.FAILED,
                        error=f"Nested step {nested_step.id} failed: {result.error}",
                    )

                # Check for "done" signal
                if result.output and result.output.get("done"):
                    should_break = True
                    break

            loop_results.append(iteration_outputs)

            if should_break:
                break

        return StepResult(
            step_id=step.id,
            status=StepStatus.COMPLETED,
            output={"iterations": len(loop_results), "results": loop_results},
        )

    async def _execute_approval_step(
        self,
        step: WorkflowStep,
        context: WorkflowContext,
    ) -> StepResult:
        """Execute an approval step."""
        if not self.approval_handler:
            raise RuntimeError("Approval handler not configured")

        config = step.config
        tool_name = config.get("tool_name")
        message = config.get("approval_message", "Approval required")

        # Resolve message template variables
        # Simple template resolution for {{$.path}} patterns
        import re

        pattern = r"\{\{(\$\.[^}]+)\}\}"
        matches = re.findall(pattern, message)
        for match in matches:
            value = context.resolve_jsonpath(match)
            message = message.replace(f"{{{{{match}}}}}", str(value) if value else "N/A")

        approved = await self.approval_handler.request_approval(
            tool_name=tool_name,
            message=message,
            context=context,
        )

        if not approved:
            return StepResult(
                step_id=step.id,
                status=StepStatus.WAITING_APPROVAL,
                output={"approval_required": True, "message": message},
            )

        # Execute the tool if approved
        tool_input = config.get("tool_input", {})
        if "tool_input_from" in config:
            resolved = context.resolve_jsonpath(config["tool_input_from"])
            if isinstance(resolved, dict):
                tool_input = resolved

        if self.tool_router:
            result = await self.tool_router.call_tool(
                tool_name=tool_name,
                tool_input=tool_input,
                run_id=context.run_id,
            )
            return StepResult(
                step_id=step.id,
                status=StepStatus.COMPLETED if result.success else StepStatus.FAILED,
                output={"result": result.output},
                error=result.error if not result.success else None,
            )

        return StepResult(
            step_id=step.id,
            status=StepStatus.COMPLETED,
            output={"approved": True},
        )

    async def _execute_parallel_step(
        self,
        step: WorkflowStep,
        context: WorkflowContext,
    ) -> StepResult:
        """Execute parallel steps concurrently."""
        import asyncio

        config = step.config
        nested_steps = config.get("steps", [])

        # Parse and execute nested steps in parallel
        nested_workflow_steps = [WorkflowStep.from_dict(s) for s in nested_steps]

        tasks = [self.execute_step(s, context) for s in nested_workflow_steps]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        outputs = {}
        errors = []
        for s, r in zip(nested_workflow_steps, results, strict=False):
            if isinstance(r, Exception):
                errors.append(f"{s.id}: {r!s}")
            elif isinstance(r, StepResult):
                context.step_results[s.id] = r
                outputs[s.id] = r.output
                if r.status == StepStatus.FAILED:
                    errors.append(f"{s.id}: {r.error}")

        if errors:
            return StepResult(
                step_id=step.id,
                status=StepStatus.FAILED,
                error="; ".join(errors),
                output=outputs,
            )

        return StepResult(
            step_id=step.id,
            status=StepStatus.COMPLETED,
            output=outputs,
        )

    async def execute(
        self,
        workflow: Workflow,
        run_id: str,
        input_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Execute a complete workflow."""
        context = WorkflowContext(
            workflow=workflow,
            run_id=run_id,
            input_data=input_data,
        )

        logger.info(f"Starting workflow: {workflow.name} (run_id={run_id})")

        # Build execution order
        layers = self.build_execution_order(workflow)

        # Execute layer by layer
        for layer_idx, layer in enumerate(layers):
            logger.info(f"Executing layer {layer_idx + 1}/{len(layers)}: {[s.id for s in layer]}")

            if len(layer) == 1:
                # Single step - execute directly
                result = await self.execute_step(layer[0], context)
                context.step_results[layer[0].id] = result

                if result.status == StepStatus.FAILED and workflow.on_error == "fail":
                    logger.error(f"Workflow failed at step {layer[0].id}: {result.error}")
                    return {
                        "status": "failed",
                        "error": result.error,
                        "step_id": layer[0].id,
                        "step_results": {k: v.output for k, v in context.step_results.items()},
                        "total_input_tokens": context.total_input_tokens,
                        "total_output_tokens": context.total_output_tokens,
                    }
            else:
                # Multiple steps - execute in parallel
                import asyncio

                tasks = [self.execute_step(s, context) for s in layer]
                results = await asyncio.gather(*tasks, return_exceptions=True)

                for step, result in zip(layer, results, strict=False):
                    if isinstance(result, Exception):
                        context.step_results[step.id] = StepResult(
                            step_id=step.id,
                            status=StepStatus.FAILED,
                            error=str(result),
                        )
                        if workflow.on_error == "fail":
                            return {
                                "status": "failed",
                                "error": str(result),
                                "step_id": step.id,
                            }
                    else:
                        context.step_results[step.id] = result

        logger.info(f"Workflow completed: {workflow.name}")

        return {
            "status": "completed",
            "step_results": {k: v.output for k, v in context.step_results.items()},
            "total_input_tokens": context.total_input_tokens,
            "total_output_tokens": context.total_output_tokens,
        }
