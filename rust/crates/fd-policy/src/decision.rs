//! Policy decisions

use fd_core::{PolicyDecisionId, PolicyRuleId};
use serde::{Deserialize, Serialize};

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
        }
    }

    pub fn deny(reason: impl Into<String>) -> Self {
        Self {
            id: PolicyDecisionId::new(),
            kind: PolicyDecisionKind::Deny,
            reason: reason.into(),
            rule_id: None,
            metadata: serde_json::Value::Null,
        }
    }

    pub fn requires_approval(reason: impl Into<String>) -> Self {
        Self {
            id: PolicyDecisionId::new(),
            kind: PolicyDecisionKind::RequiresApproval,
            reason: reason.into(),
            rule_id: None,
            metadata: serde_json::Value::Null,
        }
    }

    pub fn with_rule(mut self, rule_id: PolicyRuleId) -> Self {
        self.rule_id = Some(rule_id);
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
