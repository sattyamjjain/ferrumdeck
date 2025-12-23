//! Step entity models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Step type enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "step_type", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum StepType {
    Llm,
    Tool,
    Retrieval,
    Human,
}

/// Step status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "step_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    WaitingApproval,
    Completed,
    Failed,
    Skipped,
}

impl StepStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            StepStatus::Completed | StepStatus::Failed | StepStatus::Skipped
        )
    }
}

/// Step entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Step {
    pub id: String,
    pub run_id: String,
    pub parent_step_id: Option<String>,
    pub step_number: i32,
    pub step_type: StepType,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub tool_name: Option<String>,
    pub tool_version: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub status: StepStatus,
    pub error: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub span_id: Option<String>,
}

/// Create step request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateStep {
    pub id: String,
    pub run_id: String,
    pub parent_step_id: Option<String>,
    pub step_number: i32,
    pub step_type: StepType,
    pub input: serde_json::Value,
    pub tool_name: Option<String>,
    pub tool_version: Option<String>,
    pub model: Option<String>,
    pub span_id: Option<String>,
}

/// Update step request
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateStep {
    pub status: Option<StepStatus>,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Step artifact
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct StepArtifact {
    pub id: String,
    pub step_id: String,
    pub name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub storage_path: String,
    pub checksum: String,
    pub created_at: DateTime<Utc>,
}

/// Create artifact request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateArtifact {
    pub id: String,
    pub step_id: String,
    pub name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub storage_path: String,
    pub checksum: String,
}
