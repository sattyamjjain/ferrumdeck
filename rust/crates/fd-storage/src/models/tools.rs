//! Tool entity models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Tool status enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "tool_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ToolStatus {
    Active,
    Deprecated,
    Disabled,
}

/// Tool risk level enum
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "tool_risk_level", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ToolRiskLevel {
    Read,
    Write,
    Destructive,
}

/// Default reversibility for a tool — deny-by-default: an unclassified tool is
/// treated as `irreversible` (the most consequential rung). Mirrors
/// `fd_policy::reversibility::Reversibility::default()`.
pub fn default_reversibility() -> String {
    "irreversible".to_string()
}

/// Tool entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Tool {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub mcp_server: String,
    pub status: ToolStatus,
    pub risk_level: ToolRiskLevel,
    /// Reversibility tier (`reversible` | `costly` | `irreversible`) — an
    /// axis orthogonal to `risk_level`, consumed by the policy engine's
    /// graduated-response ladder. Stored as TEXT; parsed by
    /// `fd_policy::reversibility::Reversibility::parse` (unknown → irreversible).
    #[serde(default = "default_reversibility")]
    pub reversibility: String,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Create tool request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateTool {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub mcp_server: String,
    pub risk_level: ToolRiskLevel,
    #[serde(default = "default_reversibility")]
    pub reversibility: String,
}

/// Update tool request
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UpdateTool {
    pub name: Option<String>,
    pub description: Option<String>,
    pub status: Option<ToolStatus>,
    pub risk_level: Option<ToolRiskLevel>,
    pub reversibility: Option<String>,
}

/// Tool version entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ToolVersion {
    pub id: String,
    pub tool_id: String,
    pub version: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>,
    pub changelog: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Create tool version request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateToolVersion {
    pub id: String,
    pub tool_id: String,
    pub version: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>,
    pub changelog: Option<String>,
}

/// Tool with latest version
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolWithVersion {
    #[serde(flatten)]
    pub tool: Tool,
    pub latest_version: Option<ToolVersion>,
}
