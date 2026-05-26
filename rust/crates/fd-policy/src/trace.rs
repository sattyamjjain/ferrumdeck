//! Explanation traces for policy decisions.
//!
//! Every [`PolicyDecision`](crate::decision::PolicyDecision) returned by the
//! engine carries an optional [`DecisionTrace`] so audit consumers and the
//! dashboard can answer "why was this denied / approved" without re-running
//! the engine.
//!
//! The trace is **additive metadata** — existing API contracts continue to
//! work unchanged. Consumers that don't care about explanations can ignore
//! the field; consumers that do care receive the full conflict-resolution
//! record produced by [`crate::precedence::resolve_conflicts`].

use serde::{Deserialize, Serialize};

use crate::precedence::{
    OverrideRecord, PolicyVerdict, ResolvedDecision, VerdictKind, PRECEDENCE_LABEL,
};

/// Audit-grade explanation of how a policy decision was reached.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionTrace {
    /// Every verdict that matched, in the order they were submitted to the
    /// conflict resolver. This preserves what the policy plane *saw*; the
    /// `winning_*` fields say which one survived precedence.
    pub matched: Vec<PolicyVerdict>,

    /// Kind of the winning verdict. `None` only when the policy plane saw
    /// zero matches — i.e. the deny-by-default fallback at the caller is
    /// what's actually denying the action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub winning_kind: Option<VerdictKind>,

    /// Stable source string of the winning verdict. See
    /// [`PolicyVerdict::source`] for the conventions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub winning_source: Option<String>,

    /// Each verdict that lost the precedence comparison, with the reason it
    /// was overridden.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub overrides: Vec<OverrideRecord>,

    /// Human-readable precedence ordering. Frozen at decision time so a
    /// later code change can't make an old audit record lie.
    pub precedence: String,
}

impl DecisionTrace {
    /// Build a trace from the set of matched verdicts and the resolved
    /// decision they produced.
    pub fn from_resolution(matched: Vec<PolicyVerdict>, resolved: &ResolvedDecision) -> Self {
        let (winning_kind, winning_source) = match resolved.winning.as_ref() {
            Some(v) => (Some(v.kind), Some(v.source.clone())),
            None => (None, None),
        };
        Self {
            matched,
            winning_kind,
            winning_source,
            overrides: resolved.overridden.clone(),
            precedence: PRECEDENCE_LABEL.to_string(),
        }
    }

    /// True iff the trace records at least one override — i.e. there was an
    /// actual conflict between matching policies. Useful for dashboards
    /// that want to badge "this decision had conflicts resolved".
    pub fn had_conflicts(&self) -> bool {
        !self.overrides.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::precedence::{resolve_conflicts, PolicyVerdict, VerdictKind};

    fn v(kind: VerdictKind, src: &str) -> PolicyVerdict {
        PolicyVerdict::new(kind, src, format!("{src} matched"))
    }

    #[test]
    fn trace_records_winner_source_and_overrides_in_submission_order() {
        let matched = vec![
            v(VerdictKind::Allow, "allowlist:allowed"),
            v(VerdictKind::Deny, "risk_tier:critical"),
            v(VerdictKind::RequiresApproval, "allowlist:approval"),
        ];
        let resolved = resolve_conflicts(matched.clone());
        let trace = DecisionTrace::from_resolution(matched, &resolved);

        assert_eq!(trace.winning_kind, Some(VerdictKind::Deny));
        assert_eq!(trace.winning_source.as_deref(), Some("risk_tier:critical"));
        assert_eq!(trace.overrides.len(), 2);
        // Overrides retain submission order (Allow first, then Approval).
        assert_eq!(trace.overrides[0].verdict.kind, VerdictKind::Allow);
        assert_eq!(
            trace.overrides[1].verdict.kind,
            VerdictKind::RequiresApproval
        );
        assert!(trace.had_conflicts());
        assert_eq!(trace.precedence, PRECEDENCE_LABEL);
    }

    #[test]
    fn trace_with_single_match_reports_no_conflicts() {
        let matched = vec![v(VerdictKind::Allow, "allowlist:allowed")];
        let resolved = resolve_conflicts(matched.clone());
        let trace = DecisionTrace::from_resolution(matched, &resolved);

        assert_eq!(trace.winning_kind, Some(VerdictKind::Allow));
        assert!(trace.overrides.is_empty());
        assert!(!trace.had_conflicts());
    }

    #[test]
    fn trace_with_no_matches_records_default_deny_signal() {
        let matched: Vec<PolicyVerdict> = vec![];
        let resolved = resolve_conflicts(matched.clone());
        let trace = DecisionTrace::from_resolution(matched, &resolved);

        assert!(trace.winning_kind.is_none());
        assert!(trace.winning_source.is_none());
        assert!(trace.overrides.is_empty());
        assert!(!trace.had_conflicts());
    }

    #[test]
    fn trace_serializes_with_only_set_fields() {
        // No-matches case should serialize as a small object — no `null`s
        // for the optional fields.
        let trace = DecisionTrace::from_resolution(vec![], &resolve_conflicts(vec![]));
        let json = serde_json::to_string(&trace).unwrap();
        assert!(json.contains("\"matched\""));
        assert!(json.contains("\"precedence\""));
        assert!(!json.contains("\"winning_kind\""));
        assert!(!json.contains("\"winning_source\""));
        assert!(!json.contains("\"overrides\""));
    }
}
