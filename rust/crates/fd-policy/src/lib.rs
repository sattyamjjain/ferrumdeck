//! FerrumDeck Policy Engine
//!
//! Enforces governance rules for agent runs:
//! - Tool allowlists (deny-by-default)
//! - Budget limits (tokens, tool calls, wall time)
//! - Approval gates for sensitive actions
//! - **Airlock**: Runtime security inspection (Agent RASP)

pub mod airlock;
pub mod bench_audit;
pub mod budget;
pub mod decision;
pub mod engine;
pub mod forecast;
pub mod lease;
pub mod precedence;
pub mod promotion;
pub mod routing;
pub mod rules;
pub mod trace;

pub use bench_audit::{BenchAuditPolicy, BenchGatedClaim, BenchTrustSummary, BENCH_AUDIT_ANCHOR};
pub use decision::{PolicyDecision, PolicyDecisionKind};
pub use engine::PolicyEngine;
pub use lease::{BudgetLease, LeaseError, SharedBudget, LEASE_ANCHOR};
pub use precedence::{
    precedence_rank, resolve_conflicts, OverrideRecord, PolicyVerdict, ResolvedDecision,
    VerdictKind, PRECEDENCE_LABEL,
};
pub use promotion::{
    MetricEvidence, MetricThreshold, PromotionDecision, PromotionGate, PromotionGateConfig,
    PromotionStatus, PROMOTION_ANCHOR,
};
pub use routing::{
    RoutingCandidate, RoutingChoice, RoutingDecision, RoutingReason, RoutingReasonCode,
    ROUTING_ANCHOR,
};
pub use rules::{ToolAllowlist, ToolAllowlistResult, ToolRiskLevel};
pub use trace::DecisionTrace;

// Re-export Airlock types for convenience
pub use airlock::{
    AirlockConfig, AirlockInspector, AirlockMode, AirlockResult, AirlockViolation,
    BlockingCategory, CoherenceConfig, CoherenceMonitor, CoherenceSpan, InspectionContext,
    RiskLevel, TrajectoryEvent, ViolationType, COHERENCE_ANCHOR,
};
