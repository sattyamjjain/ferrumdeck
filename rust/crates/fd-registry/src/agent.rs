//! Agent definitions

use fd_core::{AgentId, AgentVersionId};
use serde::{Deserialize, Serialize};

/// An agent definition
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Agent {
    pub id: AgentId,
    pub name: String,
    pub description: String,
    pub current_version_id: Option<AgentVersionId>,
}

/// A specific version of an agent (immutable)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentVersion {
    pub id: AgentVersionId,
    pub agent_id: AgentId,
    pub version: String,
    pub system_prompt: String,
    pub allowed_tools: Vec<String>,
    pub default_model: String,
    pub config: serde_json::Value,
}
