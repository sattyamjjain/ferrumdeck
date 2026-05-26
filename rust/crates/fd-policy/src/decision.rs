//! Policy decisions

use fd_core::{PolicyDecisionId, PolicyRuleId};
use serde::{Deserialize, Serialize};

use crate::trace::DecisionTrace;

/// The outcome of a policy evaluation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PolicyDecision {
    /// Unique ID for this decision (for audit trail)
    pub id: PolicyDecisionId,

    /// The decision outcome
    pub kind: PolicyDecisionKind,

    /// Human-readable explanation
    pub reason: String,

    /// The rule that triggered this decision (if any)
    pub rule_id: Option<PolicyRuleId>,

    /// Additional context
    #[serde(default)]
    pub metadata: serde_json::Value,

    /// Audit-grade explanation of how this decision was reached: every
    /// matched verdict, which one fired, and which were overridden by
    /// precedence. `None` for legacy code paths that haven't been wired
    /// through the conflict resolver yet — additive on the wire.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace: Option<DecisionTrace>,
}

/// The kind of policy decision
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyDecisionKind {
    /// Action is allowed to proceed
    Allow,

    /// Action is denied
    Deny,

    /// Action requires human approval before proceeding
    RequiresApproval,

    /// Action is allowed but with warnings
    AllowWithWarning,
}

impl PolicyDecision {
    pub fn allow(reason: impl Into<String>) -> Self {
        Self {
            id: PolicyDecisionId::new(),
            kind: PolicyDecisionKind::Allow,
            reason: reason.into(),
            rule_id: None,
            metadata: serde_json::Value::Null,
            trace: None,
        }
    }

    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            id: PolicyDecisionId::new(),
            kind: PolicyDecisionKind::Deny,
            reason: reason.into(),
            rule_id: None,
            metadata: serde_json::Value::Null,
            trace: None,
        }
    }

    pub fn requires_approval(reason: impl Into<String>) -> Self {
        Self {
            id: PolicyDecisionId::new(),
            kind: PolicyDecisionKind::RequiresApproval,
            reason: reason.into(),
            rule_id: None,
            metadata: serde_json::Value::Null,
            trace: None,
        }
    }

    pub fn with_rule(mut self, rule_id: PolicyRuleId) -> Self {
        self.rule_id = Some(rule_id);
        self
    }

    /// Attach an explanation trace produced by
    /// [`crate::precedence::resolve_conflicts`] +
    /// [`crate::trace::DecisionTrace::from_resolution`].
    pub fn with_trace(mut self, trace: DecisionTrace) -> Self {
        self.trace = Some(trace);
        self
    }

    pub fn is_allowed(&self) -> bool {
        matches!(
            self.kind,
            PolicyDecisionKind::Allow | PolicyDecisionKind::AllowWithWarning
        )
    }

    pub fn is_denied(&self) -> bool {
        matches!(self.kind, PolicyDecisionKind::Deny)
    }

    pub fn needs_approval(&self) -> bool {
        matches!(self.kind, PolicyDecisionKind::RequiresApproval)
    }
}
