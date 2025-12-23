//! Audit event models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::net::IpAddr;

/// Audit event entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AuditEvent {
    pub id: String,
    pub actor_type: String,
    pub actor_id: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub details: serde_json::Value,
    pub tenant_id: Option<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub run_id: Option<String>,
    pub request_id: Option<String>,
    // Note: IpAddr doesn't implement FromRow, so we use String
    #[sqlx(skip)]
    pub ip_address: Option<IpAddr>,
    #[sqlx(rename = "ip_address")]
    ip_address_str: Option<String>,
    pub user_agent: Option<String>,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    pub occurred_at: DateTime<Utc>,
}

impl AuditEvent {
    /// Get the IP address
    pub fn ip_address(&self) -> Option<IpAddr> {
        self.ip_address_str.as_ref().and_then(|s| s.parse().ok())
    }
}

/// Create audit event request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAuditEvent {
    pub id: String,
    pub actor_type: String,
    pub actor_id: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub details: serde_json::Value,
    pub tenant_id: Option<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub run_id: Option<String>,
    pub request_id: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

/// Actor types for audit events
pub mod actor {
    pub const USER: &str = "user";
    pub const API_KEY: &str = "api_key";
    pub const SYSTEM: &str = "system";
    pub const AGENT: &str = "agent";
}

/// Common audit actions
pub mod action {
    // Run actions
    pub const RUN_CREATED: &str = "run.created";
    pub const RUN_STARTED: &str = "run.started";
    pub const RUN_COMPLETED: &str = "run.completed";
    pub const RUN_FAILED: &str = "run.failed";
    pub const RUN_CANCELLED: &str = "run.cancelled";

    // Step actions
    pub const STEP_CREATED: &str = "step.created";
    pub const STEP_STARTED: &str = "step.started";
    pub const STEP_COMPLETED: &str = "step.completed";
    pub const STEP_FAILED: &str = "step.failed";

    // Policy actions
    pub const POLICY_ALLOWED: &str = "policy.allowed";
    pub const POLICY_DENIED: &str = "policy.denied";
    pub const POLICY_APPROVAL_REQUIRED: &str = "policy.approval_required";

    // Approval actions
    pub const APPROVAL_APPROVED: &str = "approval.approved";
    pub const APPROVAL_REJECTED: &str = "approval.rejected";
    pub const APPROVAL_EXPIRED: &str = "approval.expired";

    // Registry actions
    pub const AGENT_CREATED: &str = "agent.created";
    pub const AGENT_UPDATED: &str = "agent.updated";
    pub const AGENT_VERSION_CREATED: &str = "agent_version.created";
    pub const TOOL_CREATED: &str = "tool.created";
    pub const TOOL_UPDATED: &str = "tool.updated";

    // Auth actions
    pub const API_KEY_CREATED: &str = "api_key.created";
    pub const API_KEY_REVOKED: &str = "api_key.revoked";
    pub const API_KEY_USED: &str = "api_key.used";
}

/// Resource types
pub mod resource {
    pub const RUN: &str = "run";
    pub const STEP: &str = "step";
    pub const AGENT: &str = "agent";
    pub const AGENT_VERSION: &str = "agent_version";
    pub const TOOL: &str = "tool";
    pub const POLICY_RULE: &str = "policy_rule";
    pub const APPROVAL: &str = "approval";
    pub const API_KEY: &str = "api_key";
}

/// Audit event builder for ergonomic creation
pub struct AuditEventBuilder {
    event: CreateAuditEvent,
}

impl AuditEventBuilder {
    pub fn new(action: impl Into<String>, resource_type: impl Into<String>) -> Self {
        Self {
            event: CreateAuditEvent {
                id: format!("aud_{}", ulid::Ulid::new()),
                actor_type: actor::SYSTEM.to_string(),
                actor_id: None,
                action: action.into(),
                resource_type: resource_type.into(),
                resource_id: None,
                details: serde_json::json!({}),
                tenant_id: None,
                workspace_id: None,
                project_id: None,
                run_id: None,
                request_id: None,
                ip_address: None,
                user_agent: None,
                trace_id: None,
                span_id: None,
            },
        }
    }

    pub fn actor(mut self, actor_type: impl Into<String>, actor_id: Option<String>) -> Self {
        self.event.actor_type = actor_type.into();
        self.event.actor_id = actor_id;
        self
    }

    pub fn resource_id(mut self, id: impl Into<String>) -> Self {
        self.event.resource_id = Some(id.into());
        self
    }

    pub fn details(mut self, details: serde_json::Value) -> Self {
        self.event.details = details;
        self
    }

    pub fn tenant(mut self, tenant_id: impl Into<String>) -> Self {
        self.event.tenant_id = Some(tenant_id.into());
        self
    }

    pub fn project(mut self, project_id: impl Into<String>) -> Self {
        self.event.project_id = Some(project_id.into());
        self
    }

    pub fn run(mut self, run_id: impl Into<String>) -> Self {
        self.event.run_id = Some(run_id.into());
        self
    }

    pub fn request(mut self, request_id: impl Into<String>) -> Self {
        self.event.request_id = Some(request_id.into());
        self
    }

    pub fn trace(mut self, trace_id: impl Into<String>, span_id: impl Into<String>) -> Self {
        self.event.trace_id = Some(trace_id.into());
        self.event.span_id = Some(span_id.into());
        self
    }

    pub fn build(self) -> CreateAuditEvent {
        self.event
    }
}
