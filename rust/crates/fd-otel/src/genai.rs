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
