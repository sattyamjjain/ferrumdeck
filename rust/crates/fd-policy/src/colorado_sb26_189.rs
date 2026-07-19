//! Colorado **SB 26-189** — Automated Decision-Making Technology (ADMT) —
//! record-keeping + disclosure enforcement, on the R1–R3 response ladder.
//!
//! Colorado SB 26-189 (2026 Reg. Sess.) rewrote and replaced the 2024 Colorado
//! AI Act (SB 24-205). It was signed into law on **2026-05-14** and takes effect
//! **2027-01-01**. It regulates *automated decision-making technology* (ADMT)
//! used in *consequential decisions* about individuals, through a
//! transparency-plus-recordkeeping core enforced by the Attorney General.
//!
//! ## What this rule enforces (scoped to the statute, not to what sounds big)
//!
//! Three obligations from the act are mechanically representable on a decision
//! the control plane governs:
//!
//! 1. **ADMT-disclosure flag on a consequential decision.** When an ADMT is used
//!    to make, guide, or assist a *consequential decision* about an individual,
//!    the deployer owes the consumer notice/disclosure that an automated system
//!    was used. This rule raises a **disclosure-required flag** on exactly those
//!    decisions ([`ColoradoAdmtStatus::is_covered`]) and treats a covered
//!    decision that carries no disclosure as a violation.
//! 2. **3-year retention floor** on the corresponding records. The act requires
//!    developers and deployers to retain the records necessary to demonstrate
//!    compliance for **at least 3 years**. That floor is [`RETENTION_FLOOR_YEARS`]
//!    here and is enforced **in the storage layer** (a DB trigger + a guarded
//!    prune), because a retention promise that lives only in a policy struct is
//!    not a retention promise. See `fd_storage`'s audit retention guard.
//! 3. **A queryable "what decided this, when, on what inputs" record.**
//!    [`ColoradoAdmtRecord`] captures the deciding system, the decision time, a
//!    (pre-redacted) input summary, and the outcome, and round-trips through the
//!    immutable `audit_events.details` column via [`ColoradoAdmtRecord::to_audit_details`]
//!    / [`ColoradoAdmtRecord::from_audit_details`] — the same append-only audit
//!    trail every other decision uses, no parallel store.
//!
//! ## Honesty notes — read before relying on this for compliance
//!
//! - **This is not legal advice and not a certification of compliance.** It is a
//!   deterministic, structural enforcement of the *form* the statute requires
//!   (was a covered decision disclosed? is the record retained?), in the same
//!   spirit as [`crate::transparency_art50`]. Whether a disclosure is *adequate*
//!   under the act is a legal question this code does not decide.
//! - **Exact C.R.S. subsection numbers are intentionally not cited inline.** The
//!   codified section numbers live in the enrolled act; the public bill page
//!   exposes the official summary, not the C.R.S. citations. Rather than invent
//!   `§ 6-1-####` strings, this comment cites the act by number (SB 26-189, 2026)
//!   and its requirements as summarized; **confirm the precise subsection for
//!   each obligation against the enrolled act before representing compliance.**
//! - **Conservative reading of "material influence."** Step (1) is triggered by
//!   material ADMT influence, but the statutory ADMT definition reaches any
//!   system used to "make, guide, or **assist**" a consequential decision. The
//!   conservative reading discloses *more*, so [`ColoradoAdmtConfig`] defaults to
//!   treating an *assisting* ADMT as covered too ([`ColoradoAdmtConfig::treat_assist_as_covered`]
//!   = `true`); only a genuinely human-only decision ([`AutomationRole::HumanOnly`])
//!   is exempt by default. Set the flag off to enforce only the narrower
//!   "material influence" trigger.
//!
//! Like every rule on the ladder, this one only ever *adds* friction on a covered
//! decision; it never loosens another gate, and it never blocks a
//! non-consequential or human-only decision (the false-positive control).

use serde::{Deserialize, Serialize};

use crate::airlock::AirlockMode;
use crate::decision::PolicyDecision;
use crate::reversibility::ResponseLevel;

/// Stable anchor recorded with the decision so audit consumers can cite the
/// regulatory reference without re-reading docstrings.
pub const COLORADO_SB26_189_ANCHOR: &str = "colorado-sb26-189-admt";

/// Statutory record-retention floor, in years. SB 26-189 requires records
/// necessary to demonstrate compliance to be retained for **at least 3 years**.
/// This is the single source of truth; the storage layer mirrors and enforces it
/// (see `fd_storage`'s `AUDIT_RETENTION_FLOOR_YEARS`).
pub const RETENTION_FLOOR_YEARS: i64 = 3;

/// A consequential-decision domain enumerated by the act (access to, eligibility
/// for, or terms of the listed services). `Other` is a catch-all for a
/// consequential domain not separately modeled — still covered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConsequentialDomain {
    Education,
    Employment,
    Housing,
    /// Financial or lending services.
    FinancialOrLending,
    /// Health-care services.
    HealthCare,
    Insurance,
    /// Legal or essential government services.
    LegalOrGovernmentServices,
    /// A consequential domain not separately modeled — still covered.
    Other,
}

impl ConsequentialDomain {
    /// Stable snake_case wire label.
    pub fn as_str(self) -> &'static str {
        match self {
            ConsequentialDomain::Education => "education",
            ConsequentialDomain::Employment => "employment",
            ConsequentialDomain::Housing => "housing",
            ConsequentialDomain::FinancialOrLending => "financial_or_lending",
            ConsequentialDomain::HealthCare => "health_care",
            ConsequentialDomain::Insurance => "insurance",
            ConsequentialDomain::LegalOrGovernmentServices => "legal_or_government_services",
            ConsequentialDomain::Other => "other",
        }
    }
}

/// The role an automated system played in reaching the decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AutomationRole {
    /// No automated system involved — a human made the decision. Exempt.
    HumanOnly,
    /// An ADMT informed or assisted the decision without materially driving it.
    /// Covered under the conservative reading (the statute reaches "assist").
    AdmtAssisted,
    /// An ADMT materially influenced or made the decision. Always covered.
    AdmtMaterial,
}

impl AutomationRole {
    /// Stable snake_case wire label.
    pub fn as_str(self) -> &'static str {
        match self {
            AutomationRole::HumanOnly => "human_only",
            AutomationRole::AdmtAssisted => "admt_assisted",
            AutomationRole::AdmtMaterial => "admt_material",
        }
    }
}

/// Which decisions the ADMT-disclosure obligation is enforced on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColoradoAdmtConfig {
    /// Treat an *assisting* (not merely material) ADMT as covered too. Defaults
    /// **on** — the conservative reading of the statute's "make, guide, or
    /// assist" ADMT definition (disclose more, not less).
    pub treat_assist_as_covered: bool,
}

impl Default for ColoradoAdmtConfig {
    fn default() -> Self {
        Self {
            treat_assist_as_covered: true,
        }
    }
}

impl ColoradoAdmtConfig {
    /// Build from a governance JSON `colorado_admt` object, defaulting a missing
    /// key to the conservative default (assist covered).
    pub fn from_json(value: &serde_json::Value) -> Self {
        let d = Self::default();
        Self {
            treat_assist_as_covered: value
                .get("treat_assist_as_covered")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(d.treat_assist_as_covered),
        }
    }
}

/// The classification inputs for a single governed decision.
#[derive(Debug, Clone)]
pub struct AdmtDecisionContext {
    /// The consequential domain, if this decision is consequential at all.
    /// `None` ⇒ not a consequential decision ⇒ never covered.
    pub domain: Option<ConsequentialDomain>,
    /// The role the automated system played.
    pub automation: AutomationRole,
    /// Whether an ADMT-use disclosure was actually provided to the consumer for
    /// this decision. Only meaningful when the decision is covered.
    pub disclosed: bool,
}

impl AdmtDecisionContext {
    /// Is this decision covered by SB 26-189 under the given config — i.e. a
    /// consequential decision reached with a covered degree of automation?
    pub fn is_covered(&self, cfg: ColoradoAdmtConfig) -> bool {
        if self.domain.is_none() {
            return false;
        }
        match self.automation {
            AutomationRole::HumanOnly => false,
            AutomationRole::AdmtMaterial => true,
            AutomationRole::AdmtAssisted => cfg.treat_assist_as_covered,
        }
    }
}

/// The SB 26-189 verdict for a single decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColoradoAdmtStatus {
    /// Not a covered ADMT consequential decision — the rule does not apply
    /// (human-only, or a non-consequential decision). The false-positive control.
    Exempt,
    /// Covered, and an ADMT-use disclosure was provided. Compliant.
    CompliantDisclosed,
    /// Covered, but no ADMT-use disclosure was provided. A violation.
    MissingDisclosure,
}

impl ColoradoAdmtStatus {
    /// Stable snake_case wire label.
    pub fn as_str(self) -> &'static str {
        match self {
            ColoradoAdmtStatus::Exempt => "exempt",
            ColoradoAdmtStatus::CompliantDisclosed => "compliant_disclosed",
            ColoradoAdmtStatus::MissingDisclosure => "missing_disclosure",
        }
    }

    /// Whether the decision is covered by the act (disclosure obligation applies).
    pub fn is_covered(self) -> bool {
        matches!(
            self,
            ColoradoAdmtStatus::CompliantDisclosed | ColoradoAdmtStatus::MissingDisclosure
        )
    }

    /// Whether the covered decision satisfied the disclosure obligation. A
    /// non-covered (`Exempt`) decision has nothing to satisfy, so it is not
    /// "compliant" in this sense — use [`ColoradoAdmtStatus::is_covered`] first.
    pub fn is_disclosed(self) -> bool {
        matches!(self, ColoradoAdmtStatus::CompliantDisclosed)
    }

    /// Whether the ADMT-disclosure obligation is *required* on this decision.
    /// This is the flag emitted onto the OTel decision span.
    pub fn disclosure_required(self) -> bool {
        self.is_covered()
    }
}

/// Classify a decision against SB 26-189.
///
/// - Not covered ([`AdmtDecisionContext::is_covered`] is false) → [`ColoradoAdmtStatus::Exempt`].
/// - Covered + disclosed → [`ColoradoAdmtStatus::CompliantDisclosed`].
/// - Covered + not disclosed → [`ColoradoAdmtStatus::MissingDisclosure`].
pub fn check(ctx: &AdmtDecisionContext, cfg: ColoradoAdmtConfig) -> ColoradoAdmtStatus {
    if !ctx.is_covered(cfg) {
        return ColoradoAdmtStatus::Exempt;
    }
    if ctx.disclosed {
        ColoradoAdmtStatus::CompliantDisclosed
    } else {
        ColoradoAdmtStatus::MissingDisclosure
    }
}

/// Map the verdict onto the graduated R1–R3 response rung, given the Airlock mode.
///
/// - `Exempt` / `CompliantDisclosed` → **R1** `AllowAndLog` (nothing to escalate).
/// - `MissingDisclosure` + `Shadow` → **R1** `AllowAndLog` (record, don't block).
/// - `MissingDisclosure` + `Enforce` → **R3** `RequireApproval`: a covered
///   decision may not be finalized until the ADMT disclosure is attached. This
///   is a disclosure gate, not a spend gate, so there is no R2 rung here.
pub fn response_level(status: ColoradoAdmtStatus, mode: AirlockMode) -> ResponseLevel {
    match status {
        ColoradoAdmtStatus::MissingDisclosure if mode == AirlockMode::Enforce => {
            ResponseLevel::RequireApproval
        }
        _ => ResponseLevel::AllowAndLog,
    }
}

/// Turn the verdict into a [`PolicyDecision`] under the given mode.
///
/// - `Exempt` → `allow` (the rule does not apply).
/// - `CompliantDisclosed` → `allow` (covered and disclosed).
/// - `MissingDisclosure` + `enforce` → `requires_approval` (attach the disclosure,
///   record the decision, then finalize) — the R3 rung; not an outright `deny`,
///   because the remedy is to add the missing disclosure, not to abandon the
///   consequential decision.
/// - `MissingDisclosure` + `shadow` → `allow` with the violation named in the
///   reason (logged for review, never blocks) — the safe-rollout posture.
pub fn enforce(status: ColoradoAdmtStatus, mode: AirlockMode) -> PolicyDecision {
    match status {
        ColoradoAdmtStatus::Exempt => PolicyDecision::allow(format!(
            "colorado_sb26_189: decision is not a covered ADMT consequential decision [{COLORADO_SB26_189_ANCHOR}]"
        )),
        ColoradoAdmtStatus::CompliantDisclosed => PolicyDecision::allow(format!(
            "colorado_sb26_189: covered ADMT consequential decision carries the required disclosure [{COLORADO_SB26_189_ANCHOR}]"
        )),
        ColoradoAdmtStatus::MissingDisclosure => {
            let reason = format!(
                "colorado_sb26_189: covered ADMT consequential decision is missing the required disclosure [{COLORADO_SB26_189_ANCHOR}]"
            );
            match mode {
                AirlockMode::Enforce => PolicyDecision::requires_approval(reason),
                AirlockMode::Shadow => PolicyDecision::allow(format!("shadow: {reason}")),
            }
        }
    }
}

/// The queryable "what decided this, when, on what inputs" record for a covered
/// decision — obligation (3) of the rule.
///
/// It round-trips losslessly through the immutable `audit_events.details` JSONB
/// column via [`Self::to_audit_details`] / [`Self::from_audit_details`], so the
/// append-only audit trail is the single source of truth (no parallel store),
/// exactly like `RoutingDecision` / `PromotionDecision`.
///
/// **Redaction contract:** `input_summary` must be *pre-redacted* by the caller
/// (via `fd_audit::redaction`) before it is placed here — this record does not
/// itself scrub PII, matching the training-signal export path. The point of the
/// record is provenance ("which system decided, on what class of inputs"), not
/// retaining raw personal data.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColoradoAdmtRecord {
    /// Identifier of the automated system that decided (agent/model/version).
    pub system_id: String,
    /// RFC 3339 timestamp of the decision (string to keep this crate chrono-free;
    /// the caller formats it). Answers "when".
    pub decided_at: String,
    /// Pre-redacted summary of the inputs the decision was made on. Answers
    /// "on what inputs".
    pub input_summary: serde_json::Value,
    /// The determination/outcome reached (e.g. "denied", "approved", a score).
    pub outcome: String,
    /// The consequential domain this decision falls in.
    pub domain: ConsequentialDomain,
    /// The role the automated system played.
    pub automation: AutomationRole,
    /// Whether an ADMT-use disclosure was provided.
    pub disclosed: bool,
    /// The classification verdict.
    pub status: ColoradoAdmtStatus,
    /// Retention floor in years applied to this record (statutory minimum).
    pub retention_floor_years: i64,
}

impl ColoradoAdmtRecord {
    /// Build a record from a context + its verdict + the provenance fields.
    pub fn new(
        ctx: &AdmtDecisionContext,
        status: ColoradoAdmtStatus,
        system_id: impl Into<String>,
        decided_at: impl Into<String>,
        input_summary: serde_json::Value,
        outcome: impl Into<String>,
    ) -> Self {
        Self {
            system_id: system_id.into(),
            decided_at: decided_at.into(),
            input_summary,
            outcome: outcome.into(),
            // `Other` if the caller marked it covered without a domain; a covered
            // decision always has a domain, so this default is only a fallback.
            domain: ctx.domain.unwrap_or(ConsequentialDomain::Other),
            automation: ctx.automation,
            disclosed: ctx.disclosed,
            status,
            retention_floor_years: RETENTION_FLOOR_YEARS,
        }
    }

    /// Serialize to the JSON stored in `audit_events.details`. The `anchor` is
    /// included so an audit reader can cite the rule without this type.
    pub fn to_audit_details(&self) -> serde_json::Value {
        let mut v = serde_json::to_value(self).unwrap_or(serde_json::Value::Null);
        if let Some(obj) = v.as_object_mut() {
            obj.insert(
                "anchor".to_string(),
                serde_json::Value::String(COLORADO_SB26_189_ANCHOR.to_string()),
            );
        }
        v
    }

    /// Recover a record from `audit_events.details` on the read path. Returns
    /// `None` if the JSON is not a well-formed record.
    pub fn from_audit_details(details: &serde_json::Value) -> Option<Self> {
        serde_json::from_value(details.clone()).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn consequential_material(disclosed: bool) -> AdmtDecisionContext {
        AdmtDecisionContext {
            domain: Some(ConsequentialDomain::Employment),
            automation: AutomationRole::AdmtMaterial,
            disclosed,
        }
    }

    #[test]
    fn fires_on_consequential_admt_decision_without_disclosure() {
        // A covered decision (consequential + material ADMT) with no disclosure
        // is a violation and, under enforce, an R3 gate.
        let ctx = consequential_material(false);
        let status = check(&ctx, ColoradoAdmtConfig::default());
        assert_eq!(status, ColoradoAdmtStatus::MissingDisclosure);
        assert!(status.is_covered());
        assert!(status.disclosure_required());
        let d = enforce(status, AirlockMode::Enforce);
        assert!(d.needs_approval());
        assert!(d.reason.contains(COLORADO_SB26_189_ANCHOR));
        assert_eq!(
            response_level(status, AirlockMode::Enforce),
            ResponseLevel::RequireApproval
        );
        assert_eq!(response_level(status, AirlockMode::Enforce).rung(), "R3");
    }

    #[test]
    fn covered_and_disclosed_is_compliant() {
        let ctx = consequential_material(true);
        let status = check(&ctx, ColoradoAdmtConfig::default());
        assert_eq!(status, ColoradoAdmtStatus::CompliantDisclosed);
        assert!(status.is_covered());
        assert!(status.is_disclosed());
        assert!(enforce(status, AirlockMode::Enforce).is_allowed());
    }

    #[test]
    fn non_consequential_decision_does_not_trip_the_rule() {
        // False-positive control: a material ADMT on a NON-consequential decision
        // (no domain) is exempt — the rule must not fire.
        let ctx = AdmtDecisionContext {
            domain: None,
            automation: AutomationRole::AdmtMaterial,
            disclosed: false,
        };
        let status = check(&ctx, ColoradoAdmtConfig::default());
        assert_eq!(status, ColoradoAdmtStatus::Exempt);
        assert!(!status.is_covered());
        assert!(!status.disclosure_required());
        // Exempt always allows, in both modes.
        for mode in [AirlockMode::Enforce, AirlockMode::Shadow] {
            assert!(enforce(status, mode).is_allowed());
            assert_eq!(response_level(status, mode), ResponseLevel::AllowAndLog);
        }
    }

    #[test]
    fn human_only_consequential_decision_is_exempt() {
        // A consequential decision made by a human (no ADMT) is not covered.
        let ctx = AdmtDecisionContext {
            domain: Some(ConsequentialDomain::Housing),
            automation: AutomationRole::HumanOnly,
            disclosed: false,
        };
        assert_eq!(
            check(&ctx, ColoradoAdmtConfig::default()),
            ColoradoAdmtStatus::Exempt
        );
    }

    #[test]
    fn assist_is_covered_by_default_but_configurable() {
        let ctx = AdmtDecisionContext {
            domain: Some(ConsequentialDomain::FinancialOrLending),
            automation: AutomationRole::AdmtAssisted,
            disclosed: false,
        };
        // Conservative default: assisting ADMT is covered.
        assert_eq!(
            check(&ctx, ColoradoAdmtConfig::default()),
            ColoradoAdmtStatus::MissingDisclosure
        );
        // Narrowed to material-only: an assisting ADMT is then exempt.
        let narrow = ColoradoAdmtConfig {
            treat_assist_as_covered: false,
        };
        assert_eq!(check(&ctx, narrow), ColoradoAdmtStatus::Exempt);
    }

    #[test]
    fn shadow_mode_allows_but_logs_missing_disclosure() {
        let d = enforce(ColoradoAdmtStatus::MissingDisclosure, AirlockMode::Shadow);
        assert!(d.is_allowed());
        assert!(d.reason.starts_with("shadow:"));
        assert_eq!(
            response_level(ColoradoAdmtStatus::MissingDisclosure, AirlockMode::Shadow),
            ResponseLevel::AllowAndLog
        );
    }

    #[test]
    fn config_from_json_defaults_conservative() {
        let cfg = ColoradoAdmtConfig::from_json(&serde_json::json!({}));
        assert!(cfg.treat_assist_as_covered);
        let narrowed =
            ColoradoAdmtConfig::from_json(&serde_json::json!({"treat_assist_as_covered": false}));
        assert!(!narrowed.treat_assist_as_covered);
    }

    #[test]
    fn record_round_trips_through_audit_details() {
        let ctx = consequential_material(false);
        let status = check(&ctx, ColoradoAdmtConfig::default());
        let rec = ColoradoAdmtRecord::new(
            &ctx,
            status,
            "agt_01hxmodel/v3",
            "2026-07-19T12:00:00Z",
            serde_json::json!({"features": ["tenure_months", "region"]}),
            "denied",
        );
        assert_eq!(rec.retention_floor_years, RETENTION_FLOOR_YEARS);
        let details = rec.to_audit_details();
        // The anchor is embedded for audit readers.
        assert_eq!(details["anchor"], COLORADO_SB26_189_ANCHOR);
        assert_eq!(details["status"], "missing_disclosure");
        assert_eq!(details["domain"], "employment");
        let back = ColoradoAdmtRecord::from_audit_details(&details).expect("valid record");
        assert_eq!(back, rec);
    }

    #[test]
    fn status_wire_labels_round_trip() {
        for s in [
            ColoradoAdmtStatus::Exempt,
            ColoradoAdmtStatus::CompliantDisclosed,
            ColoradoAdmtStatus::MissingDisclosure,
        ] {
            let json = serde_json::to_string(&s).unwrap();
            assert_eq!(json, format!("\"{}\"", s.as_str()));
            let back: ColoradoAdmtStatus = serde_json::from_str(&json).unwrap();
            assert_eq!(back, s);
        }
    }
}
