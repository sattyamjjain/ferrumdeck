//! FerrumDeck OpenTelemetry Integration
//!
//! Provides OpenTelemetry setup with GenAI semantic conventions
//! for tracing LLM calls, tool invocations, and agent steps.

pub mod genai;
pub mod setup;

pub use setup::init_telemetry;
