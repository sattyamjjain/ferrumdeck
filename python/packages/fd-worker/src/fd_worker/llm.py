"""LLM execution via litellm."""

from dataclasses import dataclass
from typing import Any

import litellm


@dataclass
class LLMUsage:
    """Token usage from LLM call."""

    input_tokens: int
    output_tokens: int


@dataclass
class LLMResponse:
    """Response from LLM call."""

    content: str | dict[str, Any]
    usage: LLMUsage
    model: str
    finish_reason: str


class LLMExecutor:
    """Execute LLM completions via litellm."""

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
        """Execute an LLM completion."""
        kwargs: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }

        if tools:
            kwargs["tools"] = tools

        response = await litellm.acompletion(**kwargs)

        # Extract content
        choice = response.choices[0]
        if choice.message.tool_calls:
            content = {
                "tool_calls": [
                    {
                        "id": tc.id,
                        "name": tc.function.name,
                        "arguments": tc.function.arguments,
                    }
                    for tc in choice.message.tool_calls
                ]
            }
        else:
            content = choice.message.content or ""

        return LLMResponse(
            content=content,
            usage=LLMUsage(
                input_tokens=response.usage.prompt_tokens,  # type: ignore[union-attr]
                output_tokens=response.usage.completion_tokens,  # type: ignore[union-attr]
            ),
            model=response.model or model,
            finish_reason=choice.finish_reason or "unknown",
        )
