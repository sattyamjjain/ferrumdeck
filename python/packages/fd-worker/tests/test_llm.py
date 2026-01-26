"""Tests for LLM executor.

Test IDs: PY-LLM-001 to PY-LLM-008
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from fd_worker.llm import (
    LLMExecutor,
    LLMResponse,
    LLMUsage,
    ToolCall,
    convert_mcp_tools_to_llm_format,
)


class TestLLMUsage:
    """Tests for LLMUsage dataclass."""

    def test_usage_addition(self):
        """Test adding two usage objects together."""
        usage1 = LLMUsage(input_tokens=100, output_tokens=50)
        usage2 = LLMUsage(input_tokens=200, output_tokens=100)
        combined = usage1 + usage2
        assert combined.input_tokens == 300
        assert combined.output_tokens == 150


class TestToolCall:
    """Tests for ToolCall dataclass."""

    def test_tool_call_creation(self):
        """Test creating a tool call."""
        tc = ToolCall(id="call_123", name="read_file", arguments={"path": "/tmp/test"})
        assert tc.id == "call_123"
        assert tc.name == "read_file"
        assert tc.arguments["path"] == "/tmp/test"


class TestLLMResponse:
    """Tests for LLMResponse dataclass."""

    def test_has_tool_calls_true(self):
        """Test has_tool_calls returns true when tool calls present."""
        response = LLMResponse(
            content="",
            usage=LLMUsage(input_tokens=100, output_tokens=50),
            model="claude-3-sonnet",
            finish_reason="tool_calls",
            tool_calls=[ToolCall(id="1", name="test", arguments={})],
        )
        assert response.has_tool_calls is True

    def test_has_tool_calls_false(self):
        """Test has_tool_calls returns false when no tool calls."""
        response = LLMResponse(
            content="Hello",
            usage=LLMUsage(input_tokens=100, output_tokens=50),
            model="claude-3-sonnet",
            finish_reason="stop",
            tool_calls=[],
        )
        assert response.has_tool_calls is False


class TestConvertMCPTools:
    """Tests for MCP to LLM tool format conversion."""

    def test_convert_single_tool(self):
        """Test converting a single MCP tool definition."""
        mcp_tools = [
            {
                "name": "read_file",
                "description": "Read a file from disk",
                "inputSchema": {
                    "type": "object",
                    "properties": {"path": {"type": "string"}},
                    "required": ["path"],
                },
            }
        ]

        result = convert_mcp_tools_to_llm_format(mcp_tools)

        assert len(result) == 1
        assert result[0]["type"] == "function"
        assert result[0]["function"]["name"] == "read_file"
        assert result[0]["function"]["description"] == "Read a file from disk"
        assert result[0]["function"]["parameters"]["type"] == "object"

    def test_convert_multiple_tools(self):
        """Test converting multiple MCP tool definitions."""
        mcp_tools = [
            {"name": "tool1", "description": "First tool", "inputSchema": {}},
            {"name": "tool2", "description": "Second tool", "inputSchema": {}},
        ]

        result = convert_mcp_tools_to_llm_format(mcp_tools)

        assert len(result) == 2
        assert result[0]["function"]["name"] == "tool1"
        assert result[1]["function"]["name"] == "tool2"

    def test_convert_handles_missing_fields(self):
        """Test conversion handles missing optional fields gracefully."""
        mcp_tools = [{"name": "minimal"}]

        result = convert_mcp_tools_to_llm_format(mcp_tools)

        assert result[0]["function"]["name"] == "minimal"
        assert result[0]["function"]["description"] == ""
        assert result[0]["function"]["parameters"] == {"type": "object", "properties": {}}


class TestLLMExecutor:
    """Tests for LLMExecutor class."""

    @pytest.fixture
    def executor(self):
        """Create an LLM executor instance."""
        return LLMExecutor()

    # PY-LLM-001: LLM completion succeeds
    @pytest.mark.asyncio
    async def test_complete_success(self, executor):
        """Test successful LLM completion."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(
                    content="Hello, world!",
                    tool_calls=None,
                ),
                finish_reason="stop",
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
        mock_response.model = "claude-3-sonnet"

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            response = await executor.complete(
                messages=[{"role": "user", "content": "Hello"}],
                model="claude-3-sonnet",
            )

            assert response.content == "Hello, world!"
            assert response.usage.input_tokens == 10
            assert response.usage.output_tokens == 5
            assert response.finish_reason == "stop"
            mock_complete.assert_called_once()

    # PY-LLM-002: Tool definitions passed correctly
    @pytest.mark.asyncio
    async def test_complete_with_tools(self, executor):
        """Test that tool definitions are passed to the LLM."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content="", tool_calls=None),
                finish_reason="stop",
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=10, completion_tokens=5)
        mock_response.model = "claude-3-sonnet"

        tools = [
            {
                "type": "function",
                "function": {"name": "test_tool", "description": "A test tool", "parameters": {}},
            }
        ]

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            await executor.complete(
                messages=[{"role": "user", "content": "Test"}],
                tools=tools,
            )

            call_kwargs = mock_complete.call_args.kwargs
            assert "tools" in call_kwargs
            assert call_kwargs["tools"] == tools

    # PY-LLM-003: Token counting
    @pytest.mark.asyncio
    async def test_token_counting(self, executor):
        """Test that tokens are counted correctly."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content="Response", tool_calls=None),
                finish_reason="stop",
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=150, completion_tokens=75)
        mock_response.model = "claude-3-sonnet"

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            response = await executor.complete(
                messages=[{"role": "user", "content": "Long prompt"}]
            )

            assert response.usage.input_tokens == 150
            assert response.usage.output_tokens == 75
            assert executor._total_input_tokens == 150
            assert executor._total_output_tokens == 75

    # PY-LLM-004: Cost calculation (via token usage)
    @pytest.mark.asyncio
    async def test_cumulative_token_tracking(self, executor):
        """Test that cumulative token usage is tracked across calls."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content="Response", tool_calls=None),
                finish_reason="stop",
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=100, completion_tokens=50)
        mock_response.model = "claude-3-sonnet"

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            await executor.complete(messages=[{"role": "user", "content": "First"}])
            await executor.complete(messages=[{"role": "user", "content": "Second"}])

            assert executor._total_input_tokens == 200
            assert executor._total_output_tokens == 100
            assert executor._call_count == 2

    # PY-LLM-005: Handle tool calls in response
    @pytest.mark.asyncio
    async def test_tool_call_parsing(self, executor):
        """Test that tool calls are parsed from response."""
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.function.name = "read_file"
        mock_tool_call.function.arguments = '{"path": "/tmp/test.txt"}'

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content="", tool_calls=[mock_tool_call]),
                finish_reason="tool_calls",
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=50, completion_tokens=25)
        mock_response.model = "claude-3-sonnet"

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            response = await executor.complete(messages=[{"role": "user", "content": "Read file"}])

            assert response.has_tool_calls
            assert len(response.tool_calls) == 1
            assert response.tool_calls[0].id == "call_123"
            assert response.tool_calls[0].name == "read_file"
            assert response.tool_calls[0].arguments == {"path": "/tmp/test.txt"}

    # PY-LLM-006: Rate limit / error handling
    @pytest.mark.asyncio
    async def test_error_propagation(self, executor):
        """Test that LLM errors are propagated."""
        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.side_effect = Exception("Rate limit exceeded")

            with pytest.raises(Exception, match="Rate limit exceeded"):
                await executor.complete(messages=[{"role": "user", "content": "Test"}])

    # PY-LLM-007: Invalid JSON in tool arguments
    @pytest.mark.asyncio
    async def test_invalid_json_tool_arguments(self, executor):
        """Test handling of invalid JSON in tool arguments."""
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_456"
        mock_tool_call.function.name = "some_tool"
        mock_tool_call.function.arguments = "not valid json"

        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content="", tool_calls=[mock_tool_call]),
                finish_reason="tool_calls",
            )
        ]
        mock_response.usage = MagicMock(prompt_tokens=50, completion_tokens=25)
        mock_response.model = "claude-3-sonnet"

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            response = await executor.complete(messages=[{"role": "user", "content": "Test"}])

            assert response.has_tool_calls
            assert response.tool_calls[0].arguments == {"raw": "not valid json"}

    # PY-LLM-008: Format tool result message
    def test_format_tool_result_message(self, executor):
        """Test formatting tool result as a message."""
        result = executor.format_tool_result_message(
            tool_call_id="call_123",
            result={"status": "success", "data": "file contents"},
        )

        assert result["role"] == "tool"
        assert result["tool_call_id"] == "call_123"
        assert '"status": "success"' in result["content"]

    def test_format_tool_result_message_string(self, executor):
        """Test formatting string tool result."""
        result = executor.format_tool_result_message(
            tool_call_id="call_456",
            result="Simple string result",
        )

        assert result["content"] == "Simple string result"

    def test_format_assistant_tool_calls_message(self, executor):
        """Test formatting assistant message with tool calls."""
        tool_calls = [
            ToolCall(id="call_1", name="read_file", arguments={"path": "/test"}),
            ToolCall(id="call_2", name="write_file", arguments={"path": "/out", "content": "data"}),
        ]

        result = executor.format_assistant_tool_calls_message(
            content="Let me help you with that.",
            tool_calls=tool_calls,
        )

        assert result["role"] == "assistant"
        assert result["content"] == "Let me help you with that."
        assert len(result["tool_calls"]) == 2
        assert result["tool_calls"][0]["id"] == "call_1"
        assert result["tool_calls"][0]["function"]["name"] == "read_file"


class TestAnomalyDetection:
    """Tests for LLM executor security/anomaly detection."""

    @pytest.fixture
    def executor(self):
        """Create an LLM executor instance."""
        return LLMExecutor()

    @pytest.mark.asyncio
    async def test_high_input_tokens_warning(self, executor):
        """Test that high input token usage triggers warning."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content="Response", tool_calls=None),
                finish_reason="stop",
            )
        ]
        # Exceed threshold
        mock_response.usage = MagicMock(prompt_tokens=150_000, completion_tokens=100)
        mock_response.model = "claude-3-sonnet"

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            await executor.complete(messages=[{"role": "user", "content": "Test"}])

            # Check security logging was triggered (threshold is 100_000)
            assert executor._total_input_tokens == 150_000

    @pytest.mark.asyncio
    async def test_high_output_tokens_warning(self, executor):
        """Test that high output token usage triggers warning."""
        mock_response = MagicMock()
        mock_response.choices = [
            MagicMock(
                message=MagicMock(content="Response", tool_calls=None),
                finish_reason="stop",
            )
        ]
        # Exceed threshold
        mock_response.usage = MagicMock(prompt_tokens=100, completion_tokens=60_000)
        mock_response.model = "claude-3-sonnet"

        with patch("litellm.acompletion", new_callable=AsyncMock) as mock_complete:
            mock_complete.return_value = mock_response

            await executor.complete(messages=[{"role": "user", "content": "Test"}])

            assert executor._total_output_tokens == 60_000
