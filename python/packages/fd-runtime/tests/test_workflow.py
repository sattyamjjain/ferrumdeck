"""Tests for workflow orchestration."""

import pytest

from fd_runtime.workflow import (
    StepResult,
    StepStatus,
    StepType,
    Workflow,
    WorkflowContext,
    WorkflowEngine,
    WorkflowStep,
)


@pytest.fixture
def simple_workflow() -> Workflow:
    """Create a simple two-step workflow."""
    return Workflow(
        id="test-workflow",
        name="Test Workflow",
        description="A simple test workflow",
        version="1.0.0",
        steps=[
            WorkflowStep(
                id="step1",
                name="First Step",
                step_type=StepType.LLM,
                config={"model": "test-model"},
            ),
            WorkflowStep(
                id="step2",
                name="Second Step",
                step_type=StepType.TOOL,
                depends_on=["step1"],
                config={"tool_name": "test-tool"},
            ),
        ],
    )


@pytest.fixture
def workflow_with_condition() -> Workflow:
    """Create a workflow with conditional execution."""
    return Workflow(
        id="conditional-workflow",
        name="Conditional Workflow",
        description="Workflow with conditions",
        version="1.0.0",
        steps=[
            WorkflowStep(
                id="check",
                name="Check Step",
                step_type=StepType.LLM,
                config={},
            ),
            WorkflowStep(
                id="if_true",
                name="If True Step",
                step_type=StepType.TOOL,
                depends_on=["check"],
                condition="$.check.ready == true",
                config={},
            ),
            WorkflowStep(
                id="if_false",
                name="If False Step",
                step_type=StepType.TOOL,
                depends_on=["check"],
                condition="$.check.ready == false",
                config={},
            ),
        ],
    )


class TestWorkflowStep:
    """Tests for WorkflowStep."""

    def test_create_step(self) -> None:
        """Test creating a workflow step."""
        step = WorkflowStep(
            id="test-step",
            name="Test Step",
            step_type=StepType.LLM,
            config={"model": "claude-3"},
        )

        assert step.id == "test-step"
        assert step.step_type == StepType.LLM
        assert step.config["model"] == "claude-3"
        assert step.depends_on == []
        assert step.condition is None
        assert step.timeout_ms == 30000

    def test_step_with_dependencies(self) -> None:
        """Test step with dependencies."""
        step = WorkflowStep(
            id="dependent-step",
            name="Dependent Step",
            step_type=StepType.TOOL,
            depends_on=["step1", "step2"],
            config={},
        )

        assert step.depends_on == ["step1", "step2"]


class TestWorkflowContext:
    """Tests for WorkflowContext."""

    def test_get_step_output(self, simple_workflow: Workflow) -> None:
        """Test getting step output from context."""
        context = WorkflowContext(
            workflow=simple_workflow,
            run_id="test-run",
            input_data={"task": "test"},
        )

        # Add a step result
        context.step_results["step1"] = StepResult(
            step_id="step1",
            status=StepStatus.COMPLETED,
            output={"result": "success"},
        )

        output = context.get_step_output("step1")
        assert output == {"result": "success"}

    def test_resolve_jsonpath(self, simple_workflow: Workflow) -> None:
        """Test JSONPath resolution."""
        context = WorkflowContext(
            workflow=simple_workflow,
            run_id="test-run",
            input_data={"task": "test"},
        )

        context.step_results["step1"] = StepResult(
            step_id="step1",
            status=StepStatus.COMPLETED,
            output={"data": {"value": 42}},
        )

        # Test simple path
        result = context.resolve_jsonpath("$.step1.data.value")
        assert result == 42

        # Test accessing output
        result = context.resolve_jsonpath("$.step1")
        assert result == {"data": {"value": 42}}

    def test_evaluate_condition_equals(self, simple_workflow: Workflow) -> None:
        """Test condition evaluation with equals."""
        context = WorkflowContext(
            workflow=simple_workflow,
            run_id="test-run",
            input_data={},
        )

        context.step_results["step1"] = StepResult(
            step_id="step1",
            status=StepStatus.COMPLETED,
            output={"ready": True},
        )

        assert context.evaluate_condition("$.step1.ready == true") is True
        assert context.evaluate_condition("$.step1.ready == false") is False

    def test_evaluate_condition_not_equals(self, simple_workflow: Workflow) -> None:
        """Test condition evaluation with not equals."""
        context = WorkflowContext(
            workflow=simple_workflow,
            run_id="test-run",
            input_data={},
        )

        context.step_results["step1"] = StepResult(
            step_id="step1",
            status=StepStatus.COMPLETED,
            output={"status": "complete"},
        )

        # Note: Use double quotes for string values in conditions
        assert context.evaluate_condition('$.step1.status != "pending"') is True
        assert context.evaluate_condition('$.step1.status != "complete"') is False


class TestWorkflowEngine:
    """Tests for WorkflowEngine."""

    def test_build_execution_order(self, simple_workflow: Workflow) -> None:
        """Test building execution order from dependencies."""
        engine = WorkflowEngine()
        layers = engine.build_execution_order(simple_workflow)

        # Returns list of layers (for parallel execution)
        # Flatten to get order of step IDs
        order = [step.id for layer in layers for step in layer]

        # step1 should come before step2
        assert order.index("step1") < order.index("step2")

    def test_build_execution_order_parallel(self) -> None:
        """Test execution order with parallel steps."""
        workflow = Workflow(
            id="parallel-workflow",
            name="Parallel Workflow",
            description="Workflow with parallel steps",
            version="1.0.0",
            steps=[
                WorkflowStep(
                    id="start",
                    name="Start",
                    step_type=StepType.LLM,
                    config={},
                ),
                WorkflowStep(
                    id="branch_a",
                    name="Branch A",
                    step_type=StepType.TOOL,
                    depends_on=["start"],
                    config={},
                ),
                WorkflowStep(
                    id="branch_b",
                    name="Branch B",
                    step_type=StepType.TOOL,
                    depends_on=["start"],
                    config={},
                ),
                WorkflowStep(
                    id="end",
                    name="End",
                    step_type=StepType.LLM,
                    depends_on=["branch_a", "branch_b"],
                    config={},
                ),
            ],
        )

        engine = WorkflowEngine()
        layers = engine.build_execution_order(workflow)

        # Should have 3 layers: [start], [branch_a, branch_b], [end]
        assert len(layers) == 3

        # First layer should contain only "start"
        assert len(layers[0]) == 1
        assert layers[0][0].id == "start"

        # Second layer should contain both branches (parallel)
        assert len(layers[1]) == 2
        branch_ids = {step.id for step in layers[1]}
        assert branch_ids == {"branch_a", "branch_b"}

        # Third layer should contain only "end"
        assert len(layers[2]) == 1
        assert layers[2][0].id == "end"


class TestWorkflow:
    """Tests for Workflow."""

    def test_create_workflow(self) -> None:
        """Test creating a workflow."""
        workflow = Workflow(
            id="my-workflow",
            name="My Workflow",
            description="A test workflow",
            version="1.0.0",
            steps=[],
        )

        assert workflow.id == "my-workflow"
        assert workflow.max_iterations == 10
        assert workflow.on_error == "fail"

    def test_workflow_from_dict(self) -> None:
        """Test creating workflow from dictionary."""
        data = {
            "id": "dict-workflow",
            "name": "Dict Workflow",
            "description": "Created from dict",
            "version": "2.0.0",
            "max_iterations": 5,
            "on_error": "continue",
            "steps": [
                {
                    "id": "step1",
                    "name": "Step 1",
                    "type": "llm",
                    "config": {"model": "test"},
                }
            ],
        }

        workflow = Workflow.from_dict(data)

        assert workflow.id == "dict-workflow"
        assert workflow.max_iterations == 5
        assert workflow.on_error == "continue"
        assert len(workflow.steps) == 1
        assert workflow.steps[0].id == "step1"
