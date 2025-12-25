//! Run and Step entity models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Run status enum matching database
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "run_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Created,
    Queued,
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Cancelled,
    Timeout,
    /// Run was killed because budget limits were exceeded
    BudgetKilled,
    /// Run was blocked by policy engine (tool not allowed, etc.)
    PolicyBlocked,
}

impl RunStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            RunStatus::Completed
                | RunStatus::Failed
                | RunStatus::Cancelled
                | RunStatus::Timeout
                | RunStatus::BudgetKilled
                | RunStatus::PolicyBlocked
        )
    }
}

/// Run entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub project_id: String,
    pub agent_version_id: String,
    pub input: serde_json::Value,
    pub config: serde_json::Value,
    pub status: RunStatus,
    pub status_reason: Option<String>,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub tool_calls: i32,
    pub cost_cents: i32,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

/// Create run request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateRun {
    pub id: String,
    pub project_id: String,
    pub agent_version_id: String,
    pub input: serde_json::Value,
    pub config: serde_json::Value,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

/// Update run request
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateRun {
    pub status: Option<RunStatus>,
    pub status_reason: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub tool_calls: Option<i32>,
    pub cost_cents: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
}

/// Run with aggregated stats
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunWithStats {
    #[serde(flatten)]
    pub run: Run,
    pub step_count: i64,
    pub pending_steps: i64,
    pub completed_steps: i64,
    pub failed_steps: i64,
}
