//! Benchmark-audit policy gate.
//!
//! Before an external benchmark delta is allowed to gate a routing /
//! model-swap decision, the eval plane produces a
//! [`BenchTrustSummary`](crate::bench_audit::BenchTrustSummary) — the
//! `bench_trust_score` and the list of flagged task ids derived from the ABA
//! hygiene audit ([arXiv:2605.26079](https://arxiv.org/abs/2605.26079)). This
//! module turns that summary into [`PolicyVerdict`]s that flow through the
//! existing [`crate::precedence::resolve_conflicts`] resolver — so this is a
//! new *rule source*, not a parallel engine. The deny-by-default invariant
//! is preserved at the caller.
//!
//! Verdict sources emitted here:
//! - `bench_audit:low_trust_score` — trust below `min_trust_score`. Deny.
//! - `bench_audit:hitl_band`       — trust in the HITL band. RequiresApproval.
//! - `bench_audit:within_flagged_margin` — the cited delta is within the
//!   noise margin implied by the flagged-task ratio. Deny.
//! - `bench_audit:high_trust_score` — trust at or above `allow_above` and the
//!   delta is outside the flagged margin. Allow.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::precedence::{PolicyVerdict, VerdictKind};

/// Stable arXiv anchor for the audit methodology. Surfaced on the wire so
/// audit consumers can cite the paper without re-reading docstrings.
pub const BENCH_AUDIT_ANCHOR: &str = "arXiv:2605.26079";

/// Summary of a bench audit produced by the Python eval plane.
///
/// Field semantics mirror `fd_evals.bench_audit.BenchAuditReport` — only the
/// subset the Rust policy plane needs to decide is included here. The full
/// per-task flag list lives in the eval-plane report; this struct intentionally
/// stays narrow so it can be denormalised onto a `runs` / `eval_runs` column
/// without bloating the row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenchTrustSummary {
    /// Identifier of the eval suite that was audited.
    pub suite_id: String,
    /// Aggregate hygiene score in `[0.0, 1.0]`. Higher = more trustworthy.
    pub bench_trust_score: f64,
    /// Total tasks the auditor scanned in the suite.
    pub total_tasks: u32,
    /// Number of distinct tasks with at least one hygiene flag.
    pub flagged_task_count: u32,
    /// When the audit was produced.
    pub audited_at: DateTime<Utc>,
    /// arXiv anchor of the audit methodology (defaults to
    /// [`BENCH_AUDIT_ANCHOR`]).
    #[serde(default = "default_anchor")]
    pub anchor: String,
}

fn default_anchor() -> String {
    BENCH_AUDIT_ANCHOR.to_string()
}

impl BenchTrustSummary {
    /// Share of suite tasks with at least one hygiene flag. The policy plane
    /// uses this as the noise margin around a benchmark delta — if the cited
    /// improvement is within `flagged_task_ratio`, it's not distinguishable
    /// from grading noise and the gate must deny.
    pub fn flagged_task_ratio(&self) -> f64 {
        if self.total_tasks == 0 {
            return 0.0;
        }
        f64::from(self.flagged_task_count) / f64::from(self.total_tasks)
    }
}

/// A routing / model-swap claim that cites an external benchmark delta. The
/// policy plane compares this against the [`BenchTrustSummary`] for the suite
/// the delta came from.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenchGatedClaim {
    /// Stable id of the routing decision the operator wants to take —
    /// surfaces in the audit trail.
    pub decision_id: String,
    /// Eval suite the delta is sourced from. Must match
    /// [`BenchTrustSummary::suite_id`] or this gate will deny on mismatch.
    pub suite_id: String,
    /// Score delta the operator is using to justify the routing change. In
    /// the same `[0, 1]` units as `bench_trust_score`.
    pub delta_score: f64,
}

/// Configuration for [`BenchAuditPolicy::evaluate`].
///
/// Defaults are deliberately conservative: a clean suite (`bench_trust_score >=
/// 0.85`) backed by a delta larger than the flagged-task noise floor will
/// produce an `Allow` verdict; otherwise the gate denies or asks for HITL.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BenchAuditPolicy {
    /// Trust below this is an unconditional deny.
    pub min_trust_score: f64,
    /// Trust at or above this — and a delta outside the flagged margin — is
    /// the only path to an explicit Allow.
    pub allow_above: f64,
    /// Multiplicative slack applied to the flagged-task ratio when computing
    /// the noise margin. `delta_score <= flagged_task_ratio * margin_slack`
    /// denies as "within flagged margin". `1.0` means use the ratio as-is.
    pub margin_slack: f64,
}

impl Default for BenchAuditPolicy {
    fn default() -> Self {
        Self {
            min_trust_score: 0.70,
            allow_above: 0.85,
            margin_slack: 1.0,
        }
    }
}

impl BenchAuditPolicy {
    /// Evaluate a single bench-gated claim against the audit summary.
    ///
    /// Returns a bag of [`PolicyVerdict`]s ready to be fed into
    /// [`crate::precedence::resolve_conflicts`]. The caller wires the
    /// resolution into a [`crate::decision::PolicyDecision`] with the standard
    /// [`crate::trace::DecisionTrace`] — see
    /// [`crate::engine::PolicyEngine::evaluate_bench_gated_decision`].
    ///
    /// An empty result vector means "the audit plane has nothing to say" —
    /// the caller's deny-by-default fallback is what then applies.
    pub fn evaluate(
        &self,
        claim: &BenchGatedClaim,
        summary: &BenchTrustSummary,
    ) -> Vec<PolicyVerdict> {
        let mut verdicts = Vec::new();

        if claim.suite_id != summary.suite_id {
            verdicts.push(PolicyVerdict::new(
                VerdictKind::Deny,
                "bench_audit:suite_mismatch",
                format!(
                    "claim references suite '{}' but audit summary is for '{}'",
                    claim.suite_id, summary.suite_id
                ),
            ));
            return verdicts;
        }

        if summary.bench_trust_score < self.min_trust_score {
            verdicts.push(PolicyVerdict::new(
                VerdictKind::Deny,
                "bench_audit:low_trust_score",
                format!(
                    "bench_trust_score {:.4} below min_trust_score {:.4} ({})",
                    summary.bench_trust_score, self.min_trust_score, summary.anchor
                ),
            ));
        }

        // HITL band: between min_trust_score and allow_above. Operators get a
        // RequiresApproval rather than an Allow so a borderline suite can
        // still drive a routing change with explicit human sign-off.
        if summary.bench_trust_score >= self.min_trust_score
            && summary.bench_trust_score < self.allow_above
        {
            verdicts.push(PolicyVerdict::new(
                VerdictKind::RequiresApproval,
                "bench_audit:hitl_band",
                format!(
                    "bench_trust_score {:.4} in HITL band [{:.4}, {:.4}); routing requires approval",
                    summary.bench_trust_score, self.min_trust_score, self.allow_above
                ),
            ));
        }

        // Even a trusted suite can't justify a routing change whose claimed
        // delta is inside the flagged-task noise floor. We deny that case
        // explicitly so the trace records *why* — operators see
        // `bench_audit:within_flagged_margin` instead of a vague deny.
        let margin = summary.flagged_task_ratio() * self.margin_slack;
        if claim.delta_score.abs() <= margin && summary.flagged_task_count > 0 {
            verdicts.push(PolicyVerdict::new(
                VerdictKind::Deny,
                "bench_audit:within_flagged_margin",
                format!(
                    "delta {:+.4} within flagged-task margin {:.4} ({} flagged / {} total)",
                    claim.delta_score, margin, summary.flagged_task_count, summary.total_tasks
                ),
            ));
        }

        // Explicit Allow verdict — emitted whenever the suite passes the
        // `allow_above` bar, regardless of the margin check. We deliberately
        // record both verdicts so the [`crate::trace::DecisionTrace`] shows
        // the high-trust Allow as overridden by the margin Deny when both
        // fire. Operators reading the audit log see "the suite was clean BUT
        // the delta was inside the noise floor" rather than just a bare deny.
        if summary.bench_trust_score >= self.allow_above {
            verdicts.push(PolicyVerdict::new(
                VerdictKind::Allow,
                "bench_audit:high_trust_score",
                format!(
                    "bench_trust_score {:.4} ≥ allow_above {:.4} (delta {:+.4}, margin {:.4})",
                    summary.bench_trust_score, self.allow_above, claim.delta_score, margin
                ),
            ));
        }

        verdicts
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::precedence::resolve_conflicts;

    fn ts(secs: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(secs, 0).expect("valid timestamp")
    }

    fn clean_summary() -> BenchTrustSummary {
        BenchTrustSummary {
            suite_id: "smoke".into(),
            bench_trust_score: 0.92,
            total_tasks: 20,
            flagged_task_count: 0,
            audited_at: ts(1_700_000_000),
            anchor: BENCH_AUDIT_ANCHOR.into(),
        }
    }

    fn dirty_summary() -> BenchTrustSummary {
        BenchTrustSummary {
            suite_id: "smoke".into(),
            bench_trust_score: 0.40,
            total_tasks: 20,
            flagged_task_count: 12,
            audited_at: ts(1_700_000_000),
            anchor: BENCH_AUDIT_ANCHOR.into(),
        }
    }

    fn claim(delta: f64) -> BenchGatedClaim {
        BenchGatedClaim {
            decision_id: "dec_001".into(),
            suite_id: "smoke".into(),
            delta_score: delta,
        }
    }

    #[test]
    fn clean_suite_with_strong_delta_emits_allow_only() {
        let policy = BenchAuditPolicy::default();
        let verdicts = policy.evaluate(&claim(0.05), &clean_summary());

        assert_eq!(verdicts.len(), 1);
        assert_eq!(verdicts[0].kind, VerdictKind::Allow);
        assert_eq!(verdicts[0].source, "bench_audit:high_trust_score");
    }

    #[test]
    fn low_trust_emits_low_trust_score_deny() {
        let policy = BenchAuditPolicy::default();
        let verdicts = policy.evaluate(&claim(0.20), &dirty_summary());

        // Low-trust deny + within-margin deny + (no Allow because trust is low).
        let kinds: Vec<VerdictKind> = verdicts.iter().map(|v| v.kind).collect();
        assert!(kinds.contains(&VerdictKind::Deny));
        assert!(
            verdicts
                .iter()
                .any(|v| v.source == "bench_audit:low_trust_score"),
            "expected a bench_audit:low_trust_score verdict, got {verdicts:?}"
        );
        let resolved = resolve_conflicts(verdicts);
        assert_eq!(
            resolved.winning.expect("verdict survives precedence").kind,
            VerdictKind::Deny,
        );
    }

    #[test]
    fn mid_band_trust_emits_hitl_band_approval() {
        let policy = BenchAuditPolicy::default();
        let mid_summary = BenchTrustSummary {
            bench_trust_score: 0.75,
            ..clean_summary()
        };
        let verdicts = policy.evaluate(&claim(0.10), &mid_summary);

        assert!(
            verdicts
                .iter()
                .any(|v| v.kind == VerdictKind::RequiresApproval
                    && v.source == "bench_audit:hitl_band"),
            "expected hitl_band approval verdict, got {verdicts:?}"
        );
        // Mid-band must not also emit an explicit Allow — that's the whole
        // point of the HITL guard.
        assert!(
            !verdicts.iter().any(|v| v.kind == VerdictKind::Allow),
            "mid-band must not also emit an Allow"
        );
    }

    #[test]
    fn within_flagged_margin_denies_even_for_clean_suite() {
        let policy = BenchAuditPolicy::default();
        // 5/20 flagged → 0.25 noise floor. A 0.20 delta sits inside it.
        let summary = BenchTrustSummary {
            flagged_task_count: 5,
            ..clean_summary()
        };
        let verdicts = policy.evaluate(&claim(0.20), &summary);

        assert!(
            verdicts
                .iter()
                .any(|v| v.kind == VerdictKind::Deny
                    && v.source == "bench_audit:within_flagged_margin"),
            "expected within_flagged_margin deny, got {verdicts:?}"
        );
        // A clean suite *also* emits the high-trust Allow so the trace shows
        // the override. Precedence then picks the Deny.
        assert!(
            verdicts
                .iter()
                .any(|v| v.kind == VerdictKind::Allow
                    && v.source == "bench_audit:high_trust_score"),
            "clean suite must still emit the high_trust_score Allow for trace fidelity"
        );
        let resolved = resolve_conflicts(verdicts);
        assert_eq!(
            resolved.winning.expect("verdict survives precedence").kind,
            VerdictKind::Deny,
            "Deny must win precedence over high_trust_score Allow",
        );
    }

    #[test]
    fn suite_id_mismatch_short_circuits_to_deny() {
        let policy = BenchAuditPolicy::default();
        let summary = clean_summary();
        let mismatched = BenchGatedClaim {
            decision_id: "dec_001".into(),
            suite_id: "regression".into(),
            delta_score: 0.30,
        };
        let verdicts = policy.evaluate(&mismatched, &summary);

        assert_eq!(verdicts.len(), 1);
        assert_eq!(verdicts[0].kind, VerdictKind::Deny);
        assert_eq!(verdicts[0].source, "bench_audit:suite_mismatch");
    }

    #[test]
    fn no_flagged_tasks_skips_margin_check() {
        let policy = BenchAuditPolicy::default();
        // Tiny delta but zero flagged tasks → margin check should NOT fire.
        let summary = BenchTrustSummary {
            flagged_task_count: 0,
            ..clean_summary()
        };
        let verdicts = policy.evaluate(&claim(0.001), &summary);

        assert!(
            !verdicts
                .iter()
                .any(|v| v.source == "bench_audit:within_flagged_margin"),
            "margin check must skip when nothing is flagged"
        );
        assert!(verdicts.iter().any(|v| v.kind == VerdictKind::Allow));
    }

    #[test]
    fn flagged_task_ratio_is_zero_for_empty_suite() {
        let summary = BenchTrustSummary {
            total_tasks: 0,
            flagged_task_count: 0,
            ..clean_summary()
        };
        assert_eq!(summary.flagged_task_ratio(), 0.0);
    }

    #[test]
    fn anchor_round_trips_through_serde() {
        let summary = clean_summary();
        let json = serde_json::to_string(&summary).expect("serialise");
        assert!(json.contains("\"anchor\":\"arXiv:2605.26079\""));
        let parsed: BenchTrustSummary = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(parsed.anchor, BENCH_AUDIT_ANCHOR);
    }
}
