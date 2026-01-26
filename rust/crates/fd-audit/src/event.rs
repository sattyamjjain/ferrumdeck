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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ==========================================================================
    // AUD-EVT-001: AuditEvent creation
    // ==========================================================================
    #[test]
    fn test_create_audit_event() {
        let tenant_id = TenantId::new();
        let run_id = RunId::new();
        let event = AuditEvent::new(
            tenant_id,
            AuditEventKind::RunCreated { run_id },
            AuditActor::System,
            AuditResource {
                resource_type: "run".to_string(),
                resource_id: run_id.to_string(),
            },
            "create_run",
            AuditOutcome::Success,
        );

        assert_eq!(event.tenant_id, tenant_id);
        assert!(event.id.to_string().starts_with("aud_"));
        assert_eq!(event.action, "create_run");
        assert_eq!(event.outcome, AuditOutcome::Success);
    }

    #[test]
    fn test_create_audit_event_with_metadata() {
        let tenant_id = TenantId::new();
        let run_id = RunId::new();
        let event = AuditEvent::new(
            tenant_id,
            AuditEventKind::RunCompleted { run_id },
            AuditActor::System,
            AuditResource {
                resource_type: "run".to_string(),
                resource_id: run_id.to_string(),
            },
            "complete_run",
            AuditOutcome::Success,
        )
        .with_metadata(json!({"duration_ms": 1500, "steps": 10}));

        assert!(!event.metadata.is_null());
        assert_eq!(event.metadata["duration_ms"], 1500);
        assert_eq!(event.metadata["steps"], 10);
    }

    // ==========================================================================
    // AUD-EVT-002: Event timestamp is UTC
    // ==========================================================================
    #[test]
    fn test_event_timestamp_utc() {
        let before = chrono::Utc::now();
        let tenant_id = TenantId::new();
        let run_id = RunId::new();
        let event = AuditEvent::new(
            tenant_id,
            AuditEventKind::RunStarted { run_id },
            AuditActor::System,
            AuditResource {
                resource_type: "run".to_string(),
                resource_id: run_id.to_string(),
            },
            "start_run",
            AuditOutcome::Success,
        );
        let after = chrono::Utc::now();

        assert!(event.timestamp >= before);
        assert!(event.timestamp <= after);
    }

    // ==========================================================================
    // AUD-EVT-003: Event serialization
    // ==========================================================================
    #[test]
    fn test_event_serialization() {
        let tenant_id = TenantId::new();
        let run_id = RunId::new();
        let step_id = StepId::new();
        let event = AuditEvent::new(
            tenant_id,
            AuditEventKind::StepStarted { run_id, step_id },
            AuditActor::User {
                user_id: "user_123".to_string(),
            },
            AuditResource {
                resource_type: "step".to_string(),
                resource_id: step_id.to_string(),
            },
            "start_step",
            AuditOutcome::Pending,
        );

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("step_started"));
        assert!(json.contains("user_123"));
        assert!(json.contains("pending"));
    }

    #[test]
    fn test_event_deserialization() {
        let tenant_id = TenantId::new();
        let run_id = RunId::new();
        let event = AuditEvent::new(
            tenant_id,
            AuditEventKind::RunCreated { run_id },
            AuditActor::System,
            AuditResource {
                resource_type: "run".to_string(),
                resource_id: run_id.to_string(),
            },
            "create",
            AuditOutcome::Success,
        );

        let json = serde_json::to_string(&event).unwrap();
        let parsed: AuditEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.id, event.id);
        assert_eq!(parsed.action, "create");
    }

    // ==========================================================================
    // AUD-EVT-004: AuditActor types
    // ==========================================================================
    #[test]
    fn test_actor_system() {
        let actor = AuditActor::System;
        let json = serde_json::to_string(&actor).unwrap();
        assert!(json.contains("system"));
    }

    #[test]
    fn test_actor_user() {
        let actor = AuditActor::User {
            user_id: "usr_abc123".to_string(),
        };
        let json = serde_json::to_string(&actor).unwrap();
        assert!(json.contains("user"));
        assert!(json.contains("usr_abc123"));
    }

    #[test]
    fn test_actor_api_key() {
        let actor = AuditActor::ApiKey {
            key_id: "key_xyz789".to_string(),
        };
        let json = serde_json::to_string(&actor).unwrap();
        assert!(json.contains("api_key"));
        assert!(json.contains("key_xyz789"));
    }

    #[test]
    fn test_actor_agent() {
        let actor = AuditActor::Agent {
            agent_id: "agt_123".to_string(),
            run_id: "run_456".to_string(),
        };
        let json = serde_json::to_string(&actor).unwrap();
        assert!(json.contains("agent"));
        assert!(json.contains("agt_123"));
        assert!(json.contains("run_456"));
    }

    // ==========================================================================
    // AUD-EVT-005: AuditEventKind variants
    // ==========================================================================
    #[test]
    fn test_event_kind_run_created() {
        let run_id = RunId::new();
        let kind = AuditEventKind::RunCreated { run_id };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("run_created"));
    }

    #[test]
    fn test_event_kind_run_failed() {
        let run_id = RunId::new();
        let kind = AuditEventKind::RunFailed {
            run_id,
            reason: "timeout".to_string(),
        };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("run_failed"));
        assert!(json.contains("timeout"));
    }

    #[test]
    fn test_event_kind_step_completed() {
        let run_id = RunId::new();
        let step_id = StepId::new();
        let kind = AuditEventKind::StepCompleted { run_id, step_id };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("step_completed"));
    }

    #[test]
    fn test_event_kind_policy_decision() {
        let run_id = RunId::new();
        let kind = AuditEventKind::PolicyDecision {
            run_id,
            action: "execute_tool".to_string(),
            allowed: true,
        };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("policy_decision"));
        assert!(json.contains("execute_tool"));
        assert!(json.contains("true"));
    }

    #[test]
    fn test_event_kind_approval_granted() {
        let run_id = RunId::new();
        let kind = AuditEventKind::ApprovalGranted {
            run_id,
            action: "delete_file".to_string(),
            approver: "admin@example.com".to_string(),
        };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("approval_granted"));
        assert!(json.contains("approver"));
    }

    #[test]
    fn test_event_kind_budget_exceeded() {
        let run_id = RunId::new();
        let kind = AuditEventKind::BudgetExceeded {
            run_id,
            resource: "tokens".to_string(),
            limit: "10000".to_string(),
        };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("budget_exceeded"));
        assert!(json.contains("tokens"));
    }

    #[test]
    fn test_event_kind_tool_called() {
        let run_id = RunId::new();
        let step_id = StepId::new();
        let kind = AuditEventKind::ToolCalled {
            run_id,
            step_id,
            tool_name: "http_request".to_string(),
        };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("tool_called"));
        assert!(json.contains("http_request"));
    }

    #[test]
    fn test_event_kind_api_key_created() {
        let kind = AuditEventKind::ApiKeyCreated {
            key_id: "key_new123".to_string(),
        };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("api_key_created"));
    }

    #[test]
    fn test_event_kind_custom() {
        let kind = AuditEventKind::Custom {
            event_type: "custom_event".to_string(),
        };
        let json = serde_json::to_string(&kind).unwrap();
        assert!(json.contains("custom"));
        assert!(json.contains("custom_event"));
    }

    // ==========================================================================
    // AUD-EVT-006: AuditOutcome values
    // ==========================================================================
    #[test]
    fn test_outcome_success() {
        let outcome = AuditOutcome::Success;
        let json = serde_json::to_string(&outcome).unwrap();
        assert_eq!(json, "\"success\"");
    }

    #[test]
    fn test_outcome_failure() {
        let outcome = AuditOutcome::Failure;
        let json = serde_json::to_string(&outcome).unwrap();
        assert_eq!(json, "\"failure\"");
    }

    #[test]
    fn test_outcome_pending() {
        let outcome = AuditOutcome::Pending;
        let json = serde_json::to_string(&outcome).unwrap();
        assert_eq!(json, "\"pending\"");
    }

    #[test]
    fn test_outcome_equality() {
        assert_eq!(AuditOutcome::Success, AuditOutcome::Success);
        assert_ne!(AuditOutcome::Success, AuditOutcome::Failure);
    }

    #[test]
    fn test_outcome_roundtrip() {
        for outcome in [AuditOutcome::Success, AuditOutcome::Failure, AuditOutcome::Pending] {
            let json = serde_json::to_string(&outcome).unwrap();
            let parsed: AuditOutcome = serde_json::from_str(&json).unwrap();
            assert_eq!(outcome, parsed);
        }
    }

    // ==========================================================================
    // AUD-EVT-007: AuditResource
    // ==========================================================================
    #[test]
    fn test_resource_serialization() {
        let resource = AuditResource {
            resource_type: "run".to_string(),
            resource_id: "run_abc123".to_string(),
        };
        let json = serde_json::to_string(&resource).unwrap();
        assert!(json.contains("run"));
        assert!(json.contains("run_abc123"));
    }

    #[test]
    fn test_resource_deserialization() {
        let json = r#"{"resource_type":"step","resource_id":"stp_xyz789"}"#;
        let resource: AuditResource = serde_json::from_str(json).unwrap();
        assert_eq!(resource.resource_type, "step");
        assert_eq!(resource.resource_id, "stp_xyz789");
    }

    // ==========================================================================
    // AUD-EVT-008: Clone and Debug
    // ==========================================================================
    #[test]
    fn test_event_clone() {
        let tenant_id = TenantId::new();
        let run_id = RunId::new();
        let event = AuditEvent::new(
            tenant_id,
            AuditEventKind::RunCreated { run_id },
            AuditActor::System,
            AuditResource {
                resource_type: "run".to_string(),
                resource_id: run_id.to_string(),
            },
            "create",
            AuditOutcome::Success,
        );
        let cloned = event.clone();
        assert_eq!(cloned.id, event.id);
        assert_eq!(cloned.action, event.action);
    }

    #[test]
    fn test_event_debug() {
        let tenant_id = TenantId::new();
        let run_id = RunId::new();
        let event = AuditEvent::new(
            tenant_id,
            AuditEventKind::RunCreated { run_id },
            AuditActor::System,
            AuditResource {
                resource_type: "run".to_string(),
                resource_id: run_id.to_string(),
            },
            "create",
            AuditOutcome::Success,
        );
        let debug = format!("{:?}", event);
        assert!(debug.contains("AuditEvent"));
    }

    #[test]
    fn test_actor_clone() {
        let actor = AuditActor::User {
            user_id: "usr_test".to_string(),
        };
        let cloned = actor.clone();
        let json1 = serde_json::to_string(&actor).unwrap();
        let json2 = serde_json::to_string(&cloned).unwrap();
        assert_eq!(json1, json2);
    }

    #[test]
    fn test_kind_clone() {
        let run_id = RunId::new();
        let kind = AuditEventKind::RunCompleted { run_id };
        let cloned = kind.clone();
        let json1 = serde_json::to_string(&kind).unwrap();
        let json2 = serde_json::to_string(&cloned).unwrap();
        assert_eq!(json1, json2);
    }
}
