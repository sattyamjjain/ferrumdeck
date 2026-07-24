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
pub mod colorado_sb26_189;
pub mod decision;
pub mod engine;
pub mod forecast;
pub mod harness;
pub mod lease;
pub mod precedence;
pub mod promotion;
pub mod reversibility;
pub mod routing;
pub mod rules;
pub mod trace;
pub mod transparency_art50;
pub mod x402;

pub use bench_audit::{BenchAuditPolicy, BenchGatedClaim, BenchTrustSummary, BENCH_AUDIT_ANCHOR};
pub use colorado_sb26_189::{
    check as check_colorado_admt, enforce as enforce_colorado_admt,
    response_level as colorado_admt_response_level, AdmtDecisionContext, AutomationRole,
    ColoradoAdmtConfig, ColoradoAdmtRecord, ColoradoAdmtStatus, ConsequentialDomain,
    COLORADO_SB26_189_ANCHOR, RETENTION_FLOOR_YEARS,
};
pub use decision::{PolicyDecision, PolicyDecisionKind};
pub use engine::PolicyEngine;
pub use harness::{
    fold_status, HarnessSuggestion, SuggestionEvidence, SuggestionKind, SuggestionStatus,
    HARNESS_ANCHOR,
};
pub use lease::{BudgetLease, LeaseError, SharedBudget, LEASE_ANCHOR};
pub use precedence::{
    precedence_rank, resolve_conflicts, OverrideRecord, PolicyVerdict, ResolvedDecision,
    VerdictKind, PRECEDENCE_LABEL,
};
pub use promotion::{
    MetricEvidence, MetricThreshold, PromotionDecision, PromotionGate, PromotionGateConfig,
    PromotionStatus, PROMOTION_ANCHOR,
};
pub use reversibility::{
    combine as combine_response, graduated_response, ResponseLevel, Reversibility,
    RESPONSE_LADDER_ANCHOR,
};
pub use routing::{
    RoutingCandidate, RoutingChoice, RoutingDecision, RoutingReason, RoutingReasonCode,
    ROUTING_ANCHOR,
};
pub use rules::{ToolAllowlist, ToolAllowlistResult, ToolRiskLevel};
pub use trace::DecisionTrace;
pub use transparency_art50::{
    check as check_art50, enforce as enforce_art50, response_level as art50_response_level,
    Art50Config, Art50Status, EU_AI_ACT_ART50_ANCHOR,
};
pub use x402::{
    evaluate_x402_payment, X402Challenge, X402CostEvent, X402GateOutcome, X402_ANCHOR,
    X402_PAYMENT_REQUIRED_STATUS,
};

// Re-export Airlock types for convenience
pub use airlock::{
    AirlockConfig, AirlockInspector, AirlockMode, AirlockResult, AirlockViolation,
    BlockingCategory, CoherenceConfig, CoherenceMonitor, CoherenceSpan, InspectionContext,
    RiskLevel, TrajectoryEvent, ViolationType, COHERENCE_ANCHOR,
};
