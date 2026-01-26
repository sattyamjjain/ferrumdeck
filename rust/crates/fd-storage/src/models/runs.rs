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

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // STO-RUN-001: RunStatus enum values
    // ==========================================================================
    #[test]
    fn test_run_status_created() {
        let status = RunStatus::Created;
        assert!(!status.is_terminal());
    }

    #[test]
    fn test_run_status_queued() {
        let status = RunStatus::Queued;
        assert!(!status.is_terminal());
    }

    #[test]
    fn test_run_status_running() {
        let status = RunStatus::Running;
        assert!(!status.is_terminal());
    }

    #[test]
    fn test_run_status_waiting_approval() {
        let status = RunStatus::WaitingApproval;
        assert!(!status.is_terminal());
    }

    // ==========================================================================
    // STO-RUN-002: Terminal status detection
    // ==========================================================================
    #[test]
    fn test_run_status_completed_is_terminal() {
        assert!(RunStatus::Completed.is_terminal());
    }

    #[test]
    fn test_run_status_failed_is_terminal() {
        assert!(RunStatus::Failed.is_terminal());
    }

    #[test]
    fn test_run_status_cancelled_is_terminal() {
        assert!(RunStatus::Cancelled.is_terminal());
    }

    #[test]
    fn test_run_status_timeout_is_terminal() {
        assert!(RunStatus::Timeout.is_terminal());
    }

    #[test]
    fn test_run_status_budget_killed_is_terminal() {
        assert!(RunStatus::BudgetKilled.is_terminal());
    }

    #[test]
    fn test_run_status_policy_blocked_is_terminal() {
        assert!(RunStatus::PolicyBlocked.is_terminal());
    }

    // ==========================================================================
    // STO-RUN-003: RunStatus serialization
    // ==========================================================================
    #[test]
    fn test_run_status_serialization_snake_case() {
        let status = RunStatus::WaitingApproval;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"waiting_approval\"");
    }

    #[test]
    fn test_run_status_deserialization_snake_case() {
        let status: RunStatus = serde_json::from_str("\"budget_killed\"").unwrap();
        assert_eq!(status, RunStatus::BudgetKilled);
    }

    #[test]
    fn test_run_status_roundtrip() {
        let statuses = vec![
            RunStatus::Created,
            RunStatus::Queued,
            RunStatus::Running,
            RunStatus::WaitingApproval,
            RunStatus::Completed,
            RunStatus::Failed,
            RunStatus::Cancelled,
            RunStatus::Timeout,
            RunStatus::BudgetKilled,
            RunStatus::PolicyBlocked,
        ];
        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let parsed: RunStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, parsed);
        }
    }

    // ==========================================================================
    // STO-RUN-004: CreateRun serialization
    // ==========================================================================
    #[test]
    fn test_create_run_serialization() {
        let create = CreateRun {
            id: "run_123".to_string(),
            project_id: "prj_456".to_string(),
            agent_version_id: "agv_789".to_string(),
            input: serde_json::json!({"task": "test"}),
            config: serde_json::json!({}),
            trace_id: Some("trace_abc".to_string()),
            span_id: None,
        };

        let json = serde_json::to_string(&create).unwrap();
        assert!(json.contains("run_123"));
        assert!(json.contains("prj_456"));
        assert!(json.contains("task"));
    }

    #[test]
    fn test_create_run_deserialization() {
        let json = r#"{
            "id": "run_test",
            "project_id": "prj_test",
            "agent_version_id": "agv_test",
            "input": {"prompt": "hello"},
            "config": {"max_tokens": 100}
        }"#;

        let create: CreateRun = serde_json::from_str(json).unwrap();
        assert_eq!(create.id, "run_test");
        assert!(create.trace_id.is_none());
    }

    // ==========================================================================
    // STO-RUN-005: UpdateRun defaults
    // ==========================================================================
    #[test]
    fn test_update_run_default() {
        let update = UpdateRun::default();
        assert!(update.status.is_none());
        assert!(update.status_reason.is_none());
        assert!(update.input_tokens.is_none());
        assert!(update.output_tokens.is_none());
        assert!(update.tool_calls.is_none());
        assert!(update.cost_cents.is_none());
        assert!(update.started_at.is_none());
        assert!(update.completed_at.is_none());
        assert!(update.output.is_none());
        assert!(update.error.is_none());
    }

    #[test]
    fn test_update_run_partial() {
        let update = UpdateRun {
            status: Some(RunStatus::Running),
            input_tokens: Some(100),
            ..Default::default()
        };
        assert_eq!(update.status, Some(RunStatus::Running));
        assert_eq!(update.input_tokens, Some(100));
        assert!(update.output.is_none());
    }

    // ==========================================================================
    // STO-RUN-006: Run equality
    // ==========================================================================
    #[test]
    fn test_run_status_equality() {
        assert_eq!(RunStatus::Running, RunStatus::Running);
        assert_ne!(RunStatus::Running, RunStatus::Completed);
    }

    #[test]
    fn test_run_status_copy() {
        let status = RunStatus::Created;
        let copied = status;
        assert_eq!(status, copied);
    }

    #[test]
    #[allow(clippy::clone_on_copy)]
    fn test_run_status_clone() {
        let status = RunStatus::WaitingApproval;
        let cloned = status.clone();
        assert_eq!(status, cloned);
    }

    // ==========================================================================
    // STO-RUN-007: Debug formatting
    // ==========================================================================
    #[test]
    fn test_run_status_debug() {
        let status = RunStatus::BudgetKilled;
        let debug = format!("{:?}", status);
        assert_eq!(debug, "BudgetKilled");
    }

    #[test]
    fn test_create_run_debug() {
        let create = CreateRun {
            id: "run_debug".to_string(),
            project_id: "prj_1".to_string(),
            agent_version_id: "agv_1".to_string(),
            input: serde_json::json!(null),
            config: serde_json::json!({}),
            trace_id: None,
            span_id: None,
        };
        let debug = format!("{:?}", create);
        assert!(debug.contains("run_debug"));
    }
}
