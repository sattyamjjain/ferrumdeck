//! Routing-decision audit record for multi-agent coordination.
//!
//! Every time the orchestrator binds a subtask to a concrete agent / role /
//! model, a [`RoutingDecision`] is produced and written to the existing
//! immutable audit trail via the standard
//! [`fd_storage::repos::AuditRepo`] writer — see
//! [`crate::routing::RoutingDecision::to_audit_details`]. This crate is
//! purely the **shape**: candidate enumeration, the chosen binding, the
//! reason code, and a content-addressed hash that lets fd-evals replay a
//! coordination chain deterministically.
//!
//! Anchor: *AgensFlow: Auditable, Replayable Multi-Agent Coordination*,
//! arXiv:[2605.27466](https://arxiv.org/abs/2605.27466).
//!
//! No new store is introduced: the records flow through the existing
//! `audit_events` table; the read API is `AuditRepo::list_routing_decisions`
//! (filtered `list_by_run` projection). The dual-plane invariant is
//! preserved — Rust governance produces the record; the Python data plane
//! and the Next.js dashboard consume it without ever owning it.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Stable arXiv anchor recorded on every decision so audit consumers can
/// cite the source without re-fetching this docstring.
pub const ROUTING_ANCHOR: &str = "arXiv:2605.27466";

/// A single routing candidate the orchestrator considered for a subtask.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutingCandidate {
    /// Coordination role the candidate would fill (`planner`, `researcher`,
    /// `coder`, etc.). Free-form so a project's workflow vocabulary stays
    /// authoritative — the policy plane only stores it verbatim.
    pub role: String,
    /// Agent registry id of the candidate, when one exists. `None` for
    /// candidates produced by an ad-hoc binding (e.g. a one-shot model
    /// override on a workflow run).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    /// Model id the candidate would run (`claude-opus-4-7`, `gpt-4o`, …).
    /// Free-form string so a future model lands here without a schema
    /// migration.
    pub model: String,
    /// Optional ranking score. `None` when the orchestrator did not perform
    /// ordered scoring (e.g. policy short-circuit). Recorded so AgensFlow
    /// replays can audit ranker drift.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

/// The candidate that won the routing decision. Stored separately from the
/// candidate list (rather than as an index) so the chosen binding survives
/// a future change to the candidate-list ordering rules.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutingChoice {
    pub role: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub model: String,
}

/// Stable, namespaced reason code for a routing decision. Matches the
/// dispatch-time policy outcomes the orchestrator already enumerates, so
/// each code aligns with an existing policy-engine return value.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoutingReasonCode {
    /// A policy rule matched explicitly and selected the chosen candidate.
    PolicyMatch,
    /// The chosen candidate satisfies all budget axes; no policy rule was
    /// needed.
    BudgetWithinLimits,
    /// The chosen candidate is allowed but requires approval before the
    /// dispatched step can start. The audit record is written *now* so the
    /// audit chain is complete even if approval is later denied.
    ApprovalGate,
    /// The subtask was deliberately not dispatched (e.g. conditional
    /// skipped, scheduler-imposed truncation). `chosen` still records the
    /// would-have-been binding so replays can attribute the skip.
    Skip,
    /// No policy match and no scoring signal — the orchestrator fell back
    /// to the workflow's declared default. Surfaced as its own code so
    /// "we routed because nothing else fired" is auditable.
    FallbackDefault,
}

impl RoutingReasonCode {
    pub fn as_str(self) -> &'static str {
        match self {
            RoutingReasonCode::PolicyMatch => "policy_match",
            RoutingReasonCode::BudgetWithinLimits => "budget_within_limits",
            RoutingReasonCode::ApprovalGate => "approval_gate",
            RoutingReasonCode::Skip => "skip",
            RoutingReasonCode::FallbackDefault => "fallback_default",
        }
    }
}

/// Reason for a routing decision. The `code` field is the stable
/// machine-readable handle; `detail` is the operator-readable explanation
/// that surfaces in the dashboard.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutingReason {
    pub code: RoutingReasonCode,
    pub detail: String,
}

impl RoutingReason {
    pub fn new(code: RoutingReasonCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            detail: detail.into(),
        }
    }
}

/// The full routing decision recorded per coordination step. Immutable once
/// written; replays compare `content_hash` to detect drift.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RoutingDecision {
    /// `rtg_*` ULID; unique per record.
    pub id: String,
    /// Run this decision belongs to.
    pub run_id: String,
    /// Subtask / DAG step the decision is binding.
    pub subtask_id: String,
    /// Every candidate the orchestrator considered, in the order they were
    /// evaluated. Order is preserved verbatim so a replay can attribute a
    /// later ordering change.
    pub candidates: Vec<RoutingCandidate>,
    /// The candidate that won.
    pub chosen: RoutingChoice,
    /// Why this candidate won.
    pub reason: RoutingReason,
    /// SHA-256 over a stable JSON projection of the decision's structural
    /// fields (everything *except* `decided_at` and `content_hash` itself).
    /// Equal hashes mean equal decisions; unequal hashes mean a coordination
    /// drift that the replay should surface.
    pub content_hash: String,
    /// Server-generated wall-clock UTC instant.
    pub decided_at: DateTime<Utc>,
    /// arXiv anchor of the audit methodology — defaults to
    /// [`ROUTING_ANCHOR`].
    #[serde(default = "default_anchor")]
    pub anchor: String,
}

fn default_anchor() -> String {
    ROUTING_ANCHOR.to_string()
}

impl RoutingDecision {
    /// Build a decision from raw inputs. `id` and `decided_at` are taken
    /// from the caller so the gateway can stamp them at dispatch time;
    /// `content_hash` is computed here so the contract is single-source.
    pub fn new(
        id: impl Into<String>,
        run_id: impl Into<String>,
        subtask_id: impl Into<String>,
        candidates: Vec<RoutingCandidate>,
        chosen: RoutingChoice,
        reason: RoutingReason,
        decided_at: DateTime<Utc>,
    ) -> Self {
        let id = id.into();
        let run_id = run_id.into();
        let subtask_id = subtask_id.into();
        let content_hash =
            compute_content_hash(&run_id, &subtask_id, &candidates, &chosen, reason.code);
        Self {
            id,
            run_id,
            subtask_id,
            candidates,
            chosen,
            reason,
            content_hash,
            decided_at,
            anchor: ROUTING_ANCHOR.into(),
        }
    }

    /// Serialize the decision into the JSON shape that goes into
    /// `audit_events.details`. Mirrors `serde_json::to_value(&self)` but
    /// kept as a named entry point so call sites read clearly.
    pub fn to_audit_details(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("RoutingDecision must always serialise")
    }

    /// Parse a decision back out of an `audit_events.details` blob. Used by
    /// the gateway `/v1/runs/{id}/routing` read endpoint and by the
    /// fd-evals replay helper.
    pub fn from_audit_details(value: &serde_json::Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(value.clone())
    }

    /// Verify that the stored `content_hash` still matches a re-computation
    /// from the structural fields. Used by replays to detect drift.
    pub fn verify_hash(&self) -> bool {
        let expected = compute_content_hash(
            &self.run_id,
            &self.subtask_id,
            &self.candidates,
            &self.chosen,
            self.reason.code,
        );
        expected == self.content_hash
    }
}

/// Compute the deterministic SHA-256 over a stable projection. Held in a
/// free function so the hash contract is one place — change it here, the
/// replay regression in fd-evals catches it.
fn compute_content_hash(
    run_id: &str,
    subtask_id: &str,
    candidates: &[RoutingCandidate],
    chosen: &RoutingChoice,
    reason_code: RoutingReasonCode,
) -> String {
    #[derive(Serialize)]
    struct HashableProjection<'a> {
        run_id: &'a str,
        subtask_id: &'a str,
        candidates: &'a [RoutingCandidate],
        chosen: &'a RoutingChoice,
        reason_code: &'a str,
    }
    let projection = HashableProjection {
        run_id,
        subtask_id,
        candidates,
        chosen,
        reason_code: reason_code.as_str(),
    };
    // `serde_json::to_vec` is stable for the same input under serde's
    // struct-field-order serialisation — that's the whole hash contract.
    let bytes = serde_json::to_vec(&projection).expect("hashable projection must serialise");
    let digest = Sha256::digest(&bytes);
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(secs: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(secs, 0).expect("valid timestamp")
    }

    fn fixture_decision() -> RoutingDecision {
        RoutingDecision::new(
            "rtg_fixture_001",
            "run_fixture_001",
            "stp_planner_001",
            vec![
                RoutingCandidate {
                    role: "planner".into(),
                    agent_id: Some("agt_plan_alpha".into()),
                    model: "claude-opus-4-7".into(),
                    score: Some(0.91),
                },
                RoutingCandidate {
                    role: "planner".into(),
                    agent_id: Some("agt_plan_beta".into()),
                    model: "gpt-4o".into(),
                    score: Some(0.74),
                },
            ],
            RoutingChoice {
                role: "planner".into(),
                agent_id: Some("agt_plan_alpha".into()),
                model: "claude-opus-4-7".into(),
            },
            RoutingReason::new(
                RoutingReasonCode::PolicyMatch,
                "policy planner.default fired",
            ),
            ts(1_700_000_000),
        )
    }

    #[test]
    fn new_populates_content_hash_and_anchor() {
        let d = fixture_decision();
        assert!(!d.content_hash.is_empty());
        assert_eq!(d.content_hash.len(), 64, "sha-256 hex digest is 64 chars");
        assert_eq!(d.anchor, ROUTING_ANCHOR);
    }

    #[test]
    fn verify_hash_passes_for_unchanged_decision() {
        let d = fixture_decision();
        assert!(d.verify_hash());
    }

    #[test]
    fn verify_hash_fails_when_structural_field_changes() {
        let mut d = fixture_decision();
        // Mutate `chosen` directly; we deliberately do NOT recompute the
        // hash so this simulates the on-disk record drifting.
        d.chosen.model = "gpt-4o".into();
        assert!(!d.verify_hash());
    }

    #[test]
    fn audit_details_round_trip_preserves_decision() {
        let d = fixture_decision();
        let details = d.to_audit_details();
        let parsed = RoutingDecision::from_audit_details(&details).expect("parse");
        assert_eq!(parsed, d);
    }

    #[test]
    fn hash_is_stable_across_repeated_computation() {
        let a = fixture_decision();
        let b = fixture_decision();
        assert_eq!(a.content_hash, b.content_hash);
    }

    #[test]
    fn hash_changes_with_reason_code() {
        let baseline = fixture_decision();
        let with_other_reason = RoutingDecision::new(
            baseline.id.clone(),
            baseline.run_id.clone(),
            baseline.subtask_id.clone(),
            baseline.candidates.clone(),
            baseline.chosen.clone(),
            RoutingReason::new(RoutingReasonCode::BudgetWithinLimits, "budget ok"),
            baseline.decided_at,
        );
        assert_ne!(baseline.content_hash, with_other_reason.content_hash);
    }

    #[test]
    fn anchor_round_trips_through_serde() {
        let d = fixture_decision();
        let json = serde_json::to_string(&d).expect("serialise");
        assert!(json.contains("\"anchor\":\"arXiv:2605.27466\""));
        let parsed: RoutingDecision = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(parsed.anchor, ROUTING_ANCHOR);
    }

    #[test]
    fn reason_codes_serialise_snake_case() {
        for (code, expected) in [
            (RoutingReasonCode::PolicyMatch, "\"policy_match\""),
            (
                RoutingReasonCode::BudgetWithinLimits,
                "\"budget_within_limits\"",
            ),
            (RoutingReasonCode::ApprovalGate, "\"approval_gate\""),
            (RoutingReasonCode::Skip, "\"skip\""),
            (RoutingReasonCode::FallbackDefault, "\"fallback_default\""),
        ] {
            let s = serde_json::to_string(&code).expect("serialise");
            assert_eq!(s, expected);
        }
    }
}
