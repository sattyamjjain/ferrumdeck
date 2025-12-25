//! GenAI semantic conventions for OpenTelemetry
//!
//! Based on the OpenTelemetry GenAI semantic conventions.
//! https://opentelemetry.io/docs/specs/semconv/gen-ai/

/// Attribute keys for GenAI spans
pub mod attrs {
    // System attributes
    pub const GEN_AI_SYSTEM: &str = "gen_ai.system";
    pub const GEN_AI_REQUEST_MODEL: &str = "gen_ai.request.model";
    pub const GEN_AI_RESPONSE_MODEL: &str = "gen_ai.response.model";

    // Token usage
    pub const GEN_AI_USAGE_INPUT_TOKENS: &str = "gen_ai.usage.input_tokens";
    pub const GEN_AI_USAGE_OUTPUT_TOKENS: &str = "gen_ai.usage.output_tokens";
    pub const GEN_AI_USAGE_TOTAL_TOKENS: &str = "gen_ai.usage.total_tokens";

    // Request parameters
    pub const GEN_AI_REQUEST_TEMPERATURE: &str = "gen_ai.request.temperature";
    pub const GEN_AI_REQUEST_MAX_TOKENS: &str = "gen_ai.request.max_tokens";
    pub const GEN_AI_REQUEST_TOP_P: &str = "gen_ai.request.top_p";

    // Response attributes
    pub const GEN_AI_RESPONSE_FINISH_REASON: &str = "gen_ai.response.finish_reason";
    pub const GEN_AI_RESPONSE_ID: &str = "gen_ai.response.id";

    // Tool/function calling
    pub const GEN_AI_TOOL_NAME: &str = "gen_ai.tool.name";
    pub const GEN_AI_TOOL_CALL_ID: &str = "gen_ai.tool.call_id";

    // Agent/orchestration (extended)
    pub const FERRUMDECK_RUN_ID: &str = "ferrumdeck.run.id";
    pub const FERRUMDECK_STEP_ID: &str = "ferrumdeck.step.id";
    pub const FERRUMDECK_AGENT_ID: &str = "ferrumdeck.agent.id";
    pub const FERRUMDECK_TENANT_ID: &str = "ferrumdeck.tenant.id";

    // Cost tracking (extended)
    pub const FERRUMDECK_COST_CENTS: &str = "ferrumdeck.cost.cents";
    pub const FERRUMDECK_COST_CURRENCY: &str = "ferrumdeck.cost.currency";
}

/// GenAI system values
pub mod systems {
    pub const OPENAI: &str = "openai";
    pub const ANTHROPIC: &str = "anthropic";
}

/// Finish reasons
pub mod finish_reasons {
    pub const STOP: &str = "stop";
    pub const LENGTH: &str = "length";
    pub const TOOL_CALLS: &str = "tool_calls";
    pub const ERROR: &str = "error";
}

/// Helper functions for recording GenAI attributes on spans
pub mod span_helpers {
    use super::attrs;
    use tracing::Span;

    /// Record LLM request attributes on the current span
    pub fn record_llm_request(span: &Span, model: &str, system: &str) {
        span.record(attrs::GEN_AI_REQUEST_MODEL, model);
        span.record(attrs::GEN_AI_SYSTEM, system);
    }

    /// Record token usage on the current span
    pub fn record_token_usage(span: &Span, input_tokens: i64, output_tokens: i64) {
        span.record(attrs::GEN_AI_USAGE_INPUT_TOKENS, input_tokens);
        span.record(attrs::GEN_AI_USAGE_OUTPUT_TOKENS, output_tokens);
        span.record(
            attrs::GEN_AI_USAGE_TOTAL_TOKENS,
            input_tokens + output_tokens,
        );
    }

    /// Record cost on the current span
    pub fn record_cost(span: &Span, cost_cents: i64) {
        span.record(attrs::FERRUMDECK_COST_CENTS, cost_cents);
    }

    /// Record FerrumDeck context on the current span
    pub fn record_ferrumdeck_context(
        span: &Span,
        run_id: &str,
        step_id: Option<&str>,
        agent_id: Option<&str>,
    ) {
        span.record(attrs::FERRUMDECK_RUN_ID, run_id);
        if let Some(id) = step_id {
            span.record(attrs::FERRUMDECK_STEP_ID, id);
        }
        if let Some(id) = agent_id {
            span.record(attrs::FERRUMDECK_AGENT_ID, id);
        }
    }

    /// Record tool call on the current span
    pub fn record_tool_call(span: &Span, tool_name: &str, call_id: Option<&str>) {
        span.record(attrs::GEN_AI_TOOL_NAME, tool_name);
        if let Some(id) = call_id {
            span.record(attrs::GEN_AI_TOOL_CALL_ID, id);
        }
    }
}

/// Builder for creating GenAI spans with proper attributes
pub struct GenAISpanBuilder {
    span: tracing::Span,
}

impl GenAISpanBuilder {
    /// Create a new builder from an existing span
    pub fn new(span: tracing::Span) -> Self {
        Self { span }
    }

    /// Set the model being used
    pub fn model(self, model: &str) -> Self {
        self.span.record(attrs::GEN_AI_REQUEST_MODEL, model);
        self
    }

    /// Set the AI system (e.g., "openai", "anthropic")
    pub fn system(self, system: &str) -> Self {
        self.span.record(attrs::GEN_AI_SYSTEM, system);
        self
    }

    /// Set token usage
    pub fn tokens(self, input: i64, output: i64) -> Self {
        self.span.record(attrs::GEN_AI_USAGE_INPUT_TOKENS, input);
        self.span.record(attrs::GEN_AI_USAGE_OUTPUT_TOKENS, output);
        self.span
            .record(attrs::GEN_AI_USAGE_TOTAL_TOKENS, input + output);
        self
    }

    /// Set cost in cents
    pub fn cost_cents(self, cents: i64) -> Self {
        self.span.record(attrs::FERRUMDECK_COST_CENTS, cents);
        self
    }

    /// Set run ID
    pub fn run_id(self, id: &str) -> Self {
        self.span.record(attrs::FERRUMDECK_RUN_ID, id);
        self
    }

    /// Set step ID
    pub fn step_id(self, id: &str) -> Self {
        self.span.record(attrs::FERRUMDECK_STEP_ID, id);
        self
    }

    /// Get the configured span
    pub fn build(self) -> tracing::Span {
        self.span
    }
}

/// Model pricing (USD per million tokens)
/// Prices as of December 2024
pub mod pricing {
    /// Pricing info for a model
    #[derive(Debug, Clone, Copy)]
    pub struct ModelPricing {
        /// Cost per million input tokens in USD
        pub input_per_million: f64,
        /// Cost per million output tokens in USD
        pub output_per_million: f64,
    }

    impl ModelPricing {
        /// Calculate cost in cents
        pub fn calculate_cost_cents(&self, input_tokens: u64, output_tokens: u64) -> u64 {
            let input_cost = (input_tokens as f64 / 1_000_000.0) * self.input_per_million;
            let output_cost = (output_tokens as f64 / 1_000_000.0) * self.output_per_million;
            let total_usd = input_cost + output_cost;
            // Convert to cents and round up
            (total_usd * 100.0).ceil() as u64
        }
    }

    // OpenAI models
    pub const GPT_4O: ModelPricing = ModelPricing {
        input_per_million: 2.50,
        output_per_million: 10.00,
    };

    pub const GPT_4O_MINI: ModelPricing = ModelPricing {
        input_per_million: 0.15,
        output_per_million: 0.60,
    };

    pub const GPT_4_TURBO: ModelPricing = ModelPricing {
        input_per_million: 10.00,
        output_per_million: 30.00,
    };

    pub const O1: ModelPricing = ModelPricing {
        input_per_million: 15.00,
        output_per_million: 60.00,
    };

    pub const O1_MINI: ModelPricing = ModelPricing {
        input_per_million: 3.00,
        output_per_million: 12.00,
    };

    // Anthropic models
    pub const CLAUDE_3_5_SONNET: ModelPricing = ModelPricing {
        input_per_million: 3.00,
        output_per_million: 15.00,
    };

    pub const CLAUDE_3_OPUS: ModelPricing = ModelPricing {
        input_per_million: 15.00,
        output_per_million: 75.00,
    };

    pub const CLAUDE_3_HAIKU: ModelPricing = ModelPricing {
        input_per_million: 0.25,
        output_per_million: 1.25,
    };

    // Default fallback pricing (conservative estimate)
    pub const DEFAULT: ModelPricing = ModelPricing {
        input_per_million: 10.00,
        output_per_million: 30.00,
    };

    /// Get pricing for a model by name
    pub fn get_pricing(model: &str) -> ModelPricing {
        let model_lower = model.to_lowercase();

        // OpenAI models
        if model_lower.contains("gpt-4o-mini") {
            return GPT_4O_MINI;
        }
        if model_lower.contains("gpt-4o") {
            return GPT_4O;
        }
        if model_lower.contains("gpt-4-turbo") {
            return GPT_4_TURBO;
        }
        if model_lower.contains("o1-mini") {
            return O1_MINI;
        }
        if model_lower.contains("o1") {
            return O1;
        }

        // Anthropic models
        if model_lower.contains("claude-3-5-sonnet") || model_lower.contains("claude-3.5-sonnet") {
            return CLAUDE_3_5_SONNET;
        }
        if model_lower.contains("claude-3-opus") {
            return CLAUDE_3_OPUS;
        }
        if model_lower.contains("claude-3-haiku") {
            return CLAUDE_3_HAIKU;
        }

        DEFAULT
    }

    /// Calculate cost in cents for a given model and token counts
    pub fn calculate_cost_cents(model: &str, input_tokens: u64, output_tokens: u64) -> u64 {
        let pricing = get_pricing(model);
        pricing.calculate_cost_cents(input_tokens, output_tokens)
    }
}

#[cfg(test)]
mod tests {
    use super::pricing;

    #[test]
    fn test_gpt4o_pricing() {
        // 1000 input tokens + 500 output tokens
        let cost = pricing::calculate_cost_cents("gpt-4o", 1000, 500);
        // (1000/1M * 2.50) + (500/1M * 10.00) = 0.0025 + 0.005 = 0.0075 USD = 0.75 cents
        // Rounded up to 1 cent
        assert_eq!(cost, 1);
    }

    #[test]
    fn test_claude_pricing() {
        // 100000 input tokens + 50000 output tokens
        let cost = pricing::calculate_cost_cents("claude-3-5-sonnet", 100000, 50000);
        // (100000/1M * 3.00) + (50000/1M * 15.00) = 0.3 + 0.75 = 1.05 USD = 105 cents
        assert_eq!(cost, 105);
    }

    #[test]
    fn test_unknown_model_uses_default() {
        let cost = pricing::calculate_cost_cents("unknown-model", 1000000, 1000000);
        // Default pricing: (1M/1M * 10.00) + (1M/1M * 30.00) = 10 + 30 = 40 USD = 4000 cents
        assert_eq!(cost, 4000);
    }
}
