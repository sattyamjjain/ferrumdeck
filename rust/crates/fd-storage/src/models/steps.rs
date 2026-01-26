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

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // STO-STP-001: StepType enum values
    // ==========================================================================
    #[test]
    fn test_step_type_llm() {
        let step_type = StepType::Llm;
        let json = serde_json::to_string(&step_type).unwrap();
        assert_eq!(json, "\"llm\"");
    }

    #[test]
    fn test_step_type_tool() {
        let step_type = StepType::Tool;
        let json = serde_json::to_string(&step_type).unwrap();
        assert_eq!(json, "\"tool\"");
    }

    #[test]
    fn test_step_type_retrieval() {
        let step_type = StepType::Retrieval;
        let json = serde_json::to_string(&step_type).unwrap();
        assert_eq!(json, "\"retrieval\"");
    }

    #[test]
    fn test_step_type_human() {
        let step_type = StepType::Human;
        let json = serde_json::to_string(&step_type).unwrap();
        assert_eq!(json, "\"human\"");
    }

    #[test]
    fn test_step_type_roundtrip() {
        let types = vec![
            StepType::Llm,
            StepType::Tool,
            StepType::Retrieval,
            StepType::Human,
        ];
        for st in types {
            let json = serde_json::to_string(&st).unwrap();
            let parsed: StepType = serde_json::from_str(&json).unwrap();
            assert_eq!(st, parsed);
        }
    }

    // ==========================================================================
    // STO-STP-002: StepStatus enum values
    // ==========================================================================
    #[test]
    fn test_step_status_pending() {
        let status = StepStatus::Pending;
        assert!(!status.is_terminal());
    }

    #[test]
    fn test_step_status_running() {
        let status = StepStatus::Running;
        assert!(!status.is_terminal());
    }

    #[test]
    fn test_step_status_waiting_approval() {
        let status = StepStatus::WaitingApproval;
        assert!(!status.is_terminal());
    }

    // ==========================================================================
    // STO-STP-003: Terminal step status detection
    // ==========================================================================
    #[test]
    fn test_step_status_completed_is_terminal() {
        assert!(StepStatus::Completed.is_terminal());
    }

    #[test]
    fn test_step_status_failed_is_terminal() {
        assert!(StepStatus::Failed.is_terminal());
    }

    #[test]
    fn test_step_status_skipped_is_terminal() {
        assert!(StepStatus::Skipped.is_terminal());
    }

    // ==========================================================================
    // STO-STP-004: StepStatus serialization
    // ==========================================================================
    #[test]
    fn test_step_status_serialization_snake_case() {
        let status = StepStatus::WaitingApproval;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"waiting_approval\"");
    }

    #[test]
    fn test_step_status_deserialization() {
        let status: StepStatus = serde_json::from_str("\"completed\"").unwrap();
        assert_eq!(status, StepStatus::Completed);
    }

    #[test]
    fn test_step_status_roundtrip() {
        let statuses = vec![
            StepStatus::Pending,
            StepStatus::Running,
            StepStatus::WaitingApproval,
            StepStatus::Completed,
            StepStatus::Failed,
            StepStatus::Skipped,
        ];
        for status in statuses {
            let json = serde_json::to_string(&status).unwrap();
            let parsed: StepStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(status, parsed);
        }
    }

    // ==========================================================================
    // STO-STP-005: CreateStep serialization
    // ==========================================================================
    #[test]
    fn test_create_step_serialization() {
        let create = CreateStep {
            id: "stp_123".to_string(),
            run_id: "run_456".to_string(),
            parent_step_id: None,
            step_number: 1,
            step_type: StepType::Llm,
            input: serde_json::json!({"prompt": "hello"}),
            tool_name: None,
            tool_version: None,
            model: Some("claude-3-opus".to_string()),
            span_id: None,
        };

        let json = serde_json::to_string(&create).unwrap();
        assert!(json.contains("stp_123"));
        assert!(json.contains("llm"));
        assert!(json.contains("claude-3-opus"));
    }

    #[test]
    fn test_create_step_tool_type() {
        let create = CreateStep {
            id: "stp_tool".to_string(),
            run_id: "run_1".to_string(),
            parent_step_id: Some("stp_parent".to_string()),
            step_number: 2,
            step_type: StepType::Tool,
            input: serde_json::json!({"name": "read_file", "args": {"path": "/tmp"}}),
            tool_name: Some("read_file".to_string()),
            tool_version: Some("1.0.0".to_string()),
            model: None,
            span_id: Some("span_abc".to_string()),
        };

        let json = serde_json::to_string(&create).unwrap();
        let parsed: CreateStep = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.tool_name, Some("read_file".to_string()));
        assert_eq!(parsed.parent_step_id, Some("stp_parent".to_string()));
    }

    // ==========================================================================
    // STO-STP-006: UpdateStep defaults
    // ==========================================================================
    #[test]
    fn test_update_step_default() {
        let update = UpdateStep::default();
        assert!(update.status.is_none());
        assert!(update.output.is_none());
        assert!(update.error.is_none());
        assert!(update.input_tokens.is_none());
        assert!(update.output_tokens.is_none());
        assert!(update.started_at.is_none());
        assert!(update.completed_at.is_none());
    }

    #[test]
    fn test_update_step_partial() {
        let update = UpdateStep {
            status: Some(StepStatus::Completed),
            output: Some(serde_json::json!({"result": "success"})),
            ..Default::default()
        };
        assert_eq!(update.status, Some(StepStatus::Completed));
        assert!(update.output.is_some());
        assert!(update.error.is_none());
    }

    // ==========================================================================
    // STO-STP-007: CreateArtifact
    // ==========================================================================
    #[test]
    fn test_create_artifact_serialization() {
        let artifact = CreateArtifact {
            id: "art_123".to_string(),
            step_id: "stp_456".to_string(),
            name: "output.json".to_string(),
            content_type: "application/json".to_string(),
            size_bytes: 1024,
            storage_path: "/artifacts/art_123".to_string(),
            checksum: "sha256:abc123".to_string(),
        };

        let json = serde_json::to_string(&artifact).unwrap();
        let parsed: CreateArtifact = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, "output.json");
        assert_eq!(parsed.size_bytes, 1024);
    }

    // ==========================================================================
    // STO-STP-008: Equality and clone
    // ==========================================================================
    #[test]
    fn test_step_type_equality() {
        assert_eq!(StepType::Llm, StepType::Llm);
        assert_ne!(StepType::Llm, StepType::Tool);
    }

    #[test]
    fn test_step_status_equality() {
        assert_eq!(StepStatus::Running, StepStatus::Running);
        assert_ne!(StepStatus::Running, StepStatus::Completed);
    }

    #[test]
    fn test_step_type_copy() {
        let st = StepType::Tool;
        let copied = st;
        assert_eq!(st, copied);
    }

    #[test]
    fn test_step_status_clone() {
        let status = StepStatus::WaitingApproval;
        let cloned = status.clone();
        assert_eq!(status, cloned);
    }

    // ==========================================================================
    // STO-STP-009: Debug formatting
    // ==========================================================================
    #[test]
    fn test_step_type_debug() {
        let st = StepType::Retrieval;
        let debug = format!("{:?}", st);
        assert_eq!(debug, "Retrieval");
    }

    #[test]
    fn test_step_status_debug() {
        let status = StepStatus::Skipped;
        let debug = format!("{:?}", status);
        assert_eq!(debug, "Skipped");
    }
}
