//! Reversibility-aware graduated response — the DeepMind *AI Control Roadmap*
//! R1→R3 ladder applied to tool calls.
//!
//! Risk and **reversibility** are orthogonal axes: a high-risk *read* is
//! recoverable, a low-risk *delete* is not. This module adds the reversibility
//! dimension and maps it onto a graduated response, so the control plane
//! escalates friction only as far as the *recoverability* of the action
//! demands:
//!
//! - **R1 — monitor** ([`ResponseLevel::AllowAndLog`]): a *reversible* action
//!   proceeds; the transcript is reviewed asynchronously, no gate.
//! - **R2 — conditional** ([`ResponseLevel::AllowUnderBudget`]): a *costly*
//!   (recoverable, but expensive) action proceeds **only while the run's
//!   budget gate has headroom**; once the budget is exhausted it escalates to
//!   R3.
//! - **R3 — gate** ([`ResponseLevel::RequireApproval`]): an *irreversible*
//!   action requires the existing human-in-the-loop approval gate.
//!
//! Reference: DeepMind, *An Approach to Technical AGI Safety — AI Control
//! Roadmap* (the R1–R3 control-level ladder).
//!
//! **Additive + deny-by-default**: this dimension is orthogonal to the
//! existing risk tiers (it neither removes nor renames them), and an unknown /
//! unclassified tool defaults to [`Reversibility::Irreversible`] — the most
//! restrictive rung. The graduated response can only ever *add* friction to
//! the allowlist decision, never loosen a `Deny` or an approval requirement
//! (see [`combine`]).

use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::decision::{PolicyDecision, PolicyDecisionKind};

/// Stable anchor recorded alongside the response so audit consumers can cite
/// the design reference without re-reading docstrings.
pub const RESPONSE_LADDER_ANCHOR: &str = "deepmind-ai-control-roadmap-r1-r3";

/// How recoverable a tool's effect is. Orthogonal to risk tier.
///
/// Default is [`Reversibility::Irreversible`] — deny-by-default: an
/// unclassified tool is treated as the most consequential until proven
/// otherwise.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Reversibility {
    /// Effects can be undone freely (reads, idempotent no-ops).
    Reversible,
    /// Recoverable, but undoing costs real money / time (spend, large compute).
    Costly,
    /// Cannot be undone (deletes, deploys, payments, external sends).
    #[default]
    Irreversible,
}

impl Reversibility {
    /// Stable snake_case wire label.
    pub fn as_str(self) -> &'static str {
        match self {
            Reversibility::Reversible => "reversible",
            Reversibility::Costly => "costly",
            Reversibility::Irreversible => "irreversible",
        }
    }

    /// Parse from a stored string, defaulting **unknown → Irreversible**
    /// (deny-by-default). Never fails — an unparseable value is the most
    /// restrictive rung, which is the safe direction.
    pub fn parse(value: &str) -> Self {
        match value.trim().to_lowercase().as_str() {
            "reversible" => Reversibility::Reversible,
            "costly" => Reversibility::Costly,
            _ => Reversibility::Irreversible,
        }
    }
}

impl FromStr for Reversibility {
    type Err = std::convert::Infallible;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Reversibility::parse(s))
    }
}

/// The graduated response level chosen for a tool call — the R1–R3 rung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResponseLevel {
    /// R1: allow and log for async review — no block.
    AllowAndLog,
    /// R2: allow only while the budget gate has headroom.
    AllowUnderBudget,
    /// R3: require the human-in-the-loop approval gate.
    RequireApproval,
}

impl ResponseLevel {
    /// Stable snake_case wire label.
    pub fn as_str(self) -> &'static str {
        match self {
            ResponseLevel::AllowAndLog => "allow_and_log",
            ResponseLevel::AllowUnderBudget => "allow_under_budget",
            ResponseLevel::RequireApproval => "require_approval",
        }
    }

    /// The R-rung label (R1/R2/R3) for display + docs.
    pub fn rung(self) -> &'static str {
        match self {
            ResponseLevel::AllowAndLog => "R1",
            ResponseLevel::AllowUnderBudget => "R2",
            ResponseLevel::RequireApproval => "R3",
        }
    }

    /// The [`PolicyDecisionKind`] this rung corresponds to on its own.
    /// R1/R2 allow; R3 requires approval. (R2's budget gating is applied
    /// *before* this mapping — see [`graduated_response`].)
    pub fn decision_kind(self) -> PolicyDecisionKind {
        match self {
            ResponseLevel::AllowAndLog | ResponseLevel::AllowUnderBudget => {
                PolicyDecisionKind::Allow
            }
            ResponseLevel::RequireApproval => PolicyDecisionKind::RequiresApproval,
        }
    }

    /// Build a standalone [`PolicyDecision`] for this rung with a reason.
    pub fn to_policy_decision(self, reason: impl Into<String>) -> PolicyDecision {
        match self {
            ResponseLevel::AllowAndLog | ResponseLevel::AllowUnderBudget => {
                PolicyDecision::allow(reason)
            }
            ResponseLevel::RequireApproval => PolicyDecision::requires_approval(reason),
        }
    }
}

/// Map a tool's reversibility (plus whether the run's budget gate currently has
/// headroom) onto the graduated response rung.
///
/// - `Reversible` → R1 `AllowAndLog` (budget irrelevant).
/// - `Costly` → R2 `AllowUnderBudget` **iff** `budget_has_headroom`, else it
///   escalates to R3 `RequireApproval` (the budget is exhausted).
/// - `Irreversible` → R3 `RequireApproval` (budget irrelevant).
pub fn graduated_response(rev: Reversibility, budget_has_headroom: bool) -> ResponseLevel {
    match rev {
        Reversibility::Reversible => ResponseLevel::AllowAndLog,
        Reversibility::Costly => {
            if budget_has_headroom {
                ResponseLevel::AllowUnderBudget
            } else {
                ResponseLevel::RequireApproval
            }
        }
        Reversibility::Irreversible => ResponseLevel::RequireApproval,
    }
}

/// Restrictiveness rank — lower is more restrictive. Mirrors the crate's
/// `Deny > RequiresApproval > Allow` precedence so the reversibility ladder
/// composes with the allowlist decision the same way every other gate does.
fn restrictiveness(kind: PolicyDecisionKind) -> u8 {
    match kind {
        PolicyDecisionKind::Deny => 0,
        PolicyDecisionKind::RequiresApproval => 1,
        PolicyDecisionKind::AllowWithWarning => 2,
        PolicyDecisionKind::Allow => 3,
    }
}

/// Combine the allowlist's base decision with the reversibility rung,
/// **more-restrictive-wins**. The reversibility ladder can only *add* friction
/// — it can upgrade an `Allow` to `RequiresApproval`, but can never loosen a
/// `Deny` or an existing approval requirement.
pub fn combine(base: PolicyDecisionKind, level: ResponseLevel) -> PolicyDecisionKind {
    let candidate = level.decision_kind();
    if restrictiveness(candidate) < restrictiveness(base) {
        candidate
    } else {
        base
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_irreversible() {
        assert_eq!(Reversibility::default(), Reversibility::Irreversible);
    }

    #[test]
    fn parse_unknown_defaults_to_irreversible() {
        assert_eq!(
            Reversibility::parse("reversible"),
            Reversibility::Reversible
        );
        assert_eq!(Reversibility::parse("COSTLY"), Reversibility::Costly);
        assert_eq!(
            Reversibility::parse("irreversible"),
            Reversibility::Irreversible
        );
        assert_eq!(
            Reversibility::parse("nonsense"),
            Reversibility::Irreversible
        );
        assert_eq!(Reversibility::parse(""), Reversibility::Irreversible);
        assert_eq!(
            "garbage".parse::<Reversibility>().unwrap(),
            Reversibility::Irreversible
        );
    }

    #[test]
    fn ladder_reversible_is_r1_allow_and_log() {
        // Budget state is irrelevant for a reversible action.
        assert_eq!(
            graduated_response(Reversibility::Reversible, true),
            ResponseLevel::AllowAndLog
        );
        assert_eq!(
            graduated_response(Reversibility::Reversible, false),
            ResponseLevel::AllowAndLog
        );
    }

    #[test]
    fn ladder_irreversible_is_r3_require_approval() {
        assert_eq!(
            graduated_response(Reversibility::Irreversible, true),
            ResponseLevel::RequireApproval
        );
    }

    #[test]
    fn ladder_costly_flips_to_approval_when_budget_exhausted() {
        // R2 while there's headroom...
        assert_eq!(
            graduated_response(Reversibility::Costly, true),
            ResponseLevel::AllowUnderBudget
        );
        // ...escalates to R3 once the budget is exhausted.
        assert_eq!(
            graduated_response(Reversibility::Costly, false),
            ResponseLevel::RequireApproval
        );
    }

    #[test]
    fn response_level_wire_and_rung_labels() {
        assert_eq!(ResponseLevel::AllowAndLog.as_str(), "allow_and_log");
        assert_eq!(
            ResponseLevel::AllowUnderBudget.as_str(),
            "allow_under_budget"
        );
        assert_eq!(ResponseLevel::RequireApproval.as_str(), "require_approval");
        assert_eq!(ResponseLevel::AllowAndLog.rung(), "R1");
        assert_eq!(ResponseLevel::AllowUnderBudget.rung(), "R2");
        assert_eq!(ResponseLevel::RequireApproval.rung(), "R3");
    }

    #[test]
    fn to_policy_decision_maps_rungs() {
        assert!(ResponseLevel::AllowAndLog
            .to_policy_decision("r1")
            .is_allowed());
        assert!(ResponseLevel::AllowUnderBudget
            .to_policy_decision("r2")
            .is_allowed());
        assert!(ResponseLevel::RequireApproval
            .to_policy_decision("r3")
            .needs_approval());
    }

    #[test]
    fn combine_adds_friction_but_never_loosens() {
        // Irreversible upgrades a plain Allow to RequiresApproval.
        assert_eq!(
            combine(PolicyDecisionKind::Allow, ResponseLevel::RequireApproval),
            PolicyDecisionKind::RequiresApproval
        );
        // A reversible R1 cannot loosen an allowlist Deny.
        assert_eq!(
            combine(PolicyDecisionKind::Deny, ResponseLevel::AllowAndLog),
            PolicyDecisionKind::Deny
        );
        // ...nor loosen an existing approval requirement.
        assert_eq!(
            combine(
                PolicyDecisionKind::RequiresApproval,
                ResponseLevel::AllowAndLog
            ),
            PolicyDecisionKind::RequiresApproval
        );
        // R2 (allow) leaves a base Allow as Allow.
        assert_eq!(
            combine(PolicyDecisionKind::Allow, ResponseLevel::AllowUnderBudget),
            PolicyDecisionKind::Allow
        );
    }

    #[test]
    fn serde_snake_case_round_trip() {
        for r in [
            Reversibility::Reversible,
            Reversibility::Costly,
            Reversibility::Irreversible,
        ] {
            let json = serde_json::to_string(&r).unwrap();
            assert_eq!(json, format!("\"{}\"", r.as_str()));
            let back: Reversibility = serde_json::from_str(&json).unwrap();
            assert_eq!(back, r);
        }
    }
}
