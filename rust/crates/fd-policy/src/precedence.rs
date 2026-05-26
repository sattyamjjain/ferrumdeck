//! Explicit policy-conflict resolution.
//!
//! When multiple policies match the same action (e.g. one matches by glob
//! allowlist, another by risk-tier denylist, a third demands approval), a
//! single winning decision must be picked deterministically — never by
//! "whichever rule was evaluated first."
//!
//! This module encodes the project's canonical precedence:
//!
//! ```text
//! Deny  >  RequiresApproval  >  BudgetCap  >  Allow
//! ```
//!
//! …as the pure, named, testable [`precedence_rank`] function plus
//! [`resolve_conflicts`], which folds a bag of [`PolicyVerdict`]s into a
//! single [`ResolvedDecision`] and an audit-grade list of overrides.
//!
//! Deny-by-default behaviour is preserved at the caller: if zero verdicts
//! are produced, the caller must still treat the action as denied. This
//! module never invents an `Allow` out of thin air.
//!
//! See `docs/runbooks/policy-conflict-resolution.md` for operator-facing
//! guidance.

use serde::{Deserialize, Serialize};

/// Kind of verdict a single matching policy can produce.
///
/// Variants are ordered by precedence — `Deny` is the strongest, `Allow` the
/// weakest. The numeric ranks are returned by [`precedence_rank`] (lower
/// number wins). `BudgetCap` is the dedicated tier for budget-driven
/// rejections so operators can distinguish "denied because the allowlist
/// said no" from "denied because the run is over budget".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerdictKind {
    Deny,
    RequiresApproval,
    BudgetCap,
    Allow,
}

impl VerdictKind {
    pub fn as_str(self) -> &'static str {
        match self {
            VerdictKind::Deny => "deny",
            VerdictKind::RequiresApproval => "requires_approval",
            VerdictKind::BudgetCap => "budget_cap",
            VerdictKind::Allow => "allow",
        }
    }
}

/// Precedence rank for a verdict kind. Lower = stronger.
///
/// This is the *only* place in the codebase that names the precedence
/// order. All callers MUST consult it instead of inlining `match`
/// arms — that's the invariant being protected.
#[inline]
pub const fn precedence_rank(kind: VerdictKind) -> u8 {
    match kind {
        VerdictKind::Deny => 0,
        VerdictKind::RequiresApproval => 1,
        VerdictKind::BudgetCap => 2,
        VerdictKind::Allow => 3,
    }
}

/// A single matched policy's verdict on an action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyVerdict {
    /// The verdict's effective kind.
    pub kind: VerdictKind,
    /// Short stable identifier of where the verdict came from — e.g.
    /// `"allowlist:denied"`, `"allowlist:approval"`, `"budget:max_cost_cents"`.
    /// Used by the dashboard to label rows in the trace UI.
    pub source: String,
    /// Operator-readable explanation. Surfaced in audit and SSE.
    pub reason: String,
    /// Optional reference to the originating rule (`pol_*` ID, allowlist
    /// pattern, budget axis). Free-form so non-Postgres rule sources can
    /// also fit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rule_ref: Option<String>,
}

impl PolicyVerdict {
    pub fn new(kind: VerdictKind, source: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            kind,
            source: source.into(),
            reason: reason.into(),
            rule_ref: None,
        }
    }

    pub fn with_rule_ref(mut self, rule_ref: impl Into<String>) -> Self {
        self.rule_ref = Some(rule_ref.into());
        self
    }
}

/// A record of a verdict that lost the precedence comparison.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OverrideRecord {
    /// The verdict that was overridden.
    pub verdict: PolicyVerdict,
    /// The kind that overrode it (= the winning verdict's kind).
    pub overridden_by: VerdictKind,
    /// Why — references the canonical precedence ordering.
    pub reason: String,
}

/// Resolution of a conflicting set of verdicts.
///
/// `winning` is the verdict that survives precedence. `overridden` lists
/// the others in the order they were submitted to [`resolve_conflicts`],
/// each annotated with the precedence reason. `None` for `winning` means
/// the caller passed in zero verdicts — the policy plane saw nothing
/// match, and the deny-by-default fallback at the caller applies.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResolvedDecision {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub winning: Option<PolicyVerdict>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overridden: Vec<OverrideRecord>,
}

impl ResolvedDecision {
    pub fn empty() -> Self {
        Self {
            winning: None,
            overridden: Vec::new(),
        }
    }
}

/// Human-readable summary of the precedence ordering. Surfaced in the
/// trace so dashboards and audit log readers don't need to consult code.
pub const PRECEDENCE_LABEL: &str = "deny > requires_approval > budget_cap > allow";

/// Resolve a bag of matching verdicts into a single decision plus an
/// override list. Pure — same inputs always produce the same outputs.
///
/// Tie-breaking within a precedence tier: the *first* verdict submitted
/// in that tier wins. This makes evaluation order matter only inside a
/// tier (e.g. between two `Deny` rules), not across tiers. Verdicts that
/// lose the tier tie-breaker are still recorded as overridden so the
/// trace is complete.
pub fn resolve_conflicts(verdicts: Vec<PolicyVerdict>) -> ResolvedDecision {
    if verdicts.is_empty() {
        return ResolvedDecision::empty();
    }

    // Find the winner by index so duplicates / equal verdicts don't confuse
    // the override list. Stable: scan once, keep the strongest rank; on a
    // tie, the earlier submission stays.
    let mut winner_idx: usize = 0;
    let mut winner_rank: u8 = precedence_rank(verdicts[0].kind);
    for (idx, verdict) in verdicts.iter().enumerate().skip(1) {
        let rank = precedence_rank(verdict.kind);
        if rank < winner_rank {
            winner_idx = idx;
            winner_rank = rank;
        }
    }

    let mut winning: Option<PolicyVerdict> = None;
    let mut overridden: Vec<OverrideRecord> = Vec::with_capacity(verdicts.len().saturating_sub(1));
    for (idx, verdict) in verdicts.into_iter().enumerate() {
        if idx == winner_idx {
            winning = Some(verdict);
            continue;
        }
        let winner_kind = match winning.as_ref().map(|w| w.kind) {
            Some(k) => k,
            // winner hasn't been popped yet (loser appears before winner in
            // submission order) — derive from the index we recorded above.
            None => {
                // SAFETY: winner_idx was clamped to a valid index above and
                // ranks line up with kinds 1:1.
                match winner_rank {
                    0 => VerdictKind::Deny,
                    1 => VerdictKind::RequiresApproval,
                    2 => VerdictKind::BudgetCap,
                    _ => VerdictKind::Allow,
                }
            }
        };
        overridden.push(OverrideRecord {
            overridden_by: winner_kind,
            reason: override_reason(verdict.kind, winner_kind),
            verdict,
        });
    }

    ResolvedDecision {
        winning,
        overridden,
    }
}

fn override_reason(loser: VerdictKind, winner: VerdictKind) -> String {
    if precedence_rank(loser) == precedence_rank(winner) {
        format!(
            "tied with the winning {} verdict; first-submitted wins ({})",
            winner.as_str(),
            PRECEDENCE_LABEL
        )
    } else {
        format!(
            "overridden by higher-precedence {} verdict ({})",
            winner.as_str(),
            PRECEDENCE_LABEL
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(kind: VerdictKind, src: &str) -> PolicyVerdict {
        PolicyVerdict::new(kind, src, format!("{src} matched"))
    }

    // -------------------------------------------------------------------------
    // precedence_rank
    // -------------------------------------------------------------------------

    #[test]
    fn precedence_rank_orders_deny_highest_allow_lowest() {
        assert!(
            precedence_rank(VerdictKind::Deny) < precedence_rank(VerdictKind::RequiresApproval)
        );
        assert!(
            precedence_rank(VerdictKind::RequiresApproval)
                < precedence_rank(VerdictKind::BudgetCap)
        );
        assert!(precedence_rank(VerdictKind::BudgetCap) < precedence_rank(VerdictKind::Allow));
    }

    #[test]
    fn precedence_label_lists_kinds_in_order() {
        // Cheap regression guard so doc and code don't drift apart.
        assert_eq!(
            PRECEDENCE_LABEL,
            "deny > requires_approval > budget_cap > allow"
        );
    }

    // -------------------------------------------------------------------------
    // resolve_conflicts — empty / single verdict
    // -------------------------------------------------------------------------

    #[test]
    fn empty_verdict_set_returns_empty_resolution() {
        let resolved = resolve_conflicts(vec![]);
        assert!(resolved.winning.is_none());
        assert!(resolved.overridden.is_empty());
    }

    #[test]
    fn single_verdict_wins_with_no_overrides() {
        let resolved = resolve_conflicts(vec![v(VerdictKind::Allow, "allowlist:allowed")]);
        assert_eq!(resolved.winning.as_ref().unwrap().kind, VerdictKind::Allow);
        assert!(resolved.overridden.is_empty());
    }

    // -------------------------------------------------------------------------
    // resolve_conflicts — cross-tier
    // -------------------------------------------------------------------------

    #[test]
    fn deny_beats_allow() {
        let resolved = resolve_conflicts(vec![
            v(VerdictKind::Allow, "allowlist:allowed"),
            v(VerdictKind::Deny, "allowlist:denied"),
        ]);
        assert_eq!(resolved.winning.as_ref().unwrap().kind, VerdictKind::Deny);
        assert_eq!(resolved.overridden.len(), 1);
        assert_eq!(resolved.overridden[0].verdict.kind, VerdictKind::Allow);
        assert_eq!(resolved.overridden[0].overridden_by, VerdictKind::Deny);
        assert!(resolved.overridden[0]
            .reason
            .contains("higher-precedence deny"));
    }

    #[test]
    fn deny_beats_requires_approval() {
        let resolved = resolve_conflicts(vec![
            v(VerdictKind::RequiresApproval, "allowlist:approval"),
            v(VerdictKind::Deny, "allowlist:denied"),
        ]);
        assert_eq!(resolved.winning.as_ref().unwrap().kind, VerdictKind::Deny);
        assert_eq!(resolved.overridden.len(), 1);
        assert_eq!(
            resolved.overridden[0].verdict.kind,
            VerdictKind::RequiresApproval
        );
    }

    #[test]
    fn requires_approval_beats_budget_cap_and_allow() {
        let resolved = resolve_conflicts(vec![
            v(VerdictKind::Allow, "allowlist:allowed"),
            v(VerdictKind::BudgetCap, "budget:max_cost_cents"),
            v(VerdictKind::RequiresApproval, "allowlist:approval"),
        ]);
        assert_eq!(
            resolved.winning.as_ref().unwrap().kind,
            VerdictKind::RequiresApproval
        );
        assert_eq!(resolved.overridden.len(), 2);
        // Overrides retain submission order.
        assert_eq!(resolved.overridden[0].verdict.kind, VerdictKind::Allow);
        assert_eq!(resolved.overridden[1].verdict.kind, VerdictKind::BudgetCap);
    }

    #[test]
    fn budget_cap_beats_allow() {
        let resolved = resolve_conflicts(vec![
            v(VerdictKind::Allow, "allowlist:allowed"),
            v(VerdictKind::BudgetCap, "budget:max_cost_cents"),
        ]);
        assert_eq!(
            resolved.winning.as_ref().unwrap().kind,
            VerdictKind::BudgetCap
        );
        assert_eq!(resolved.overridden.len(), 1);
        assert_eq!(resolved.overridden[0].verdict.kind, VerdictKind::Allow);
    }

    #[test]
    fn deny_wins_even_when_three_kinds_collide() {
        let resolved = resolve_conflicts(vec![
            v(VerdictKind::Allow, "allowlist:allowed"),
            v(VerdictKind::RequiresApproval, "allowlist:approval"),
            v(VerdictKind::Deny, "allowlist:denied"),
        ]);
        let winning = resolved.winning.unwrap();
        assert_eq!(winning.kind, VerdictKind::Deny);
        assert_eq!(winning.source, "allowlist:denied");
        assert_eq!(resolved.overridden.len(), 2);
    }

    // -------------------------------------------------------------------------
    // resolve_conflicts — within-tier tie-breaking
    // -------------------------------------------------------------------------

    #[test]
    fn within_tier_first_submitted_wins_others_recorded() {
        let resolved = resolve_conflicts(vec![
            v(VerdictKind::Deny, "allowlist:denied"),
            v(VerdictKind::Deny, "risk_tier:critical"),
        ]);
        let winning = resolved.winning.unwrap();
        assert_eq!(winning.source, "allowlist:denied");
        assert_eq!(resolved.overridden.len(), 1);
        assert_eq!(resolved.overridden[0].verdict.source, "risk_tier:critical");
        assert!(resolved.overridden[0].reason.contains("tied"));
    }

    // -------------------------------------------------------------------------
    // Determinism
    // -------------------------------------------------------------------------

    #[test]
    fn resolution_is_deterministic_for_same_input() {
        let input = vec![
            v(VerdictKind::Allow, "allowlist:allowed"),
            v(VerdictKind::BudgetCap, "budget:max_cost_cents"),
            v(VerdictKind::Deny, "allowlist:denied"),
            v(VerdictKind::RequiresApproval, "allowlist:approval"),
        ];
        let first = resolve_conflicts(input.clone());
        let second = resolve_conflicts(input);
        assert_eq!(first, second);
    }
}
