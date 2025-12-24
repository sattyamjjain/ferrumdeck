//! Policy rules

use serde::{Deserialize, Serialize};

/// A tool allowlist rule
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ToolAllowlist {
    /// Allowed tool names (exact match)
    pub allowed_tools: Vec<String>,

    /// Tools that require approval before execution
    pub approval_required: Vec<String>,

    /// Tools that are explicitly denied
    pub denied_tools: Vec<String>,
}

impl ToolAllowlist {
    /// Check if a tool is allowed
    pub fn check(&self, tool_name: &str) -> ToolAllowlistResult {
        // Explicit deny takes precedence
        if self.denied_tools.iter().any(|t| t == tool_name) {
            return ToolAllowlistResult::Denied;
        }

        // Check if approval is required
        if self.approval_required.iter().any(|t| t == tool_name) {
            return ToolAllowlistResult::RequiresApproval;
        }

        // Check if explicitly allowed
        if self.allowed_tools.iter().any(|t| t == tool_name) {
            return ToolAllowlistResult::Allowed;
        }

        // Deny by default
        ToolAllowlistResult::Denied
    }
}

/// Result of checking a tool against the allowlist
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToolAllowlistResult {
    Allowed,
    RequiresApproval,
    Denied,
}

/// Risk classification for tools
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[derive(Default)]
pub enum ToolRiskLevel {
    /// Read-only operations
    Low,
    /// Mutations with limited blast radius
    #[default]
    Medium,
    /// External communications, writes to important systems
    High,
    /// Payments, deployments, security-sensitive
    Critical,
}
