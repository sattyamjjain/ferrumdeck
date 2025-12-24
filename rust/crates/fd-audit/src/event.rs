//! Audit events

use chrono::{DateTime, Utc};
use fd_core::{AuditEventId, RunId, StepId, TenantId};
use serde::{Deserialize, Serialize};

/// An audit event (immutable once created)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: AuditEventId,
    pub timestamp: DateTime<Utc>,
    pub tenant_id: TenantId,
    pub kind: AuditEventKind,
    pub actor: AuditActor,
    pub resource: AuditResource,
    pub action: String,
    pub outcome: AuditOutcome,
    pub metadata: serde_json::Value,
}

/// The kind of audit event
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuditEventKind {
    /// Run lifecycle events
    RunCreated {
        run_id: RunId,
    },
    RunStarted {
        run_id: RunId,
    },
    RunCompleted {
        run_id: RunId,
    },
    RunFailed {
        run_id: RunId,
        reason: String,
    },

    /// Step events
    StepStarted {
        run_id: RunId,
        step_id: StepId,
    },
    StepCompleted {
        run_id: RunId,
        step_id: StepId,
    },
    StepFailed {
        run_id: RunId,
        step_id: StepId,
        reason: String,
    },

    /// Policy events
    PolicyDecision {
        run_id: RunId,
        action: String,
        allowed: bool,
    },
    ApprovalRequested {
        run_id: RunId,
        action: String,
    },
    ApprovalGranted {
        run_id: RunId,
        action: String,
        approver: String,
    },
    ApprovalDenied {
        run_id: RunId,
        action: String,
        approver: String,
    },

    /// Budget events
    BudgetExceeded {
        run_id: RunId,
        resource: String,
        limit: String,
    },

    /// Tool events
    ToolCalled {
        run_id: RunId,
        step_id: StepId,
        tool_name: String,
    },
    ToolSucceeded {
        run_id: RunId,
        step_id: StepId,
        tool_name: String,
    },
    ToolFailed {
        run_id: RunId,
        step_id: StepId,
        tool_name: String,
        error: String,
    },

    /// Authentication events
    ApiKeyCreated {
        key_id: String,
    },
    ApiKeyRevoked {
        key_id: String,
    },

    /// Generic event
    Custom {
        event_type: String,
    },
}

/// Who performed the action
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AuditActor {
    System,
    User { user_id: String },
    ApiKey { key_id: String },
    Agent { agent_id: String, run_id: String },
}

/// The resource being acted upon
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditResource {
    pub resource_type: String,
    pub resource_id: String,
}

/// The outcome of the action
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditOutcome {
    Success,
    Failure,
    Pending,
}

impl AuditEvent {
    pub fn new(
        tenant_id: TenantId,
        kind: AuditEventKind,
        actor: AuditActor,
        resource: AuditResource,
        action: impl Into<String>,
        outcome: AuditOutcome,
    ) -> Self {
        Self {
            id: AuditEventId::new(),
            timestamp: Utc::now(),
            tenant_id,
            kind,
            actor,
            resource,
            action: action.into(),
            outcome,
            metadata: serde_json::Value::Null,
        }
    }

    pub fn with_metadata(mut self, metadata: serde_json::Value) -> Self {
        self.metadata = metadata;
        self
    }
}
