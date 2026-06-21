//! FerrumDeck OpenTelemetry Integration
//!
//! Provides OpenTelemetry setup with GenAI semantic conventions
//! for tracing LLM calls, tool invocations, and agent steps.

pub mod claim_grounding;
pub mod cost_decomposition;
pub mod firing_rate;
pub mod genai;
pub mod setup;

pub use claim_grounding::{ClaimGrounding, DEFAULT_MIN_CLAIM_GROUNDING_RATE};
pub use cost_decomposition::{CostBreakdown, SpanRole, COST_DECOMPOSITION_ANCHOR};
pub use firing_rate::{FiringRate, DEFAULT_LOW_FIRING_RATE_THRESHOLD};
pub use setup::init_telemetry;
