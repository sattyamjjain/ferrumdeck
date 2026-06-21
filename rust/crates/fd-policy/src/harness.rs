//! Eval-driven harness / policy suggestions — the trace→delta half of the
//! HarnessX loop.
//!
//! fd-evals derives a *proposed* adjustment to an agent's harness — a tighter
//! per-call budget cap, a tool removed from the allowlist, a policy tweak —
//! from the aggregate signal across an eval run's trace ("tool X exceeded its
//! budget on 7/10 runs → propose a lower cap"). The suggestion is written to
//! the control plane as a **proposal only**: deny-by-default and
//! human-in-the-loop are preserved — nothing here mutates a live policy,
//! allowlist, or budget. An operator reviews it in the dashboard and approves
//! or rejects; *applying* an approved change is a separate, explicit step that
//! this module deliberately does not perform.
//!
//! Storage mirrors the champion-challenger [`crate::promotion`] gate exactly:
//! the structured record is content-hashed and written to the immutable
//! `audit_events` trail (no parallel store), with `to_audit_details` /
//! `from_audit_details` for the round-trip and a stable `content_hash` for
//! tamper-evidence. The lifecycle (proposed → approved | rejected) is a chain
//! of append-only audit events folded back into a [`SuggestionStatus`] on the
//! read path via [`fold_status`].

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Stable anchor recorded on every suggestion so audit consumers can cite the
/// methodology root without re-reading docstrings.
pub const HARNESS_ANCHOR: &str = "harnessx-trace-to-delta";

/// The kind of harness adjustment a suggestion proposes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionKind {
    /// Narrow (or widen) the per-agent tool allowlist.
    ToolScope,
    /// Adjust a budget cap (per-call / per-run).
    Budget,
    /// A policy-rule tweak (e.g. require approval for a tool).
    Policy,
}

impl SuggestionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SuggestionKind::ToolScope => "tool_scope",
            SuggestionKind::Budget => "budget",
            SuggestionKind::Policy => "policy",
        }
    }
}

/// Lifecycle of a suggestion.
///
/// Default is [`SuggestionStatus::Proposed`] — deny-by-default: a proposal is
/// never applied, only recorded, until an operator explicitly acts on it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum SuggestionStatus {
    /// Recorded, awaiting human review. The deny-by-default state.
    #[default]
    Proposed,
    /// An operator approved the proposal (recorded only — not auto-applied).
    Approved,
    /// An operator rejected the proposal.
    Rejected,
}

impl SuggestionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            SuggestionStatus::Proposed => "proposed",
            SuggestionStatus::Approved => "approved",
            SuggestionStatus::Rejected => "rejected",
        }
    }
}

/// One piece of trace-derived evidence behind a suggestion, e.g.
/// "tool `http_post` exceeded its 50¢ cap on 7/10 runs".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SuggestionEvidence {
    /// Short machine code, e.g. `budget_breach_rate`, `tool_unused`.
    pub code: String,
    /// Human-readable detail.
    pub detail: String,
    /// Optional observed scalar (e.g. a breach rate of `0.7`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub observed: Option<f64>,
}

/// A proposed, NOT-auto-applied harness / policy change derived from eval
/// traces. Immutable once written; the `content_hash` lets an auditor verify
/// the proposal content was not tampered after the fact.
///
/// The hash covers only the **immutable proposal content** — not `status`,
/// which advances over the lifecycle and is folded from the append-only audit
/// chain on the read path — so [`verify_hash`](Self::verify_hash) holds in
/// every lifecycle state.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HarnessSuggestion {
    /// `hns_*` ULID; unique per record.
    pub id: String,
    /// Agent the suggestion targets.
    pub agent_id: String,
    /// The eval run that produced it, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_eval_run_id: Option<String>,
    /// What kind of adjustment is proposed.
    pub kind: SuggestionKind,
    /// The current state being changed (a snapshot for the reviewer's diff).
    pub current: serde_json::Value,
    /// The proposed replacement.
    pub proposed: serde_json::Value,
    /// Operator-readable explanation of why the eval proposes this.
    pub reason: String,
    /// Trace-derived evidence supporting the proposal.
    pub evidence: Vec<SuggestionEvidence>,
    /// Confidence in `[0, 1]` reported by the deriving eval.
    pub confidence: f64,
    /// Lifecycle status. On the create path this is always
    /// [`SuggestionStatus::Proposed`]; the read path overlays the folded
    /// status from the resolution chain.
    pub status: SuggestionStatus,
    /// SHA-256 over a stable projection of the immutable proposal fields.
    pub content_hash: String,
    /// Server-generated wall-clock UTC instant the proposal was recorded.
    pub created_at: DateTime<Utc>,
    /// Stable methodology anchor.
    #[serde(default = "default_anchor")]
    pub anchor: String,
}

fn default_anchor() -> String {
    HARNESS_ANCHOR.to_string()
}

impl HarnessSuggestion {
    /// Build a fresh proposal. The caller supplies the `id` (`hns_*` ULID) and
    /// `created_at`; the status is always [`SuggestionStatus::Proposed`] and
    /// the content hash is computed over the immutable proposal fields.
    #[allow(clippy::too_many_arguments)]
    pub fn propose(
        id: impl Into<String>,
        agent_id: impl Into<String>,
        source_eval_run_id: Option<String>,
        kind: SuggestionKind,
        current: serde_json::Value,
        proposed: serde_json::Value,
        reason: impl Into<String>,
        evidence: Vec<SuggestionEvidence>,
        confidence: f64,
        created_at: DateTime<Utc>,
    ) -> Self {
        let agent_id = agent_id.into();
        let reason = reason.into();
        let content_hash = compute_content_hash(
            &agent_id,
            source_eval_run_id.as_deref(),
            kind,
            &current,
            &proposed,
            &reason,
            &evidence,
            confidence,
        );
        Self {
            id: id.into(),
            agent_id,
            source_eval_run_id,
            kind,
            current,
            proposed,
            reason,
            evidence,
            confidence,
            status: SuggestionStatus::Proposed,
            content_hash,
            created_at,
            anchor: HARNESS_ANCHOR.to_string(),
        }
    }

    /// Serialize into the JSON shape that goes into `audit_events.details`.
    pub fn to_audit_details(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("HarnessSuggestion must always serialise")
    }

    /// Parse back out of an `audit_events.details` blob. Used by the gateway
    /// read endpoint.
    pub fn from_audit_details(value: &serde_json::Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(value.clone())
    }

    /// Return a copy with the lifecycle status overlaid (used by the read
    /// path after folding the resolution chain). Does not touch the content
    /// hash — status is not part of the hashed proposal content.
    pub fn with_status(mut self, status: SuggestionStatus) -> Self {
        self.status = status;
        self
    }

    /// True iff the stored `content_hash` still matches a re-computation from
    /// the immutable proposal fields. Holds in every lifecycle state.
    pub fn verify_hash(&self) -> bool {
        compute_content_hash(
            &self.agent_id,
            self.source_eval_run_id.as_deref(),
            self.kind,
            &self.current,
            &self.proposed,
            &self.reason,
            &self.evidence,
            self.confidence,
        ) == self.content_hash
    }
}

/// Fold a proposal's resolution chain into its current status. `resolutions`
/// are `approved` booleans in chronological order — the last one wins. An
/// empty chain means the proposal is still [`SuggestionStatus::Proposed`]
/// (deny-by-default: no resolution ⇒ not approved).
pub fn fold_status(resolutions: &[bool]) -> SuggestionStatus {
    match resolutions.last() {
        Some(true) => SuggestionStatus::Approved,
        Some(false) => SuggestionStatus::Rejected,
        None => SuggestionStatus::Proposed,
    }
}

/// Deterministic SHA-256 over a stable projection of the immutable proposal
/// content. Single source so any future replay regression catches drift.
#[allow(clippy::too_many_arguments)]
fn compute_content_hash(
    agent_id: &str,
    source_eval_run_id: Option<&str>,
    kind: SuggestionKind,
    current: &serde_json::Value,
    proposed: &serde_json::Value,
    reason: &str,
    evidence: &[SuggestionEvidence],
    confidence: f64,
) -> String {
    #[derive(Serialize)]
    struct HashableProjection<'a> {
        agent_id: &'a str,
        source_eval_run_id: Option<&'a str>,
        kind: &'a str,
        current: &'a serde_json::Value,
        proposed: &'a serde_json::Value,
        reason: &'a str,
        evidence: &'a [SuggestionEvidence],
        confidence: f64,
    }
    let projection = HashableProjection {
        agent_id,
        source_eval_run_id,
        kind: kind.as_str(),
        current,
        proposed,
        reason,
        evidence,
        confidence,
    };
    let bytes = serde_json::to_vec(&projection).expect("projection must serialise");
    let digest = Sha256::digest(&bytes);
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ts() -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_700_000_000, 0).expect("valid timestamp")
    }

    fn sample() -> HarnessSuggestion {
        HarnessSuggestion::propose(
            "hns_test_001",
            "agt_demo",
            Some("eval_run_42".to_string()),
            SuggestionKind::Budget,
            json!({"per_call_cap_cents": 100}),
            json!({"per_call_cap_cents": 50}),
            "tool http_post exceeded its cap on 7/10 runs",
            vec![SuggestionEvidence {
                code: "budget_breach_rate".to_string(),
                detail: "http_post over cap in 7 of 10 runs".to_string(),
                observed: Some(0.7),
            }],
            0.82,
            ts(),
        )
    }

    #[test]
    fn propose_sets_proposed_status_and_hash() {
        let s = sample();
        assert_eq!(s.status, SuggestionStatus::Proposed);
        assert_eq!(s.content_hash.len(), 64);
        assert!(s.verify_hash());
        assert_eq!(s.anchor, HARNESS_ANCHOR);
    }

    #[test]
    fn audit_details_round_trip_preserves_record() {
        let s = sample();
        let details = s.to_audit_details();
        let parsed = HarnessSuggestion::from_audit_details(&details).expect("round-trip");
        assert_eq!(parsed, s);
        assert!(parsed.verify_hash());
    }

    #[test]
    fn tampering_with_proposed_value_breaks_hash() {
        let mut s = sample();
        // Rewrite the proposed change without recomputing the hash.
        s.proposed = json!({"per_call_cap_cents": 1});
        assert!(!s.verify_hash());
    }

    #[test]
    fn status_overlay_does_not_break_hash() {
        // Folding a lifecycle status onto the read path must not invalidate
        // the tamper-evidence over the immutable proposal content.
        let s = sample().with_status(SuggestionStatus::Approved);
        assert_eq!(s.status, SuggestionStatus::Approved);
        assert!(s.verify_hash());
    }

    #[test]
    fn fold_status_takes_last_resolution() {
        assert_eq!(fold_status(&[]), SuggestionStatus::Proposed);
        assert_eq!(fold_status(&[true]), SuggestionStatus::Approved);
        assert_eq!(fold_status(&[false]), SuggestionStatus::Rejected);
        // Last write wins (re-approved after a rejection).
        assert_eq!(fold_status(&[false, true]), SuggestionStatus::Approved);
        assert_eq!(fold_status(&[true, false]), SuggestionStatus::Rejected);
    }

    #[test]
    fn kind_and_status_serialise_snake_case() {
        assert_eq!(
            serde_json::to_string(&SuggestionKind::ToolScope).unwrap(),
            "\"tool_scope\""
        );
        assert_eq!(
            serde_json::to_string(&SuggestionKind::Budget).unwrap(),
            "\"budget\""
        );
        assert_eq!(
            serde_json::to_string(&SuggestionKind::Policy).unwrap(),
            "\"policy\""
        );
        for (status, expected) in [
            (SuggestionStatus::Proposed, "\"proposed\""),
            (SuggestionStatus::Approved, "\"approved\""),
            (SuggestionStatus::Rejected, "\"rejected\""),
        ] {
            assert_eq!(serde_json::to_string(&status).unwrap(), expected);
        }
    }

    #[test]
    fn default_status_is_proposed() {
        assert_eq!(SuggestionStatus::default(), SuggestionStatus::Proposed);
    }

    #[test]
    fn hash_is_stable_across_identical_proposals() {
        assert_eq!(sample().content_hash, sample().content_hash);
    }
}
