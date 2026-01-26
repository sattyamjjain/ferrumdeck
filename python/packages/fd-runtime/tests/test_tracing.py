"""Tests for OpenTelemetry tracing utilities."""

import pytest

from fd_runtime.tracing import (
    MODEL_PRICING,
    calculate_cost,
)


# ==========================================================================
# RT-TRC-001: Cost calculation for known models
# ==========================================================================
class TestCalculateCost:
    """Tests for calculate_cost function."""

    def test_claude_opus_cost(self) -> None:
        """Test cost calculation for Claude Opus."""
        cost = calculate_cost("claude-3-opus-20240229", input_tokens=1000, output_tokens=500)

        # Opus: $15/M input, $75/M output
        expected_input = (1000 / 1_000_000) * 15.0
        expected_output = (500 / 1_000_000) * 75.0
        expected_total = expected_input + expected_output

        assert cost["input_cost_usd"] == pytest.approx(expected_input, rel=1e-4)
        assert cost["output_cost_usd"] == pytest.approx(expected_output, rel=1e-4)
        assert cost["total_cost_usd"] == pytest.approx(expected_total, rel=1e-4)

    def test_claude_sonnet_cost(self) -> None:
        """Test cost calculation for Claude Sonnet."""
        cost = calculate_cost("claude-3-5-sonnet-20241022", input_tokens=10000, output_tokens=5000)

        # Sonnet: $3/M input, $15/M output
        expected_input = (10000 / 1_000_000) * 3.0
        expected_output = (5000 / 1_000_000) * 15.0

        assert cost["input_cost_usd"] == pytest.approx(expected_input, rel=1e-4)
        assert cost["output_cost_usd"] == pytest.approx(expected_output, rel=1e-4)

    def test_claude_haiku_cost(self) -> None:
        """Test cost calculation for Claude Haiku."""
        cost = calculate_cost("claude-3-haiku-20240307", input_tokens=100000, output_tokens=50000)

        # Haiku: $0.25/M input, $1.25/M output
        expected_input = (100000 / 1_000_000) * 0.25
        expected_output = (50000 / 1_000_000) * 1.25

        assert cost["input_cost_usd"] == pytest.approx(expected_input, rel=1e-4)
        assert cost["output_cost_usd"] == pytest.approx(expected_output, rel=1e-4)

    def test_gpt4o_cost(self) -> None:
        """Test cost calculation for GPT-4o."""
        cost = calculate_cost("gpt-4o", input_tokens=10000, output_tokens=5000)

        # GPT-4o: $2.50/M input, $10/M output
        expected_input = (10000 / 1_000_000) * 2.50
        expected_output = (5000 / 1_000_000) * 10.0

        assert cost["input_cost_usd"] == pytest.approx(expected_input, rel=1e-4)
        assert cost["output_cost_usd"] == pytest.approx(expected_output, rel=1e-4)

    def test_gpt4o_mini_cost(self) -> None:
        """Test cost calculation for GPT-4o-mini."""
        cost = calculate_cost("gpt-4o-mini", input_tokens=50000, output_tokens=25000)

        # GPT-4o-mini: $0.15/M input, $0.60/M output
        expected_input = (50000 / 1_000_000) * 0.15
        expected_output = (25000 / 1_000_000) * 0.60

        assert cost["input_cost_usd"] == pytest.approx(expected_input, rel=1e-4)
        assert cost["output_cost_usd"] == pytest.approx(expected_output, rel=1e-4)


# ==========================================================================
# RT-TRC-002: Cost calculation for unknown models
# ==========================================================================
class TestCalculateCostUnknownModel:
    """Tests for cost calculation with unknown models."""

    def test_unknown_model_defaults_to_sonnet_pricing(self) -> None:
        """Test that unknown models use default Sonnet pricing."""
        cost = calculate_cost("unknown-model-v1", input_tokens=1000, output_tokens=500)

        # Default: $3/M input, $15/M output (sonnet pricing)
        expected_input = (1000 / 1_000_000) * 3.0
        expected_output = (500 / 1_000_000) * 15.0

        assert cost["input_cost_usd"] == pytest.approx(expected_input, rel=1e-4)
        assert cost["output_cost_usd"] == pytest.approx(expected_output, rel=1e-4)

    def test_empty_model_name(self) -> None:
        """Test cost calculation with empty model name."""
        cost = calculate_cost("", input_tokens=1000, output_tokens=500)

        # Should use default pricing
        assert "total_cost_usd" in cost
        assert cost["total_cost_usd"] > 0


# ==========================================================================
# RT-TRC-003: Cost calculation edge cases
# ==========================================================================
class TestCalculateCostEdgeCases:
    """Tests for cost calculation edge cases."""

    def test_zero_tokens(self) -> None:
        """Test cost calculation with zero tokens."""
        cost = calculate_cost("claude-3-opus-20240229", input_tokens=0, output_tokens=0)

        assert cost["input_cost_usd"] == 0.0
        assert cost["output_cost_usd"] == 0.0
        assert cost["total_cost_usd"] == 0.0

    def test_input_only(self) -> None:
        """Test cost calculation with only input tokens."""
        cost = calculate_cost("gpt-4o", input_tokens=10000, output_tokens=0)

        expected_input = (10000 / 1_000_000) * 2.50
        assert cost["input_cost_usd"] == pytest.approx(expected_input, rel=1e-4)
        assert cost["output_cost_usd"] == 0.0
        assert cost["total_cost_usd"] == pytest.approx(expected_input, rel=1e-4)

    def test_output_only(self) -> None:
        """Test cost calculation with only output tokens."""
        cost = calculate_cost("gpt-4o", input_tokens=0, output_tokens=5000)

        expected_output = (5000 / 1_000_000) * 10.0
        assert cost["input_cost_usd"] == 0.0
        assert cost["output_cost_usd"] == pytest.approx(expected_output, rel=1e-4)
        assert cost["total_cost_usd"] == pytest.approx(expected_output, rel=1e-4)

    def test_large_token_counts(self) -> None:
        """Test cost calculation with large token counts."""
        cost = calculate_cost(
            "claude-3-opus-20240229",
            input_tokens=1_000_000,
            output_tokens=500_000,
        )

        # 1M input at $15/M = $15, 500K output at $75/M = $37.50
        assert cost["input_cost_usd"] == pytest.approx(15.0, rel=1e-4)
        assert cost["output_cost_usd"] == pytest.approx(37.5, rel=1e-4)
        assert cost["total_cost_usd"] == pytest.approx(52.5, rel=1e-4)

    def test_cost_precision(self) -> None:
        """Test that costs are rounded to 6 decimal places."""
        cost = calculate_cost("claude-3-haiku-20240307", input_tokens=1, output_tokens=1)

        # Small amounts should have proper precision
        assert isinstance(cost["input_cost_usd"], float)
        assert isinstance(cost["output_cost_usd"], float)
        assert isinstance(cost["total_cost_usd"], float)

        # Check rounding
        str_cost = str(cost["total_cost_usd"])
        decimal_places = len(str_cost.split(".")[-1]) if "." in str_cost else 0
        assert decimal_places <= 6


# ==========================================================================
# RT-TRC-004: Model pricing data
# ==========================================================================
class TestModelPricing:
    """Tests for MODEL_PRICING data structure."""

    def test_claude_models_present(self) -> None:
        """Test that Claude models are in pricing table."""
        assert "claude-3-opus-20240229" in MODEL_PRICING
        assert "claude-3-5-sonnet-20241022" in MODEL_PRICING
        assert "claude-3-haiku-20240307" in MODEL_PRICING
        assert "claude-3-5-haiku-20241022" in MODEL_PRICING

    def test_openai_models_present(self) -> None:
        """Test that OpenAI models are in pricing table."""
        assert "gpt-4o" in MODEL_PRICING
        assert "gpt-4o-mini" in MODEL_PRICING
        assert "gpt-4-turbo" in MODEL_PRICING
        assert "gpt-4" in MODEL_PRICING
        assert "gpt-3.5-turbo" in MODEL_PRICING

    def test_pricing_structure(self) -> None:
        """Test that pricing entries have correct structure."""
        for model, pricing in MODEL_PRICING.items():
            assert "input" in pricing, f"Model {model} missing input pricing"
            assert "output" in pricing, f"Model {model} missing output pricing"
            assert isinstance(pricing["input"], (int, float))
            assert isinstance(pricing["output"], (int, float))
            assert pricing["input"] >= 0
            assert pricing["output"] >= 0

    def test_output_more_expensive_than_input(self) -> None:
        """Test that output tokens are typically more expensive than input."""
        # This is generally true for LLMs - output generation is more expensive
        for model, pricing in MODEL_PRICING.items():
            # Output should be >= input price for most models
            assert pricing["output"] >= pricing["input"], (
                f"Model {model}: output (${pricing['output']}) should be >= "
                f"input (${pricing['input']})"
            )


# ==========================================================================
# RT-TRC-005: Semantic convention constants
# ==========================================================================
class TestSemanticConventions:
    """Tests for semantic convention attribute names."""

    def test_genai_attributes_defined(self) -> None:
        """Test that GenAI semantic convention attributes are defined."""
        from fd_runtime.tracing import (
            GEN_AI_REQUEST_MAX_TOKENS,
            GEN_AI_REQUEST_MODEL,
            GEN_AI_REQUEST_TEMPERATURE,
            GEN_AI_RESPONSE_FINISH_REASON,
            GEN_AI_RESPONSE_MODEL,
            GEN_AI_SYSTEM,
            GEN_AI_USAGE_INPUT_TOKENS,
            GEN_AI_USAGE_OUTPUT_TOKENS,
        )

        assert GEN_AI_SYSTEM == "gen_ai.system"
        assert GEN_AI_REQUEST_MODEL == "gen_ai.request.model"
        assert GEN_AI_REQUEST_MAX_TOKENS == "gen_ai.request.max_tokens"
        assert GEN_AI_REQUEST_TEMPERATURE == "gen_ai.request.temperature"
        assert GEN_AI_RESPONSE_MODEL == "gen_ai.response.model"
        assert "finish" in GEN_AI_RESPONSE_FINISH_REASON.lower()
        assert GEN_AI_USAGE_INPUT_TOKENS == "gen_ai.usage.input_tokens"
        assert GEN_AI_USAGE_OUTPUT_TOKENS == "gen_ai.usage.output_tokens"

    def test_tool_attributes_defined(self) -> None:
        """Test that tool semantic convention attributes are defined."""
        from fd_runtime.tracing import TOOL_NAME, TOOL_SERVER, TOOL_STATUS

        assert TOOL_NAME == "tool.name"
        assert TOOL_SERVER == "tool.server"
        assert TOOL_STATUS == "tool.status"

    def test_ferrumdeck_attributes_defined(self) -> None:
        """Test that FerrumDeck custom attributes are defined."""
        from fd_runtime.tracing import (
            FD_AGENT_ID,
            FD_RUN_ID,
            FD_STEP_ID,
            FD_STEP_TYPE,
            FD_TENANT_ID,
        )

        assert "ferrumdeck" in FD_RUN_ID.lower()
        assert "ferrumdeck" in FD_STEP_ID.lower()
        assert "ferrumdeck" in FD_STEP_TYPE.lower()
        assert "ferrumdeck" in FD_TENANT_ID.lower()
        assert "ferrumdeck" in FD_AGENT_ID.lower()

    def test_cost_attributes_defined(self) -> None:
        """Test that cost tracking attributes are defined."""
        from fd_runtime.tracing import (
            GEN_AI_USAGE_COST_INPUT_USD,
            GEN_AI_USAGE_COST_OUTPUT_USD,
            GEN_AI_USAGE_COST_USD,
            GEN_AI_USAGE_TOTAL_TOKENS,
        )

        assert "cost" in GEN_AI_USAGE_COST_USD.lower()
        assert "cost" in GEN_AI_USAGE_COST_INPUT_USD.lower()
        assert "cost" in GEN_AI_USAGE_COST_OUTPUT_USD.lower()
        assert "total_tokens" in GEN_AI_USAGE_TOTAL_TOKENS.lower()
