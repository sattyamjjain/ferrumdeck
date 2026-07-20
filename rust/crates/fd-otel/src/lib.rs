//! FerrumDeck OpenTelemetry Integration
//!
//! Provides OpenTelemetry setup with GenAI semantic conventions
//! for tracing LLM calls, tool invocations, and agent steps.

pub mod claim_grounding;
pub mod cost_decomposition;
pub mod decision;
pub mod firing_rate;
pub mod genai;
pub mod setup;
pub mod trace_context;

pub use claim_grounding::{ClaimGrounding, DEFAULT_MIN_CLAIM_GROUNDING_RATE};
pub use cost_decomposition::{CostBreakdown, SpanRole, COST_DECOMPOSITION_ANCHOR};
pub use decision::{
    emit_tool_decision_span, DecisionOutcome, GenAiSemconv, GEN_AI_LATEST_EXPERIMENTAL,
    OTEL_SEMCONV_STABILITY_OPT_IN,
};
pub use firing_rate::{FiringRate, DEFAULT_LOW_FIRING_RATE_THRESHOLD};
pub use setup::init_telemetry;
pub use trace_context::{
    extract_from_meta as extract_trace_context, ExtractedTraceContext, TraceDrops,
    BAGGAGE_META_KEY, MCP_TRACE_CONTEXT_ANCHOR, TRACEPARENT_META_KEY, TRACESTATE_META_KEY,
};
