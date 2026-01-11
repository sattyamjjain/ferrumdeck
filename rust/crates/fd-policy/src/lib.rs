//! FerrumDeck Policy Engine
//!
//! Enforces governance rules for agent runs:
//! - Tool allowlists (deny-by-default)
//! - Budget limits (tokens, tool calls, wall time)
//! - Approval gates for sensitive actions
//! - **Airlock**: Runtime security inspection (Agent RASP)

pub mod airlock;
pub mod budget;
pub mod decision;
pub mod engine;
pub mod rules;

pub use decision::{PolicyDecision, PolicyDecisionKind};
pub use engine::PolicyEngine;

// Re-export Airlock types for convenience
pub use airlock::{
    AirlockConfig, AirlockInspector, AirlockMode, AirlockResult, AirlockViolation,
    InspectionContext, RiskLevel, ViolationType,
};
