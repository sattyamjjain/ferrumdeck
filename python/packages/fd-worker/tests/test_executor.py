"""Tests for the step executor."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from fd_worker.executor import StepExecutor


class TestStepExecutor:
    """Tests for StepExecutor class."""

    @pytest.fixture
    def executor(self):
        """Create a basic executor with mocked dependencies."""
        with (
            patch("fd_worker.executor.ControlPlaneClient"),
            patch("fd_worker.executor.MCPRouter"),
            patch("fd_worker.executor.LLMExecutor"),
        ):
            executor = StepExecutor(
                control_plane_url="http://localhost:8080",
                api_key="test-key",
            )
            executor.client = AsyncMock()
            executor.mcp_router = AsyncMock()
            executor.llm_executor = AsyncMock()
            yield executor

    @pytest.fixture
    def llm_job(self):
        """Sample LLM step job."""
        return {
            "run_id": "run_01",
            "step_id": "step_01",
            "step_type": "llm",
            "input": {
                "messages": [
                    {"role": "system", "content": "You are a helpful assistant."},
                    {"role": "user", "content": "Hello!"},
                ],
                "model": "claude-sonnet-4-20250514",
                "max_tokens": 1000,
            },
            "tenant_id": "tenant_01",
            "agent_id": "agent_01",
        }

    @pytest.fixture
    def tool_job(self):
        """Sample tool step job."""
        return {
            "run_id": "run_01",
            "step_id": "step_02",
            "step_type": "tool",
            "input": {
                "tool_name": "read_file",
                "tool_input": {"path": "/tmp/test.txt"},
            },
            "tenant_id": "tenant_01",
            "agent_id": "agent_01",
        }

    @pytest.fixture
    def sandbox_job(self):
        """Sample sandbox step job."""
        return {
            "run_id": "run_01",
            "step_id": "step_03",
            "step_type": "sandbox",
            "input": {
                "code": "print('hello world')",
                "language": "python",
                "timeout_seconds": 10,
                "mode": "subprocess",
            },
        }

    @pytest.fixture
    def retrieval_job(self):
        """Sample retrieval step job."""
        return {
            "run_id": "run_01",
            "step_id": "step_04",
            "step_type": "retrieval",
            "input": {
                "query": "What is Python?",
                "collection": "docs",
                "top_k": 3,
                "backend": "local",
                "documents": [
                    {"content": "Python is a programming language"},
                    {"content": "Java is also a programming language"},
                    {"content": "Python was created by Guido van Rossum"},
                ],
            },
        }


class TestLLMExecution:
    """Tests for LLM step execution."""

    @pytest.fixture
    def executor(self):
        """Create executor with mocked LLM."""
        with (
            patch("fd_worker.executor.ControlPlaneClient"),
            patch("fd_worker.executor.MCPRouter"),
            patch("fd_worker.executor.LLMExecutor"),
        ):
            executor = StepExecutor(
                control_plane_url="http://localhost:8080",
            )
            executor.client = AsyncMock()
            executor.mcp_router = AsyncMock()
            executor.llm_executor = AsyncMock()
            executor.artifact_store = AsyncMock()
            yield executor

    @pytest.mark.asyncio
    async def test_llm_execution_success(self, executor):
        """Test successful LLM execution."""
        # Mock LLM response
        mock_response = MagicMock()
        mock_response.content = "Hello! How can I help you?"
        mock_response.model = "claude-sonnet-4-20250514"
        mock_response.finish_reason = "end_turn"
        mock_response.usage = MagicMock()
        mock_response.usage.input_tokens = 50
        mock_response.usage.output_tokens = 20

        executor.llm_executor.complete = AsyncMock(return_value=mock_response)

        job = {
            "run_id": "run_01",
            "step_id": "step_01",
            "step_type": "llm",
            "input": {
                "messages": [{"role": "user", "content": "Hello!"}],
                "model": "claude-sonnet-4-20250514",
            },
        }

        await executor.execute(job)

        # Verify LLM was called
        executor.llm_executor.complete.assert_called_once()

        # Verify result was submitted
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args

        assert call_args.kwargs["run_id"] == "run_01"
        assert call_args.kwargs["step_id"] == "step_01"
        assert call_args.kwargs["output"] == "Hello! How can I help you?"

    @pytest.mark.asyncio
    async def test_llm_execution_with_task(self, executor):
        """Test LLM execution builds messages from task."""
        mock_response = MagicMock()
        mock_response.content = "Task completed"
        mock_response.model = "claude-sonnet-4-20250514"
        mock_response.finish_reason = "end_turn"
        mock_response.usage = MagicMock()
        mock_response.usage.input_tokens = 100
        mock_response.usage.output_tokens = 50

        executor.llm_executor.complete = AsyncMock(return_value=mock_response)

        job = {
            "run_id": "run_01",
            "step_id": "step_01",
            "step_type": "llm",
            "input": {
                "task": "Write a poem about coding",
                "system_prompt": "You are a poet.",
                "model": "claude-sonnet-4-20250514",
            },
        }

        await executor.execute(job)

        # Verify messages were built from task
        call_args = executor.llm_executor.complete.call_args
        messages = call_args.kwargs["messages"]

        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert "poet" in messages[0]["content"]
        assert messages[1]["role"] == "user"
        assert "poem" in messages[1]["content"]

    @pytest.mark.asyncio
    async def test_llm_execution_failure(self, executor):
        """Test LLM execution handles errors."""
        executor.llm_executor.complete = AsyncMock(side_effect=Exception("API error"))

        job = {
            "run_id": "run_01",
            "step_id": "step_01",
            "step_type": "llm",
            "input": {"messages": [{"role": "user", "content": "Hello!"}]},
        }

        await executor.execute(job)

        # Verify failure was reported
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args

        assert call_args.kwargs["status"].value == "failed"
        assert "error" in call_args.kwargs["output"]


class TestToolExecution:
    """Tests for tool step execution."""

    @pytest.fixture
    def executor(self):
        """Create executor with mocked MCP router."""
        with (
            patch("fd_worker.executor.ControlPlaneClient"),
            patch("fd_worker.executor.MCPRouter"),
            patch("fd_worker.executor.LLMExecutor"),
        ):
            executor = StepExecutor(
                control_plane_url="http://localhost:8080",
            )
            executor.client = AsyncMock()
            executor.mcp_router = AsyncMock()
            executor.llm_executor = AsyncMock()
            executor.artifact_store = AsyncMock()
            executor._mcp_connected = False
            yield executor

    @pytest.mark.asyncio
    async def test_tool_execution_success(self, executor):
        """Test successful tool execution."""
        mock_result = MagicMock()
        mock_result.success = True
        mock_result.output = {"content": "file contents"}
        mock_result.server = "filesystem"
        mock_result.tool = "read_file"
        mock_result.error = None

        executor.mcp_router.call_tool = AsyncMock(return_value=mock_result)
        executor.mcp_router.validate_tool_input = MagicMock(return_value=[])
        executor.mcp_router.connect = AsyncMock()

        job = {
            "run_id": "run_01",
            "step_id": "step_02",
            "step_type": "tool",
            "input": {
                "tool_name": "read_file",
                "tool_input": {"path": "/tmp/test.txt"},
            },
        }

        await executor.execute(job)

        # Verify tool was called
        executor.mcp_router.call_tool.assert_called_once_with(
            tool_name="read_file",
            tool_input={"path": "/tmp/test.txt"},
            run_id="run_01",
        )

        # Verify success was reported
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args
        assert call_args.kwargs["output"]["result"] == {"content": "file contents"}

    @pytest.mark.asyncio
    async def test_tool_execution_missing_tool_name(self, executor):
        """Test tool execution fails without tool_name."""
        job = {
            "run_id": "run_01",
            "step_id": "step_02",
            "step_type": "tool",
            "input": {
                "tool_input": {"path": "/tmp/test.txt"},
            },
        }

        await executor.execute(job)

        # Verify failure was reported
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args
        assert call_args.kwargs["status"].value == "failed"

    @pytest.mark.asyncio
    async def test_tool_execution_validation_failure(self, executor):
        """Test tool execution handles validation errors."""
        executor.mcp_router.validate_tool_input = MagicMock(
            return_value=["Missing required field: url"]
        )
        executor.mcp_router.connect = AsyncMock()

        job = {
            "run_id": "run_01",
            "step_id": "step_02",
            "step_type": "tool",
            "input": {
                "tool_name": "fetch_url",
                "tool_input": {},
            },
        }

        await executor.execute(job)

        # Verify failure was reported
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args
        assert call_args.kwargs["status"].value == "failed"


class TestSandboxExecution:
    """Tests for sandbox step execution."""

    @pytest.fixture
    def executor(self):
        """Create executor for sandbox tests."""
        with (
            patch("fd_worker.executor.ControlPlaneClient"),
            patch("fd_worker.executor.MCPRouter"),
            patch("fd_worker.executor.LLMExecutor"),
        ):
            executor = StepExecutor(
                control_plane_url="http://localhost:8080",
            )
            executor.client = AsyncMock()
            executor.mcp_router = AsyncMock()
            executor.llm_executor = AsyncMock()
            executor.artifact_store = AsyncMock()
            yield executor

    @pytest.mark.asyncio
    async def test_sandbox_python_execution(self, executor):
        """Test Python code execution in sandbox."""
        job = {
            "run_id": "run_01",
            "step_id": "step_03",
            "step_type": "sandbox",
            "input": {
                "code": "print('hello world')",
                "language": "python",
                "timeout_seconds": 5,
                "mode": "subprocess",
            },
        }

        await executor.execute(job)

        # Verify result was submitted
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args

        # Check output structure
        output = call_args.kwargs["output"]
        assert output["status"] == "completed"
        assert "hello world" in output["stdout"]
        assert output["exit_code"] == 0

    @pytest.mark.asyncio
    async def test_sandbox_missing_code(self, executor):
        """Test sandbox fails without code."""
        job = {
            "run_id": "run_01",
            "step_id": "step_03",
            "step_type": "sandbox",
            "input": {
                "language": "python",
            },
        }

        await executor.execute(job)

        # Verify failure was reported
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args
        assert call_args.kwargs["status"].value == "failed"


class TestRetrievalExecution:
    """Tests for retrieval step execution."""

    @pytest.fixture
    def executor(self):
        """Create executor for retrieval tests."""
        with (
            patch("fd_worker.executor.ControlPlaneClient"),
            patch("fd_worker.executor.MCPRouter"),
            patch("fd_worker.executor.LLMExecutor"),
        ):
            executor = StepExecutor(
                control_plane_url="http://localhost:8080",
            )
            executor.client = AsyncMock()
            executor.mcp_router = AsyncMock()
            executor.llm_executor = AsyncMock()
            executor.artifact_store = AsyncMock()
            yield executor

    @pytest.mark.asyncio
    async def test_retrieval_local_backend(self, executor):
        """Test local retrieval with keyword matching."""
        job = {
            "run_id": "run_01",
            "step_id": "step_04",
            "step_type": "retrieval",
            "input": {
                "query": "Python programming",
                "collection": "docs",
                "top_k": 2,
                "backend": "local",
                "documents": [
                    {"content": "Python is a programming language"},
                    {"content": "Java is also a programming language"},
                    {"content": "Python was created by Guido"},
                    {"content": "Cats are fluffy"},
                ],
            },
        }

        await executor.execute(job)

        # Verify result was submitted
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args

        output = call_args.kwargs["output"]
        assert output["query"] == "Python programming"
        assert output["collection"] == "docs"
        # Should return top 2 Python-related docs
        assert len(output["documents"]) <= 2

    @pytest.mark.asyncio
    async def test_retrieval_missing_query(self, executor):
        """Test retrieval fails without query."""
        job = {
            "run_id": "run_01",
            "step_id": "step_04",
            "step_type": "retrieval",
            "input": {
                "collection": "docs",
            },
        }

        await executor.execute(job)

        # Verify failure was reported
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args
        assert call_args.kwargs["status"].value == "failed"


class TestPolicyHandling:
    """Tests for policy enforcement handling."""

    @pytest.fixture
    def executor(self):
        """Create executor for policy tests."""
        with (
            patch("fd_worker.executor.ControlPlaneClient"),
            patch("fd_worker.executor.MCPRouter"),
            patch("fd_worker.executor.LLMExecutor"),
        ):
            executor = StepExecutor(
                control_plane_url="http://localhost:8080",
            )
            executor.client = AsyncMock()
            executor.mcp_router = AsyncMock()
            executor.llm_executor = AsyncMock()
            executor.artifact_store = AsyncMock()
            executor._mcp_connected = False
            yield executor

    @pytest.mark.asyncio
    async def test_policy_denied_tool(self, executor):
        """Test handling of policy denied tool calls."""
        executor.mcp_router.connect = AsyncMock()
        executor.mcp_router.validate_tool_input = MagicMock(return_value=[])
        executor.mcp_router.call_tool = AsyncMock(
            side_effect=PermissionError("Tool 'dangerous' is not in allowlist")
        )

        job = {
            "run_id": "run_01",
            "step_id": "step_02",
            "step_type": "tool",
            "input": {
                "tool_name": "dangerous",
                "tool_input": {},
            },
        }

        await executor.execute(job)

        # Verify policy denial was reported correctly
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args

        assert call_args.kwargs["status"].value == "failed"
        assert call_args.kwargs["output"]["policy_denied"] is True

    @pytest.mark.asyncio
    async def test_approval_required(self, executor):
        """Test handling when tool requires approval."""
        executor.mcp_router.connect = AsyncMock()
        executor.mcp_router.validate_tool_input = MagicMock(return_value=[])
        executor.mcp_router.call_tool = AsyncMock(
            side_effect=ValueError("Tool 'write_file' requires approval")
        )

        job = {
            "run_id": "run_01",
            "step_id": "step_02",
            "step_type": "tool",
            "input": {
                "tool_name": "write_file",
                "tool_input": {"path": "/tmp/file.txt", "content": "data"},
            },
        }

        await executor.execute(job)

        # Verify approval required was reported
        executor.client.submit_step_result.assert_called_once()
        call_args = executor.client.submit_step_result.call_args

        assert call_args.kwargs["status"].value == "pending"
        assert call_args.kwargs["output"]["requires_approval"] is True


class TestRetryBehavior:
    """Tests for retry logic."""

    @pytest.fixture
    def executor(self):
        """Create executor with retry config."""
        with (
            patch("fd_worker.executor.ControlPlaneClient"),
            patch("fd_worker.executor.MCPRouter"),
            patch("fd_worker.executor.LLMExecutor"),
        ):
            executor = StepExecutor(
                control_plane_url="http://localhost:8080",
                max_retries=3,
                retry_delay_ms=100,  # Fast retries for tests
            )
            executor.client = AsyncMock()
            executor.mcp_router = AsyncMock()
            executor.llm_executor = AsyncMock()
            executor.artifact_store = AsyncMock()
            yield executor

    @pytest.mark.asyncio
    async def test_retry_config_applied(self, executor):
        """Test that retry configuration is applied."""
        assert executor.max_retries == 3
        assert executor.retry_delay_ms == 100
