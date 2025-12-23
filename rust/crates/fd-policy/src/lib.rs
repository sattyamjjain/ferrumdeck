//! FerrumDeck Policy Engine
//!
//! Enforces governance rules for agent runs:
//! - Tool allowlists (deny-by-default)
//! - Budget limits (tokens, tool calls, wall time)
//! - Approval gates for sensitive actions

pub mod budget;
pub mod decision;
pub mod engine;
pub mod rules;

pub use decision::{PolicyDecision, PolicyDecisionKind};
pub use engine::PolicyEngine;
