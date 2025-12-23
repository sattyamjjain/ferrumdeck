//! Workflow entity models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Workflow step type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "workflow_step_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStepType {
    Llm,
    Tool,
    Condition,
    Loop,
    Parallel,
    Approval,
}

/// Workflow status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "workflow_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStatus {
    Draft,
    Active,
    Deprecated,
    Archived,
}

/// Workflow definition entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Workflow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub status: WorkflowStatus,
    pub definition: serde_json::Value,
    pub max_iterations: i32,
    pub on_error: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Create workflow request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflow {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub definition: serde_json::Value,
    pub max_iterations: i32,
    pub on_error: String,
}

/// Update workflow request
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateWorkflow {
    pub name: Option<String>,
    pub description: Option<String>,
    pub status: Option<WorkflowStatus>,
    pub definition: Option<serde_json::Value>,
    pub max_iterations: Option<i32>,
    pub on_error: Option<String>,
}

/// Workflow step definition (stored in JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowStepDef {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub step_type: String,
    #[serde(default)]
    pub config: serde_json::Value,
    #[serde(default)]
    pub depends_on: Vec<String>,
    #[serde(default)]
    pub condition: Option<String>,
    #[serde(default = "default_timeout")]
    pub timeout_ms: i64,
    #[serde(default)]
    pub retry: Option<RetryConfig>,
}

fn default_timeout() -> i64 {
    30000
}

/// Retry configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetryConfig {
    #[serde(default = "default_max_attempts")]
    pub max_attempts: i32,
    #[serde(default = "default_delay_ms")]
    pub delay_ms: i64,
    #[serde(default = "default_backoff_multiplier")]
    pub backoff_multiplier: f64,
}

fn default_max_attempts() -> i32 {
    3
}

fn default_delay_ms() -> i64 {
    1000
}

fn default_backoff_multiplier() -> f64 {
    2.0
}

/// Workflow run instance status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "workflow_run_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum WorkflowRunStatus {
    Created,
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Cancelled,
}

impl WorkflowRunStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            WorkflowRunStatus::Completed
                | WorkflowRunStatus::Failed
                | WorkflowRunStatus::Cancelled
        )
    }
}

/// Workflow run instance
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct WorkflowRun {
    pub id: String,
    pub workflow_id: String,
    pub project_id: String,
    pub status: WorkflowRunStatus,
    pub input: serde_json::Value,
    pub context: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub current_step_id: Option<String>,
    pub step_results: serde_json::Value,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub tool_calls: i32,
    pub cost_cents: i32,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub trace_id: Option<String>,
}

/// Create workflow run request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowRun {
    pub id: String,
    pub workflow_id: String,
    pub project_id: String,
    pub input: serde_json::Value,
    pub trace_id: Option<String>,
}

/// Update workflow run request
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateWorkflowRun {
    pub status: Option<WorkflowRunStatus>,
    pub current_step_id: Option<String>,
    pub step_results: Option<serde_json::Value>,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub tool_calls: Option<i32>,
    pub cost_cents: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Workflow step execution record
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct WorkflowStepExecution {
    pub id: String,
    pub workflow_run_id: String,
    pub step_id: String,
    pub step_type: WorkflowStepType,
    pub status: WorkflowStepExecutionStatus,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub attempt: i32,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub span_id: Option<String>,
}

/// Workflow step execution status
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "workflow_step_execution_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum WorkflowStepExecutionStatus {
    Pending,
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Skipped,
    Retrying,
}

impl WorkflowStepExecutionStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            WorkflowStepExecutionStatus::Completed
                | WorkflowStepExecutionStatus::Failed
                | WorkflowStepExecutionStatus::Skipped
        )
    }
}

/// Create workflow step execution
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateWorkflowStepExecution {
    pub id: String,
    pub workflow_run_id: String,
    pub step_id: String,
    pub step_type: WorkflowStepType,
    pub input: serde_json::Value,
    pub attempt: i32,
    pub span_id: Option<String>,
}

/// Update workflow step execution
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateWorkflowStepExecution {
    pub status: Option<WorkflowStepExecutionStatus>,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}
