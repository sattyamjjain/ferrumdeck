//! Policy engine implementation

use crate::bench_audit::{BenchAuditPolicy, BenchGatedClaim, BenchTrustSummary};
use crate::budget::{Budget, BudgetUsage};
use crate::decision::PolicyDecision;
use crate::precedence::{resolve_conflicts, PolicyVerdict, VerdictKind};
use crate::rules::ToolAllowlist;
use crate::trace::DecisionTrace;
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

    /// Evaluate whether a tool call is allowed.
    ///
    /// Now gathers *every* matching verdict from the allowlist and runs
    /// them through [`crate::precedence::resolve_conflicts`], so two
    /// disagreeing policies produce a deterministic winner plus a full
    /// explanation trace surfaced on [`PolicyDecision::trace`]. Behaviour
    /// matches the legacy short-circuit (`Deny > RequiresApproval >
    /// Allow > default-deny`) — back-compat is covered by existing tests.
    #[instrument(skip(self))]
    pub fn evaluate_tool_call(&self, tool_name: &str) -> PolicyDecision {
        let matched = self.tool_allowlist.matches(tool_name);
        let resolved = resolve_conflicts(matched.clone());
        let trace = DecisionTrace::from_resolution(matched, &resolved);

        let decision = match resolved.winning.as_ref().map(|v| v.kind) {
            Some(VerdictKind::Deny) => {
                let reason = resolved
                    .winning
                    .as_ref()
                    .map(|v| v.reason.clone())
                    .unwrap_or_else(|| format!("tool '{}' is denied", tool_name));
                PolicyDecision::deny(reason)
            }
            Some(VerdictKind::RequiresApproval) => {
                let reason = resolved
                    .winning
                    .as_ref()
                    .map(|v| v.reason.clone())
                    .unwrap_or_else(|| format!("tool '{}' requires approval", tool_name));
                PolicyDecision::requires_approval(reason)
            }
            Some(VerdictKind::Allow) => {
                let reason = resolved
                    .winning
                    .as_ref()
                    .map(|v| v.reason.clone())
                    .unwrap_or_else(|| format!("tool '{}' is in allowlist", tool_name));
                PolicyDecision::allow(reason)
            }
            // BudgetCap should never be a winner from allowlist matching —
            // the budget plane is checked via `check_budget`. Treat it as
            // a deny if it ever appears here (defence-in-depth).
            Some(VerdictKind::BudgetCap) => {
                PolicyDecision::deny(format!("tool '{}' blocked by budget cap", tool_name))
            }
            // No matches at all → deny-by-default. The trace still records
            // the empty match set so audit can prove the allowlist saw
            // nothing for this tool.
            None => PolicyDecision::deny(format!("tool '{}' is not in allowlist", tool_name)),
        };

        decision.with_trace(trace)
    }

    /// Check if budget allows continuing. The returned decision carries a
    /// trace whose single matched verdict (if any) is the offending
    /// budget axis.
    #[instrument(skip(self))]
    pub fn check_budget(&self, usage: &BudgetUsage, budget: Option<&Budget>) -> PolicyDecision {
        let budget = budget.unwrap_or(&self.default_budget);

        let (decision, matched) = match usage.check_against(budget) {
            Some(exceeded) => {
                let verdict = PolicyVerdict::new(
                    VerdictKind::BudgetCap,
                    format!("budget:{}", budget_axis(&exceeded)),
                    format!("budget exceeded: {}", exceeded),
                );
                let matched = vec![verdict];
                (
                    PolicyDecision::deny(format!("budget exceeded: {}", exceeded)),
                    matched,
                )
            }
            None => (PolicyDecision::allow("within budget limits"), Vec::new()),
        };

        let resolved = resolve_conflicts(matched.clone());
        let trace = DecisionTrace::from_resolution(matched, &resolved);
        decision.with_trace(trace)
    }

    /// Get the default budget
    pub fn default_budget(&self) -> &Budget {
        &self.default_budget
    }

    /// Evaluate a routing / model-swap decision that cites an external
    /// benchmark delta. Reuses [`resolve_conflicts`] so the bench-audit gate
    /// shares precedence semantics with the allowlist + budget tiers — this
    /// is a new *rule source*, not a parallel engine. Deny-by-default still
    /// applies: if the [`BenchAuditPolicy`] emits no verdicts (no signal
    /// from the eval plane), the decision is denied with an empty trace.
    #[instrument(skip(self, policy, claim, summary))]
    pub fn evaluate_bench_gated_decision(
        &self,
        policy: &BenchAuditPolicy,
        claim: &BenchGatedClaim,
        summary: &BenchTrustSummary,
    ) -> PolicyDecision {
        let matched = policy.evaluate(claim, summary);
        let resolved = resolve_conflicts(matched.clone());
        let trace = DecisionTrace::from_resolution(matched, &resolved);

        let decision = match resolved.winning.as_ref().map(|v| v.kind) {
            Some(VerdictKind::Deny) => PolicyDecision::deny(
                resolved
                    .winning
                    .as_ref()
                    .map(|v| v.reason.clone())
                    .unwrap_or_else(|| {
                        format!("bench-audit gate denied decision '{}'", claim.decision_id)
                    }),
            ),
            Some(VerdictKind::RequiresApproval) => PolicyDecision::requires_approval(
                resolved
                    .winning
                    .as_ref()
                    .map(|v| v.reason.clone())
                    .unwrap_or_else(|| {
                        format!(
                            "bench-audit gate requires approval for decision '{}'",
                            claim.decision_id
                        )
                    }),
            ),
            Some(VerdictKind::Allow) => PolicyDecision::allow(
                resolved
                    .winning
                    .as_ref()
                    .map(|v| v.reason.clone())
                    .unwrap_or_else(|| {
                        format!("bench-audit gate allowed decision '{}'", claim.decision_id)
                    }),
            ),
            // `BudgetCap` is a budget-plane signal — it should never come out
            // of the bench-audit policy. Defence-in-depth: treat as deny.
            Some(VerdictKind::BudgetCap) => PolicyDecision::deny(format!(
                "decision '{}' rejected by spurious budget verdict from bench-audit plane",
                claim.decision_id
            )),
            // No matches → deny-by-default. The trace still records the empty
            // match set so audit can prove the policy plane saw nothing.
            None => PolicyDecision::deny(format!(
                "bench-audit plane returned no signal for decision '{}' — denying by default",
                claim.decision_id
            )),
        };

        decision.with_trace(trace)
    }
}

/// Stable axis label for a [`BudgetExceeded`](crate::budget::BudgetExceeded)
/// — used as the `budget:<axis>` source string on the trace.
fn budget_axis(exceeded: &crate::budget::BudgetExceeded) -> &'static str {
    use crate::budget::BudgetExceeded;
    match exceeded {
        BudgetExceeded::InputTokens { .. } => "max_input_tokens",
        BudgetExceeded::OutputTokens { .. } => "max_output_tokens",
        BudgetExceeded::TotalTokens { .. } => "max_total_tokens",
        BudgetExceeded::ToolCalls { .. } => "max_tool_calls",
        BudgetExceeded::WallTime { .. } => "max_wall_time_ms",
        BudgetExceeded::Cost { .. } => "max_cost_cents",
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

    // =============================================================================
    // Conflict-resolution + trace integration tests
    // =============================================================================

    #[test]
    fn conflict_deny_overrides_allow_records_trace() {
        // Tool is on BOTH the allow- and deny-lists. Deny must win, and
        // the trace must record the Allow as overridden.
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["dangerous_tool".into()],
            approval_required: vec![],
            denied_tools: vec!["dangerous_tool".into()],
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());
        let decision = engine.evaluate_tool_call("dangerous_tool");

        assert!(decision.is_denied());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.matched.len(), 2);
        assert_eq!(trace.winning_kind, Some(VerdictKind::Deny));
        assert_eq!(trace.winning_source.as_deref(), Some("allowlist:denied"));
        assert_eq!(trace.overrides.len(), 1);
        assert_eq!(trace.overrides[0].verdict.kind, VerdictKind::Allow);
        assert!(trace.overrides[0].reason.contains("higher-precedence deny"));
    }

    #[test]
    fn conflict_approval_overrides_allow_records_trace() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["write_file".into()],
            approval_required: vec!["write_file".into()],
            denied_tools: vec![],
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());
        let decision = engine.evaluate_tool_call("write_file");

        assert!(decision.needs_approval());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.winning_kind, Some(VerdictKind::RequiresApproval));
        assert_eq!(trace.overrides.len(), 1);
        assert_eq!(trace.overrides[0].verdict.kind, VerdictKind::Allow);
    }

    #[test]
    fn conflict_three_way_deny_wins_and_records_two_overrides() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["multi_tool".into()],
            approval_required: vec!["multi_tool".into()],
            denied_tools: vec!["multi_tool".into()],
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());
        let decision = engine.evaluate_tool_call("multi_tool");

        assert!(decision.is_denied());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.matched.len(), 3);
        assert_eq!(trace.winning_kind, Some(VerdictKind::Deny));
        assert_eq!(trace.overrides.len(), 2);
        // Overrides in submission order: approval then allow.
        assert_eq!(
            trace.overrides[0].verdict.kind,
            VerdictKind::RequiresApproval
        );
        assert_eq!(trace.overrides[1].verdict.kind, VerdictKind::Allow);
        assert!(trace.had_conflicts());
    }

    #[test]
    fn no_conflict_allow_only_records_clean_trace() {
        let allowlist = ToolAllowlist {
            allowed_tools: vec!["read_file".into()],
            approval_required: vec![],
            denied_tools: vec![],
        };
        let engine = PolicyEngine::new(allowlist, Budget::default());
        let decision = engine.evaluate_tool_call("read_file");

        assert!(decision.is_allowed());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.matched.len(), 1);
        assert_eq!(trace.winning_kind, Some(VerdictKind::Allow));
        assert!(trace.overrides.is_empty());
        assert!(!trace.had_conflicts());
    }

    #[test]
    fn default_deny_records_empty_matched_set() {
        // Tool not on any list — deny by default, trace records the empty
        // match set so audit can prove the allowlist saw nothing.
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_tool_call("unknown_tool");

        assert!(decision.is_denied());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert!(trace.matched.is_empty());
        assert!(trace.winning_kind.is_none());
        assert!(trace.overrides.is_empty());
    }

    #[test]
    fn budget_check_attaches_budget_cap_verdict_in_trace() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage {
            cost_cents: 10_000, // way over default $5 limit
            ..Default::default()
        };
        let decision = engine.check_budget(&usage, None);

        assert!(decision.is_denied());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.matched.len(), 1);
        assert_eq!(trace.matched[0].kind, VerdictKind::BudgetCap);
        assert_eq!(trace.matched[0].source, "budget:max_cost_cents");
        assert_eq!(trace.winning_kind, Some(VerdictKind::BudgetCap));
    }

    #[test]
    fn budget_within_limits_records_empty_trace() {
        let engine = PolicyEngine::default();
        let usage = BudgetUsage::default();
        let decision = engine.check_budget(&usage, None);

        assert!(decision.is_allowed());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert!(trace.matched.is_empty());
        assert!(trace.winning_kind.is_none());
    }

    // =============================================================================
    // Bench-audit gate (arXiv:2605.26079) — wires the new policy through the
    // existing precedence resolver + decision trace, not a parallel engine.
    // =============================================================================

    use crate::bench_audit::{BenchAuditPolicy, BenchGatedClaim, BenchTrustSummary};
    use chrono::DateTime;

    fn audit_summary(score: f64, flagged: u32, total: u32) -> BenchTrustSummary {
        BenchTrustSummary {
            suite_id: "smoke".into(),
            bench_trust_score: score,
            total_tasks: total,
            flagged_task_count: flagged,
            audited_at: DateTime::from_timestamp(1_700_000_000, 0).expect("ts"),
            anchor: crate::bench_audit::BENCH_AUDIT_ANCHOR.into(),
        }
    }

    fn audit_claim(delta: f64) -> BenchGatedClaim {
        BenchGatedClaim {
            decision_id: "dec_routing".into(),
            suite_id: "smoke".into(),
            delta_score: delta,
        }
    }

    #[test]
    fn bench_gate_clean_suite_allows_and_records_trace() {
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_bench_gated_decision(
            &BenchAuditPolicy::default(),
            &audit_claim(0.05),
            &audit_summary(0.92, 0, 20),
        );

        assert!(
            decision.is_allowed(),
            "clean suite + clear delta must allow"
        );
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.winning_kind, Some(VerdictKind::Allow));
        assert_eq!(
            trace.winning_source.as_deref(),
            Some("bench_audit:high_trust_score"),
        );
    }

    #[test]
    fn bench_gate_low_trust_denies_with_trace_source() {
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_bench_gated_decision(
            &BenchAuditPolicy::default(),
            &audit_claim(0.20),
            &audit_summary(0.40, 12, 20),
        );

        assert!(decision.is_denied());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.winning_kind, Some(VerdictKind::Deny));
        let source = trace.winning_source.as_deref().unwrap_or("");
        assert!(
            source == "bench_audit:low_trust_score"
                || source == "bench_audit:within_flagged_margin",
            "expected a bench_audit:* deny source, got {source:?}"
        );
    }

    #[test]
    fn bench_gate_within_flagged_margin_records_override() {
        // 5/20 flagged → 0.25 margin. A 0.10 delta sits inside it even though
        // the suite is otherwise clean. Engine must still deny *and* record
        // that there was a conflict in the trace (the high-trust Allow gets
        // overridden by the within-margin Deny).
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_bench_gated_decision(
            &BenchAuditPolicy::default(),
            &audit_claim(0.10),
            &audit_summary(0.92, 5, 20),
        );

        assert!(decision.is_denied());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(
            trace.winning_source.as_deref(),
            Some("bench_audit:within_flagged_margin"),
        );
        // The Allow verdict must be recorded as overridden, not silently
        // dropped — that's the contract DecisionTrace owes audit consumers.
        assert!(
            trace
                .overrides
                .iter()
                .any(|o| o.verdict.source == "bench_audit:high_trust_score"
                    && o.overridden_by == VerdictKind::Deny),
            "expected high_trust_score Allow to be recorded as overridden: {trace:?}",
        );
    }

    #[test]
    fn bench_gate_mid_band_requires_approval() {
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_bench_gated_decision(
            &BenchAuditPolicy::default(),
            &audit_claim(0.10),
            &audit_summary(0.75, 0, 20),
        );

        assert!(decision.needs_approval());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.winning_kind, Some(VerdictKind::RequiresApproval));
        assert_eq!(
            trace.winning_source.as_deref(),
            Some("bench_audit:hitl_band"),
        );
    }

    #[test]
    fn bench_gate_suite_mismatch_denies() {
        let engine = PolicyEngine::default();
        let mismatched = BenchGatedClaim {
            decision_id: "dec_001".into(),
            suite_id: "regression".into(),
            delta_score: 0.30,
        };
        let decision = engine.evaluate_bench_gated_decision(
            &BenchAuditPolicy::default(),
            &mismatched,
            &audit_summary(0.92, 0, 20),
        );

        assert!(decision.is_denied());
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(
            trace.winning_source.as_deref(),
            Some("bench_audit:suite_mismatch"),
        );
    }

    #[test]
    fn trace_precedence_label_matches_canonical_string() {
        let engine = PolicyEngine::default();
        let decision = engine.evaluate_tool_call("anything");
        let trace = decision.trace.as_ref().expect("trace populated");
        assert_eq!(trace.precedence, crate::precedence::PRECEDENCE_LABEL);
    }

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
