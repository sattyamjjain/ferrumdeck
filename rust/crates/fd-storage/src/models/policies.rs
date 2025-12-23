//! Policy entity models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Policy effect enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "policy_effect", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum PolicyEffect {
    Allow,
    Deny,
    RequireApproval,
}

/// Policy rule entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct PolicyRule {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub priority: i32,
    pub conditions: serde_json::Value,
    pub effect: PolicyEffect,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub created_by: Option<String>,
}

/// Create policy rule request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePolicyRule {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub priority: i32,
    pub conditions: serde_json::Value,
    pub effect: PolicyEffect,
    pub created_by: Option<String>,
}

/// Update policy rule request
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdatePolicyRule {
    pub name: Option<String>,
    pub description: Option<String>,
    pub priority: Option<i32>,
    pub conditions: Option<serde_json::Value>,
    pub effect: Option<PolicyEffect>,
    pub enabled: Option<bool>,
}

/// Policy decision entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct PolicyDecision {
    pub id: String,
    pub run_id: Option<String>,
    pub step_id: Option<String>,
    pub action_type: String,
    pub action_details: serde_json::Value,
    pub decision: PolicyEffect,
    pub matched_rule_id: Option<String>,
    pub reason: String,
    pub evaluated_at: DateTime<Utc>,
    pub evaluation_time_ms: Option<i32>,
}

/// Create policy decision request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePolicyDecision {
    pub id: String,
    pub run_id: Option<String>,
    pub step_id: Option<String>,
    pub action_type: String,
    pub action_details: serde_json::Value,
    pub decision: PolicyEffect,
    pub matched_rule_id: Option<String>,
    pub reason: String,
    pub evaluation_time_ms: Option<i32>,
}

/// Approval status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "approval_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Approved,
    Rejected,
    Expired,
}

/// Approval request entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub policy_decision_id: String,
    pub action_type: String,
    pub action_details: serde_json::Value,
    pub reason: String,
    pub status: ApprovalStatus,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<DateTime<Utc>>,
    pub resolution_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Create approval request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApprovalRequest {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub policy_decision_id: String,
    pub action_type: String,
    pub action_details: serde_json::Value,
    pub reason: String,
    pub expires_at: Option<DateTime<Utc>>,
}

/// Resolve approval request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResolveApproval {
    pub status: ApprovalStatus,
    pub resolved_by: String,
    pub resolution_note: Option<String>,
}
