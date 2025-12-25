//! Policy engine implementation

use crate::budget::{Budget, BudgetUsage};
use crate::decision::PolicyDecision;
use crate::rules::{ToolAllowlist, ToolAllowlistResult};
use tracing::instrument;

/// The policy engine evaluates actions against configured rules
#[derive(Default)]
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

#[cfg(test)]
mod tests {
    use super::*;

    // =============================================================================
    // Tool Allowlist Tests
    // =============================================================================

    #[test]
    fn test_tool_allowlist_deny_by_default() {
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_tool_call("unknown_tool");
        assert!(decision.is_denied());
        assert!(decision.reason.contains("not in allowlist"));
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
    fn test_tool_allowlist_requires_approval() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec![],
            approval_required: vec!["write_file".to_string()],
            denied_tools: vec![],
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());
        let decision = engine.evaluate_tool_call("write_file");
        assert!(decision.needs_approval());
        assert!(decision.reason.contains("requires approval"));
    }

    #[test]
    fn test_tool_explicit_deny_takes_precedence() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["dangerous_tool".to_string()], // Also in allowed
            approval_required: vec![],
            denied_tools: vec!["dangerous_tool".to_string()], // But explicitly denied
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());
        let decision = engine.evaluate_tool_call("dangerous_tool");
        // Explicit deny should take precedence over allowed
        assert!(decision.is_denied());
    }

    #[test]
    fn test_tool_allowlist_multiple_tools() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec![
                "read_file".to_string(),
                "list_directory".to_string(),
                "get_time".to_string(),
            ],
            approval_required: vec!["write_file".to_string(), "delete_file".to_string()],
            denied_tools: vec!["exec_shell".to_string()],
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());

        // Allowed tools
        assert!(engine.evaluate_tool_call("read_file").is_allowed());
        assert!(engine.evaluate_tool_call("list_directory").is_allowed());
        assert!(engine.evaluate_tool_call("get_time").is_allowed());

        // Approval required
        assert!(engine.evaluate_tool_call("write_file").needs_approval());
        assert!(engine.evaluate_tool_call("delete_file").needs_approval());

        // Denied
        assert!(engine.evaluate_tool_call("exec_shell").is_denied());
        assert!(engine.evaluate_tool_call("unknown").is_denied());
    }

    // =============================================================================
    // Budget Tests
    // =============================================================================

    #[test]
    fn test_budget_exceeded() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            input_tokens: 200_000, // Over default limit of 100_000
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("budget exceeded"));
    }

    #[test]
    fn test_budget_within_limits() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            input_tokens: 50_000,
            output_tokens: 25_000,
            tool_calls: 10,
            wall_time_ms: 60_000,
            cost_cents: 100,
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_allowed());
    }

    #[test]
    fn test_budget_output_tokens_exceeded() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            input_tokens: 10_000,
            output_tokens: 100_000, // Over default limit of 50_000
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("output tokens"));
    }

    #[test]
    fn test_budget_total_tokens_exceeded() {
        // Use a custom budget with only total tokens limit to test specifically
        let budget = Budget {
            max_input_tokens: None,
            max_output_tokens: None,
            max_total_tokens: Some(150_000),
            max_tool_calls: None,
            max_wall_time_ms: None,
            max_cost_cents: None,
        };
        let engine = PolicyEngine::new(ToolAllowlist::default(), budget);
        let usage = BudgetUsage {
            input_tokens: 80_000,
            output_tokens: 80_000, // Total 160,000 > limit of 150,000
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("total tokens"));
    }

    #[test]
    fn test_budget_tool_calls_exceeded() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            tool_calls: 100, // Over default limit of 50
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("tool calls"));
    }

    #[test]
    fn test_budget_wall_time_exceeded() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            wall_time_ms: 10 * 60 * 1000, // 10 minutes > 5 minute limit
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("wall time"));
    }

    #[test]
    fn test_budget_cost_exceeded() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            cost_cents: 1000, // $10 > $5 limit
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("cost"));
    }

    #[test]
    fn test_custom_budget_override() {
        let engine = PolicyEngine::default();

        let usage = BudgetUsage {
            input_tokens: 500_000, // Would exceed default input limit of 100k
            ..Default::default()
        };

        // Custom budget with higher limits for all token-related metrics
        let custom_budget = Budget {
            max_input_tokens: Some(1_000_000),
            max_output_tokens: Some(1_000_000),
            max_total_tokens: Some(2_000_000),
            max_tool_calls: Some(100),
            max_wall_time_ms: Some(10 * 60 * 1000),
            max_cost_cents: Some(1000),
        };

        let decision = engine.check_budget(&usage, Some(&custom_budget));
        assert!(decision.is_allowed()); // Custom budget allows it
    }

    #[test]
    fn test_budget_no_limits() {
        // Create budget with no limits
        let budget = Budget {
            max_input_tokens: None,
            max_output_tokens: None,
            max_total_tokens: None,
            max_tool_calls: None,
            max_wall_time_ms: None,
            max_cost_cents: None,
        };
        let engine = PolicyEngine::new(ToolAllowlist::default(), budget);

        let usage = BudgetUsage {
            input_tokens: 1_000_000,
            output_tokens: 1_000_000,
            tool_calls: 1000,
            wall_time_ms: 1_000_000,
            cost_cents: 100_000,
        };

        let decision = engine.check_budget(&usage, None);
        assert!(decision.is_allowed()); // No limits means always allowed
    }

    // =============================================================================
    // Policy Decision Tests
    // =============================================================================

    #[test]
    fn test_policy_decision_ids_are_unique() {
        let engine = PolicyEngine::default();

        let decision1 = engine.evaluate_tool_call("tool1");
        let decision2 = engine.evaluate_tool_call("tool2");

        assert_ne!(decision1.id, decision2.id);
    }

    #[test]
    fn test_policy_decision_has_meaningful_reason() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["allowed_tool".to_string()],
            approval_required: vec!["approval_tool".to_string()],
            denied_tools: vec![],
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());

        let allow_decision = engine.evaluate_tool_call("allowed_tool");
        assert!(allow_decision.reason.contains("allowed_tool"));

        let approval_decision = engine.evaluate_tool_call("approval_tool");
        assert!(approval_decision.reason.contains("approval_tool"));

        let deny_decision = engine.evaluate_tool_call("unknown_tool");
        assert!(deny_decision.reason.contains("unknown_tool"));
    }

    // =============================================================================
    // Integration Scenarios
    // =============================================================================

    #[test]
    fn test_realistic_agent_policy() {
        // Simulate a realistic agent configuration
        let allowlist = ToolAllowlist {
            allowed_tools: vec![
                "read_file".to_string(),
                "list_directory".to_string(),
                "search_code".to_string(),
                "get_current_time".to_string(),
            ],
            approval_required: vec![
                "write_file".to_string(),
                "create_file".to_string(),
                "execute_command".to_string(),
            ],
            denied_tools: vec![
                "delete_production_data".to_string(),
                "access_secrets".to_string(),
            ],
        };

        let budget = Budget {
            max_input_tokens: Some(50_000),
            max_output_tokens: Some(25_000),
            max_total_tokens: Some(75_000),
            max_tool_calls: Some(20),
            max_wall_time_ms: Some(2 * 60 * 1000), // 2 minutes
            max_cost_cents: Some(100),             // $1
        };

        let engine = PolicyEngine::new(allowlist, budget);

        // Safe read operations should be allowed
        assert!(engine.evaluate_tool_call("read_file").is_allowed());
        assert!(engine.evaluate_tool_call("search_code").is_allowed());

        // Write operations need approval
        assert!(engine.evaluate_tool_call("write_file").needs_approval());

        // Dangerous operations are denied
        assert!(engine
            .evaluate_tool_call("delete_production_data")
            .is_denied());

        // Unknown tools are denied by default
        assert!(engine.evaluate_tool_call("curl").is_denied());

        // Check budget enforcement
        let light_usage = BudgetUsage {
            input_tokens: 10_000,
            output_tokens: 5_000,
            tool_calls: 5,
            wall_time_ms: 30_000,
            cost_cents: 25,
        };
        assert!(engine.check_budget(&light_usage, None).is_allowed());

        let heavy_usage = BudgetUsage {
            input_tokens: 100_000, // Over limit
            output_tokens: 5_000,
            tool_calls: 5,
            wall_time_ms: 30_000,
            cost_cents: 25,
        };
        assert!(engine.check_budget(&heavy_usage, None).is_denied());
    }
}
