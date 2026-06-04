//! Champion-challenger promotion gate.
//!
//! A registered model / prompt / tool **version** (the *challenger*) cannot
//! replace the live version (the *champion*) until it clears a deterministic
//! gate: a set of configurable metric thresholds **and** a required human
//! approval. Until it does, the challenger stays in **shadow**.
//!
//! The gate emits its verdict through the **same** [`PolicyDecision`] channel
//! every other gate in this crate uses — deny-by-default, with the decision +
//! evidence written to the immutable audit trail. This is a new *rule source*,
//! not a parallel decision channel:
//!
//! - metrics below threshold → [`PolicyDecisionKind::Deny`] (stays shadow).
//! - metrics clear threshold but no approval → [`PolicyDecisionKind::RequiresApproval`].
//! - metrics clear threshold **and** approved → [`PolicyDecisionKind::Allow`] (promote).
//! - any other state (no config, no metrics) → deny-by-default.
//!
//! The structured [`PromotionDecision`] record mirrors the
//! [`crate::routing::RoutingDecision`] shape: it carries the evidence, a
//! content-addressed hash for tamper-evidence, and `to_audit_details` /
//! `from_audit_details` so it round-trips through `audit_events.details`
//! without a parallel store.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::decision::{PolicyDecision, PolicyDecisionKind};

/// Stable anchor recorded on every decision so audit consumers can cite the
/// methodology root without re-reading docstrings.
pub const PROMOTION_ANCHOR: &str = "champion-challenger";

/// Lifecycle state of a challenger version relative to its champion.
///
/// Default is [`PromotionStatus::Shadow`] — a freshly registered version is
/// never live until it explicitly clears the gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PromotionStatus {
    /// Registered but not serving traffic. The deny-by-default state.
    #[default]
    Shadow,
    /// Cleared the gate and replaced the champion.
    Promoted,
    /// Evaluated and explicitly denied — stays shadow, but the operator has
    /// a recorded reason (failed thresholds).
    Denied,
    /// Cleared thresholds but is waiting on the required human approval.
    AwaitingApproval,
}

impl PromotionStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            PromotionStatus::Shadow => "shadow",
            PromotionStatus::Promoted => "promoted",
            PromotionStatus::Denied => "denied",
            PromotionStatus::AwaitingApproval => "awaiting_approval",
        }
    }
}

/// A single configurable metric threshold the challenger must clear.
///
/// `min_value` is an inclusive floor: the measured value must be
/// `>= min_value` for the metric to pass. Higher-is-better is the only
/// supported direction — callers that need lower-is-better (e.g. cost,
/// latency) pass a negated metric or a reciprocal so the floor semantics
/// hold. Keeping a single direction makes the gate trivially deterministic.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetricThreshold {
    /// Metric name, e.g. `eval_pass_rate`, `bench_trust_score`.
    pub name: String,
    /// Inclusive floor the measured value must reach.
    pub min_value: f64,
}

impl MetricThreshold {
    pub fn new(name: impl Into<String>, min_value: f64) -> Self {
        Self {
            name: name.into(),
            min_value,
        }
    }
}

/// Configuration for a promotion gate: the thresholds the challenger must
/// clear plus whether a human approval is required on top.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromotionGateConfig {
    /// Metric thresholds, all of which must pass. An **empty** threshold list
    /// is treated as "no automatic signal" and the gate denies by default —
    /// a challenger never auto-promotes on zero evidence.
    pub thresholds: Vec<MetricThreshold>,
    /// When true, clearing the thresholds is necessary but not sufficient:
    /// the gate returns `RequiresApproval` until a human approval is present.
    pub require_human_approval: bool,
}

impl Default for PromotionGateConfig {
    fn default() -> Self {
        // Deny-by-default posture: no thresholds configured means nothing can
        // auto-promote, and approval is required.
        Self {
            thresholds: Vec::new(),
            require_human_approval: true,
        }
    }
}

/// The per-metric outcome recorded as evidence on the decision.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MetricEvidence {
    pub name: String,
    /// The configured floor.
    pub min_value: f64,
    /// The measured value, or `None` when the challenger did not report it
    /// (a missing metric is a hard fail — the gate cannot assume success).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub measured_value: Option<f64>,
    /// Whether this metric cleared its floor.
    pub passed: bool,
}

/// Structured promotion-gate decision written to the immutable audit trail.
///
/// Immutable once written; the `content_hash` lets an auditor verify the
/// record was not tampered after the fact. Mirrors the
/// [`crate::routing::RoutingDecision`] shape so the audit-read path is
/// identical.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PromotionDecision {
    /// `prm_*` ULID; unique per record.
    pub id: String,
    /// Agent whose champion is being challenged.
    pub agent_id: String,
    /// The live champion version id (may be `None` for the very first
    /// promotion, where there is no incumbent).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub champion_version_id: Option<String>,
    /// The challenger version id under evaluation.
    pub challenger_version_id: String,
    /// The resulting policy-decision kind — the SAME enum every gate uses.
    pub decision_kind: PolicyDecisionKind,
    /// The resulting lifecycle status.
    pub status: PromotionStatus,
    /// Operator-readable explanation.
    pub reason: String,
    /// Per-metric evidence, in config order.
    pub metric_evidence: Vec<MetricEvidence>,
    /// Whether a human approval was present at evaluation time.
    pub approval_present: bool,
    /// Whether the gate config required an approval.
    pub approval_required: bool,
    /// SHA-256 over a stable projection of the structural fields (everything
    /// except `decided_at` and `content_hash` itself).
    pub content_hash: String,
    /// Server-generated wall-clock UTC instant.
    pub decided_at: DateTime<Utc>,
    /// Stable methodology anchor.
    #[serde(default = "default_anchor")]
    pub anchor: String,
}

fn default_anchor() -> String {
    PROMOTION_ANCHOR.to_string()
}

impl PromotionDecision {
    /// Serialize into the JSON shape that goes into `audit_events.details`.
    pub fn to_audit_details(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("PromotionDecision must always serialise")
    }

    /// Parse back out of an `audit_events.details` blob. Used by the gateway
    /// `/v1/promotions/{agent_id}` read endpoint and the fd-evals replay.
    pub fn from_audit_details(value: &serde_json::Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(value.clone())
    }

    /// True iff the stored `content_hash` still matches a re-computation from
    /// the structural fields. Audit consumers use this to detect tampering.
    pub fn verify_hash(&self) -> bool {
        compute_content_hash(
            &self.agent_id,
            self.champion_version_id.as_deref(),
            &self.challenger_version_id,
            self.decision_kind,
            self.status,
            &self.metric_evidence,
            self.approval_present,
            self.approval_required,
        ) == self.content_hash
    }
}

/// The champion-challenger promotion gate. Pure — `evaluate` has no I/O and
/// no clock; the caller stamps `id` + `decided_at` and writes the audit row.
#[derive(Debug, Clone, Default)]
pub struct PromotionGate;

impl PromotionGate {
    /// Evaluate a challenger against the gate config + measured metrics.
    ///
    /// Returns a [`PolicyDecision`] — the same deny-by-default primitive every
    /// gate emits — so the caller dispatches it through the existing audit +
    /// approval path with no special-casing.
    ///
    /// Decision table:
    /// - empty thresholds → **deny** (no evidence ⇒ no auto-promotion).
    /// - any threshold fails (or its metric is missing) → **deny**.
    /// - all thresholds pass, approval required but absent → **requires_approval**.
    /// - all thresholds pass, (approval not required, or present) → **allow**.
    pub fn evaluate(
        &self,
        config: &PromotionGateConfig,
        metrics: &[(String, f64)],
        approval_present: bool,
    ) -> PolicyDecision {
        let evidence = build_evidence(config, metrics);

        if config.thresholds.is_empty() {
            return PolicyDecision::deny(
                "promotion denied: no metric thresholds configured (deny-by-default; \
                 challenger stays shadow)",
            );
        }

        let failed: Vec<&MetricEvidence> = evidence.iter().filter(|e| !e.passed).collect();
        if !failed.is_empty() {
            let names: Vec<&str> = failed.iter().map(|e| e.name.as_str()).collect();
            return PolicyDecision::deny(format!(
                "promotion denied: challenger below threshold on [{}] (challenger stays shadow)",
                names.join(", ")
            ));
        }

        if config.require_human_approval && !approval_present {
            return PolicyDecision::requires_approval(
                "promotion thresholds cleared; awaiting required human approval before promote",
            );
        }

        PolicyDecision::allow(
            "promotion allowed: all thresholds cleared and approval satisfied — challenger \
             promoted to champion",
        )
    }

    /// Build the full structured [`PromotionDecision`] audit record from an
    /// evaluation. The `decision` passed in is the output of [`Self::evaluate`]
    /// — the caller threads it so the audit record and the dispatched policy
    /// decision can never disagree.
    #[allow(clippy::too_many_arguments)]
    pub fn decide(
        &self,
        id: impl Into<String>,
        agent_id: impl Into<String>,
        champion_version_id: Option<String>,
        challenger_version_id: impl Into<String>,
        config: &PromotionGateConfig,
        metrics: &[(String, f64)],
        approval_present: bool,
        decision: &PolicyDecision,
        decided_at: DateTime<Utc>,
    ) -> PromotionDecision {
        let agent_id = agent_id.into();
        let challenger_version_id = challenger_version_id.into();
        let evidence = build_evidence(config, metrics);
        let status = status_for(decision.kind);
        let content_hash = compute_content_hash(
            &agent_id,
            champion_version_id.as_deref(),
            &challenger_version_id,
            decision.kind,
            status,
            &evidence,
            approval_present,
            config.require_human_approval,
        );
        PromotionDecision {
            id: id.into(),
            agent_id,
            champion_version_id,
            challenger_version_id,
            decision_kind: decision.kind,
            status,
            reason: decision.reason.clone(),
            metric_evidence: evidence,
            approval_present,
            approval_required: config.require_human_approval,
            content_hash,
            decided_at,
            anchor: PROMOTION_ANCHOR.to_string(),
        }
    }
}

/// Map a policy-decision kind onto the promotion lifecycle status.
fn status_for(kind: PolicyDecisionKind) -> PromotionStatus {
    match kind {
        PolicyDecisionKind::Allow | PolicyDecisionKind::AllowWithWarning => {
            PromotionStatus::Promoted
        }
        PolicyDecisionKind::RequiresApproval => PromotionStatus::AwaitingApproval,
        PolicyDecisionKind::Deny => PromotionStatus::Denied,
    }
}

/// Build per-metric evidence in config order. A metric missing from the
/// measured set is recorded with `measured_value = None` and `passed = false`
/// — the gate cannot assume an unreported metric succeeded.
fn build_evidence(config: &PromotionGateConfig, metrics: &[(String, f64)]) -> Vec<MetricEvidence> {
    config
        .thresholds
        .iter()
        .map(|t| {
            let measured = metrics
                .iter()
                .find(|(name, _)| name == &t.name)
                .map(|(_, v)| *v);
            let passed = measured.map(|v| v >= t.min_value).unwrap_or(false);
            MetricEvidence {
                name: t.name.clone(),
                min_value: t.min_value,
                measured_value: measured,
                passed,
            }
        })
        .collect()
}

/// Deterministic SHA-256 over a stable projection. Single source so the
/// fd-evals replay regression catches any drift.
#[allow(clippy::too_many_arguments)]
fn compute_content_hash(
    agent_id: &str,
    champion_version_id: Option<&str>,
    challenger_version_id: &str,
    decision_kind: PolicyDecisionKind,
    status: PromotionStatus,
    evidence: &[MetricEvidence],
    approval_present: bool,
    approval_required: bool,
) -> String {
    #[derive(Serialize)]
    struct HashableProjection<'a> {
        agent_id: &'a str,
        champion_version_id: Option<&'a str>,
        challenger_version_id: &'a str,
        decision_kind: PolicyDecisionKind,
        status: &'a str,
        evidence: &'a [MetricEvidence],
        approval_present: bool,
        approval_required: bool,
    }
    let projection = HashableProjection {
        agent_id,
        champion_version_id,
        challenger_version_id,
        decision_kind,
        status: status.as_str(),
        evidence,
        approval_present,
        approval_required,
    };
    let bytes = serde_json::to_vec(&projection).expect("projection must serialise");
    let digest = Sha256::digest(&bytes);
    hex::encode(digest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts() -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(1_700_000_000, 0).expect("valid timestamp")
    }

    fn config(require_approval: bool) -> PromotionGateConfig {
        PromotionGateConfig {
            thresholds: vec![
                MetricThreshold::new("eval_pass_rate", 0.90),
                MetricThreshold::new("bench_trust_score", 0.70),
            ],
            require_human_approval: require_approval,
        }
    }

    #[test]
    fn empty_thresholds_deny_by_default() {
        let gate = PromotionGate;
        let cfg = PromotionGateConfig::default();
        let decision = gate.evaluate(&cfg, &[("eval_pass_rate".into(), 0.99)], true);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("no metric thresholds"));
    }

    #[test]
    fn below_threshold_is_denied() {
        let gate = PromotionGate;
        let cfg = config(true);
        // pass-rate clears but trust score is below floor.
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.95),
            ("bench_trust_score".to_string(), 0.50),
        ];
        let decision = gate.evaluate(&cfg, &metrics, true);
        assert!(decision.is_denied());
        assert!(decision.reason.contains("bench_trust_score"));
    }

    #[test]
    fn missing_metric_is_treated_as_fail() {
        let gate = PromotionGate;
        let cfg = config(false);
        // bench_trust_score not reported at all.
        let metrics = vec![("eval_pass_rate".to_string(), 0.95)];
        let decision = gate.evaluate(&cfg, &metrics, false);
        assert!(decision.is_denied());
    }

    #[test]
    fn cleared_thresholds_without_approval_requires_approval() {
        let gate = PromotionGate;
        let cfg = config(true);
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.95),
            ("bench_trust_score".to_string(), 0.80),
        ];
        let decision = gate.evaluate(&cfg, &metrics, false);
        assert!(decision.needs_approval());
    }

    #[test]
    fn cleared_thresholds_with_approval_is_allowed() {
        let gate = PromotionGate;
        let cfg = config(true);
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.95),
            ("bench_trust_score".to_string(), 0.80),
        ];
        let decision = gate.evaluate(&cfg, &metrics, true);
        assert!(decision.is_allowed());
    }

    #[test]
    fn approval_not_required_allows_on_metrics_alone() {
        let gate = PromotionGate;
        let cfg = config(false);
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.95),
            ("bench_trust_score".to_string(), 0.80),
        ];
        let decision = gate.evaluate(&cfg, &metrics, false);
        assert!(decision.is_allowed());
    }

    #[test]
    fn threshold_is_inclusive_floor() {
        let gate = PromotionGate;
        let cfg = PromotionGateConfig {
            thresholds: vec![MetricThreshold::new("eval_pass_rate", 0.90)],
            require_human_approval: false,
        };
        // exactly at the floor passes.
        let decision = gate.evaluate(&cfg, &[("eval_pass_rate".into(), 0.90)], false);
        assert!(decision.is_allowed());
    }

    #[test]
    fn decide_builds_record_with_status_and_hash() {
        let gate = PromotionGate;
        let cfg = config(true);
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.95),
            ("bench_trust_score".to_string(), 0.80),
        ];
        let decision = gate.evaluate(&cfg, &metrics, true);
        let record = gate.decide(
            "prm_test_001",
            "agt_demo",
            Some("agv_champion".into()),
            "agv_challenger",
            &cfg,
            &metrics,
            true,
            &decision,
            ts(),
        );
        assert_eq!(record.status, PromotionStatus::Promoted);
        assert_eq!(record.decision_kind, PolicyDecisionKind::Allow);
        assert_eq!(record.metric_evidence.len(), 2);
        assert!(record.metric_evidence.iter().all(|e| e.passed));
        assert_eq!(record.content_hash.len(), 64);
        assert!(record.verify_hash());
    }

    #[test]
    fn denied_decide_records_denied_status() {
        let gate = PromotionGate;
        let cfg = config(true);
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.50),
            ("bench_trust_score".to_string(), 0.80),
        ];
        let decision = gate.evaluate(&cfg, &metrics, true);
        let record = gate.decide(
            "prm_test_002",
            "agt_demo",
            None,
            "agv_challenger",
            &cfg,
            &metrics,
            true,
            &decision,
            ts(),
        );
        assert_eq!(record.status, PromotionStatus::Denied);
        assert!(record.verify_hash());
    }

    #[test]
    fn audit_details_round_trip_preserves_record() {
        let gate = PromotionGate;
        let cfg = config(false);
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.95),
            ("bench_trust_score".to_string(), 0.80),
        ];
        let decision = gate.evaluate(&cfg, &metrics, false);
        let record = gate.decide(
            "prm_test_003",
            "agt_demo",
            Some("agv_champion".into()),
            "agv_challenger",
            &cfg,
            &metrics,
            false,
            &decision,
            ts(),
        );
        let details = record.to_audit_details();
        let parsed = PromotionDecision::from_audit_details(&details).expect("round-trip");
        assert_eq!(parsed, record);
        assert!(parsed.verify_hash());
    }

    #[test]
    fn tampering_with_status_breaks_hash() {
        let gate = PromotionGate;
        let cfg = config(false);
        let metrics = vec![
            ("eval_pass_rate".to_string(), 0.95),
            ("bench_trust_score".to_string(), 0.80),
        ];
        let decision = gate.evaluate(&cfg, &metrics, false);
        let mut record = gate.decide(
            "prm_test_004",
            "agt_demo",
            None,
            "agv_challenger",
            &cfg,
            &metrics,
            false,
            &decision,
            ts(),
        );
        // Flip the status without recomputing the hash — simulates a
        // tampered audit row.
        record.status = PromotionStatus::Denied;
        assert!(!record.verify_hash());
    }

    #[test]
    fn status_serialises_snake_case() {
        for (status, expected) in [
            (PromotionStatus::Shadow, "\"shadow\""),
            (PromotionStatus::Promoted, "\"promoted\""),
            (PromotionStatus::Denied, "\"denied\""),
            (PromotionStatus::AwaitingApproval, "\"awaiting_approval\""),
        ] {
            assert_eq!(serde_json::to_string(&status).unwrap(), expected);
        }
    }

    #[test]
    fn default_status_is_shadow() {
        assert_eq!(PromotionStatus::default(), PromotionStatus::Shadow);
    }
}
