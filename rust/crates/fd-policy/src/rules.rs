//! Policy rules

use serde::{Deserialize, Serialize};

use crate::precedence::{PolicyVerdict, VerdictKind};

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
    /// Legacy short-circuit check kept for back-compat with existing
    /// callers and tests. Newer code should consult [`Self::matches`] +
    /// [`crate::precedence::resolve_conflicts`] instead so it picks up
    /// the explanation trace.
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

    /// Return every matching verdict for `tool_name`, instead of short-
    /// circuiting on the first hit. Order: denied → approval → allowed.
    /// Empty result means the allowlist saw nothing — the caller is
    /// responsible for the deny-by-default fallback.
    pub fn matches(&self, tool_name: &str) -> Vec<PolicyVerdict> {
        let mut out = Vec::new();
        if self.denied_tools.iter().any(|t| t == tool_name) {
            out.push(PolicyVerdict::new(
                VerdictKind::Deny,
                "allowlist:denied",
                format!("tool '{}' is on the explicit denylist", tool_name),
            ));
        }
        if self.approval_required.iter().any(|t| t == tool_name) {
            out.push(PolicyVerdict::new(
                VerdictKind::RequiresApproval,
                "allowlist:approval",
                format!("tool '{}' requires approval before execution", tool_name),
            ));
        }
        if self.allowed_tools.iter().any(|t| t == tool_name) {
            out.push(PolicyVerdict::new(
                VerdictKind::Allow,
                "allowlist:allowed",
                format!("tool '{}' is in the allowlist", tool_name),
            ));
        }
        out
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
