//! Tool definitions

use fd_core::{ToolId, ToolVersionId};
use serde::{Deserialize, Serialize};

/// A tool definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tool {
    pub id: ToolId,
    pub name: String,
    pub description: String,
    pub risk_level: ToolRiskLevel,
    pub current_version_id: Option<ToolVersionId>,
}

/// A specific version of a tool (immutable)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolVersion {
    pub id: ToolVersionId,
    pub tool_id: ToolId,
    pub version: String,
    pub input_schema: serde_json::Value,
    pub output_schema: serde_json::Value,
    pub mcp_server: Option<String>,
    pub config: serde_json::Value,
}

/// Risk classification for tools
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolRiskLevel {
    /// Read-only operations
    Low,
    /// Mutations with limited blast radius
    Medium,
    /// External communications, writes to important systems
    High,
    /// Payments, deployments, security-sensitive
    Critical,
}

impl Default for ToolRiskLevel {
    fn default() -> Self {
        Self::Medium
    }
}
