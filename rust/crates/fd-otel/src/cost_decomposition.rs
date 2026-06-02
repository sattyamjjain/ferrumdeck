//! Debt-vs-tax cost decomposition (§2605.27320).
//!
//! Mirrors the Python `fd_evals.cost_decomposition` shape so a span tagged
//! by the Rust gateway and a breakdown computed by the Python eval plane
//! read the same OTel attribute keys. The struct here is intentionally
//! minimal: it carries just the role classification + the per-call cost,
//! enough to record the per-span tag and produce the run-level rollup.

use serde::{Deserialize, Serialize};
use tracing::Span;

use crate::genai::attrs;

/// Stable anchor surfaced on the dashboard tooltip and in the runbook.
pub const COST_DECOMPOSITION_ANCHOR: &str = "§2605.27320";

/// Role classification for a single LLM or tool call.
///
/// Seven canonical values from the anchor paper. Only [`SpanRole::Primary`]
/// contributes to `agent.cost.token` (debt); every other variant contributes
/// to `agent.cost.tax`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SpanRole {
    Primary,
    Retry,
    Judge,
    Guardrail,
    Escalation,
    Revalidation,
    Monitor,
}

impl SpanRole {
    pub fn as_str(self) -> &'static str {
        match self {
            SpanRole::Primary => "primary",
            SpanRole::Retry => "retry",
            SpanRole::Judge => "judge",
            SpanRole::Guardrail => "guardrail",
            SpanRole::Escalation => "escalation",
            SpanRole::Revalidation => "revalidation",
            SpanRole::Monitor => "monitor",
        }
    }

    /// True for any role that contributes to `agent.cost.tax`.
    pub fn is_tax(self) -> bool {
        !matches!(self, SpanRole::Primary)
    }
}

/// Run-level rollup recorded on the run-completion span.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct CostBreakdown {
    /// Sum of primary-call costs (debt).
    pub token_cost_cents: f64,
    /// Sum of every non-primary-call cost (tax).
    pub tax_cost_cents: f64,
}

impl CostBreakdown {
    pub fn total_cost_cents(&self) -> f64 {
        self.token_cost_cents + self.tax_cost_cents
    }

    /// `tax / (token + tax)` ∈ `[0.0, 1.0]`. Returns `0.0` on an empty
    /// breakdown so absence-of-data never reads as 100% tax.
    pub fn tax_share(&self) -> f64 {
        let total = self.total_cost_cents();
        if total <= 0.0 {
            0.0
        } else {
            self.tax_cost_cents / total
        }
    }

    /// Aggregate per-call costs into a breakdown. Pure — same input,
    /// same output.
    pub fn from_calls<I: IntoIterator<Item = (SpanRole, f64)>>(calls: I) -> Self {
        let mut token = 0.0;
        let mut tax = 0.0;
        for (role, cost) in calls {
            if role.is_tax() {
                tax += cost;
            } else {
                token += cost;
            }
        }
        Self {
            token_cost_cents: token,
            tax_cost_cents: tax,
        }
    }
}

/// Tag a [`tracing::Span`] with the per-call role. Mirrors the Python
/// `cost_decomposition.cost_breakdown_to_otel_attrs` keys.
pub fn record_call_role(span: &Span, role: SpanRole) {
    span.record(attrs::FERRUMDECK_COST_ROLE, role.as_str());
}

/// Tag a [`tracing::Span`] with the run-level breakdown. Use on the
/// run-completion span so Jaeger can rank runs by `tax_share`.
pub fn record_cost_breakdown(span: &Span, breakdown: &CostBreakdown) {
    span.record(
        attrs::FERRUMDECK_COST_TOKEN_CENTS,
        breakdown.token_cost_cents,
    );
    span.record(attrs::FERRUMDECK_COST_TAX_CENTS, breakdown.tax_cost_cents);
    span.record(attrs::FERRUMDECK_COST_TAX_SHARE, breakdown.tax_share());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn primary_is_the_only_debt_role() {
        for role in [
            SpanRole::Primary,
            SpanRole::Retry,
            SpanRole::Judge,
            SpanRole::Guardrail,
            SpanRole::Escalation,
            SpanRole::Revalidation,
            SpanRole::Monitor,
        ] {
            assert_eq!(role.is_tax(), role != SpanRole::Primary);
        }
    }

    #[test]
    fn empty_breakdown_has_zero_tax_share() {
        let bd = CostBreakdown::from_calls(std::iter::empty::<(SpanRole, f64)>());
        assert_eq!(bd.tax_share(), 0.0);
        assert_eq!(bd.total_cost_cents(), 0.0);
    }

    #[test]
    fn all_primary_calls_yield_zero_tax_share() {
        let bd = CostBreakdown::from_calls([(SpanRole::Primary, 1.5), (SpanRole::Primary, 2.5)]);
        assert_eq!(bd.token_cost_cents, 4.0);
        assert_eq!(bd.tax_cost_cents, 0.0);
        assert_eq!(bd.tax_share(), 0.0);
    }

    #[test]
    fn all_tax_calls_yield_unit_tax_share() {
        let bd = CostBreakdown::from_calls([
            (SpanRole::Retry, 0.5),
            (SpanRole::Judge, 0.5),
            (SpanRole::Monitor, 1.0),
        ]);
        assert_eq!(bd.token_cost_cents, 0.0);
        assert_eq!(bd.tax_cost_cents, 2.0);
        assert_eq!(bd.tax_share(), 1.0);
    }

    #[test]
    fn mixed_breakdown_reports_fractional_tax_share() {
        // 1 token + 3 tax → 0.75 tax_share.
        let bd = CostBreakdown::from_calls([
            (SpanRole::Primary, 1.0),
            (SpanRole::Retry, 1.0),
            (SpanRole::Judge, 1.0),
            (SpanRole::Revalidation, 1.0),
        ]);
        assert_eq!(bd.token_cost_cents, 1.0);
        assert_eq!(bd.tax_cost_cents, 3.0);
        assert!((bd.tax_share() - 0.75).abs() < 1e-9);
    }

    #[test]
    fn role_serialises_snake_case() {
        for (role, expected) in [
            (SpanRole::Primary, "\"primary\""),
            (SpanRole::Revalidation, "\"revalidation\""),
            (SpanRole::Guardrail, "\"guardrail\""),
        ] {
            assert_eq!(serde_json::to_string(&role).unwrap(), expected);
        }
    }

    #[test]
    fn breakdown_round_trips_through_serde() {
        let bd = CostBreakdown {
            token_cost_cents: 2.5,
            tax_cost_cents: 1.25,
        };
        let json = serde_json::to_string(&bd).unwrap();
        let parsed: CostBreakdown = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, bd);
    }

    #[test]
    fn record_helpers_accept_real_span() {
        // Disabled span absorbs records cleanly; guards against a typo in
        // the constant names.
        let span = tracing::Span::none();
        record_call_role(&span, SpanRole::Retry);
        record_cost_breakdown(
            &span,
            &CostBreakdown {
                token_cost_cents: 1.0,
                tax_cost_cents: 2.0,
            },
        );
    }
}
