//! Policy engine implementation

use crate::budget::{Budget, BudgetUsage};
use crate::decision::PolicyDecision;
use crate::rules::{ToolAllowlist, ToolAllowlistResult};
use tracing::instrument;

/// The policy engine evaluates actions against configured rules
pub struct PolicyEngine {
    tool_allowlist: ToolAllowlist,
    default_budget: Budget,
}

impl PolicyEngine {
    pub fn new(tool_allowlist: ToolAllowlist, default_budget: Budget) -> Self {
        Self {
            tool_allowlist,
            default_budget,
        }
    }

    /// Evaluate whether a tool call is allowed
    #[instrument(skip(self))]
    pub fn evaluate_tool_call(&self, tool_name: &str) -> PolicyDecision {
        match self.tool_allowlist.check(tool_name) {
            ToolAllowlistResult::Allowed => {
                PolicyDecision::allow(format!("tool '{}' is in allowlist", tool_name))
            }
            ToolAllowlistResult::RequiresApproval => PolicyDecision::requires_approval(format!(
                "tool '{}' requires approval before execution",
                tool_name
            )),
            ToolAllowlistResult::Denied => {
                PolicyDecision::deny(format!("tool '{}' is not in allowlist", tool_name))
            }
        }
    }

    /// Check if budget allows continuing
    #[instrument(skip(self))]
    pub fn check_budget(&self, usage: &BudgetUsage, budget: Option<&Budget>) -> PolicyDecision {
        let budget = budget.unwrap_or(&self.default_budget);

        match usage.check_against(budget) {
            Some(exceeded) => PolicyDecision::deny(format!("budget exceeded: {}", exceeded)),
            None => PolicyDecision::allow("within budget limits"),
        }
    }

    /// Get the default budget
    pub fn default_budget(&self) -> &Budget {
        &self.default_budget
    }
}

impl Default for PolicyEngine {
    fn default() -> Self {
        Self {
            tool_allowlist: ToolAllowlist::default(),
            default_budget: Budget::default(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tool_allowlist_deny_by_default() {
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_tool_call("unknown_tool");
        assert!(decision.is_denied());
    }

    #[test]
    fn test_tool_allowlist_allow() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["read_file".to_string()],
            ..Default::default()
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());
        let decision = engine.evaluate_tool_call("read_file");
        assert!(decision.is_allowed());
    }

    #[test]
    fn test_budget_exceeded() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            input_tokens: 200_000, // Over default limit
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_denied());
    }
}
