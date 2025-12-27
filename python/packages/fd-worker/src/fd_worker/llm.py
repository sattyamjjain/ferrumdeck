"""LLM execution via litellm with tool support."""

import json
from dataclasses import dataclass, field
from typing import Any

import litellm


@dataclass
class LLMUsage:
    """Token usage from LLM call."""

    input_tokens: int
    output_tokens: int

    def __add__(self, other: "LLMUsage") -> "LLMUsage":
        """Add two usage objects together."""
        return LLMUsage(
            input_tokens=self.input_tokens + other.input_tokens,
            output_tokens=self.output_tokens + other.output_tokens,
        )


@dataclass
class ToolCall:
    """A tool call requested by the LLM."""

    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMResponse:
    """Response from LLM call."""

    content: str
    usage: LLMUsage
    model: str
    finish_reason: str
    tool_calls: list[ToolCall] = field(default_factory=list)

    @property
    def has_tool_calls(self) -> bool:
        """Check if response contains tool calls."""
        return len(self.tool_calls) > 0


def convert_mcp_tools_to_llm_format(mcp_tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert MCP tool definitions to OpenAI/Anthropic tool format.

    MCP tool format:
    {
        "name": "get_file_contents",
        "description": "Read file contents from a repository",
        "inputSchema": {
            "type": "object",
            "properties": {...},
            "required": [...]
        }
    }

    LLM tool format (OpenAI):
    {
        "type": "function",
        "function": {
            "name": "get_file_contents",
            "description": "Read file contents from a repository",
            "parameters": {
                "type": "object",
                "properties": {...},
                "required": [...]
            }
        }
    }
    """
    llm_tools = []
    for tool in mcp_tools:
        llm_tool = {
            "type": "function",
            "function": {
                "name": tool.get("name", ""),
                "description": tool.get("description", ""),
                "parameters": tool.get("inputSchema", {"type": "object", "properties": {}}),
            },
        }
        llm_tools.append(llm_tool)
    return llm_tools


class LLMExecutor:
    """Execute LLM completions via litellm with tool support."""

    def __init__(self):
        # litellm reads API keys from environment
        # ANTHROPIC_API_KEY, OPENAI_API_KEY, etc.
        pass

    async def complete(
        self,
        messages: list[dict[str, Any]],
        model: str = "claude-sonnet-4-20250514",
        tools: list[dict[str, Any]] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> LLMResponse:
        """Execute an LLM completion.

        Args:
            messages: Conversation messages
            model: Model to use
            tools: Tool definitions in LLM format (use convert_mcp_tools_to_llm_format)
            temperature: Sampling temperature
            max_tokens: Maximum tokens to generate

        Returns:
            LLMResponse with content and optional tool_calls
        """
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        if tools:
            kwargs["tools"] = tools

        response = await litellm.acompletion(**kwargs)

        # Extract content and tool calls
        choice = response.choices[0]
        content = choice.message.content or ""
        tool_calls: list[ToolCall] = []

        if choice.message.tool_calls:
            for tc in choice.message.tool_calls:
                # Parse arguments from JSON string
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {"raw": tc.function.arguments}

                tool_calls.append(
                    ToolCall(
                        id=tc.id,
                        name=tc.function.name,
                        arguments=args,
                    )
                )

        return LLMResponse(
            content=content,
            usage=LLMUsage(
                input_tokens=response.usage.prompt_tokens,  # type: ignore[union-attr]
                output_tokens=response.usage.completion_tokens,  # type: ignore[union-attr]
            ),
            model=response.model or model,
            finish_reason=choice.finish_reason or "unknown",
            tool_calls=tool_calls,
        )

    def format_tool_result_message(
        self,
        tool_call_id: str,
        result: str | dict[str, Any],
    ) -> dict[str, Any]:
        """Format a tool result as a message for the conversation.

        Args:
            tool_call_id: The ID of the tool call this result is for
            result: The tool execution result

        Returns:
            Message dict in the format expected by the LLM
        """
        if isinstance(result, dict):
            result_str = json.dumps(result, indent=2)
        else:
            result_str = str(result)

        return {
            "role": "tool",
            "tool_call_id": tool_call_id,
            "content": result_str,
        }

    def format_assistant_tool_calls_message(
        self,
        content: str,
        tool_calls: list[ToolCall],
    ) -> dict[str, Any]:
        """Format the assistant's response with tool calls as a message.

        This is needed to maintain conversation history when the LLM
        makes tool calls - we need to include both the content and
        the tool calls in the assistant message.
        """
        return {
            "role": "assistant",
            "content": content,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.name,
                        "arguments": json.dumps(tc.arguments),
                    },
                }
                for tc in tool_calls
            ],
        }
