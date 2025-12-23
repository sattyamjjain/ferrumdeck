//! Agent entity models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Agent status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "agent_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Draft,
    Active,
    Deprecated,
    Archived,
}

/// Agent entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Agent {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub status: AgentStatus,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Create agent request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgent {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
}

/// Update agent request
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateAgent {
    pub name: Option<String>,
    pub description: Option<String>,
    pub status: Option<AgentStatus>,
}

/// Agent version entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct AgentVersion {
    pub id: String,
    pub agent_id: String,
    pub version: String,
    pub system_prompt: String,
    pub model: String,
    pub model_params: serde_json::Value,
    pub allowed_tools: Vec<String>,
    pub tool_configs: serde_json::Value,
    pub max_tokens: Option<i32>,
    pub max_tool_calls: Option<i32>,
    pub max_wall_time_secs: Option<i32>,
    pub max_cost_cents: Option<i32>,
    pub changelog: Option<String>,
    pub created_at: DateTime<Utc>,
    pub created_by: Option<String>,
}

/// Create agent version request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgentVersion {
    pub id: String,
    pub agent_id: String,
    pub version: String,
    pub system_prompt: String,
    pub model: String,
    pub model_params: serde_json::Value,
    pub allowed_tools: Vec<String>,
    pub tool_configs: serde_json::Value,
    pub max_tokens: Option<i32>,
    pub max_tool_calls: Option<i32>,
    pub max_wall_time_secs: Option<i32>,
    pub max_cost_cents: Option<i32>,
    pub changelog: Option<String>,
    pub created_by: Option<String>,
}

/// Agent with latest version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentWithVersion {
    #[serde(flatten)]
    pub agent: Agent,
    pub latest_version: Option<AgentVersion>,
}
