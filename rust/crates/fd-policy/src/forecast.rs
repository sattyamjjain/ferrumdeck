//! Predictive run-budget forecasting.
//!
//! After each step completes, [`compute_forecast`] projects what the run's
//! total cost (and tool-call / wall-time consumption) will be at completion,
//! and flags `budget_breach_projected = true` if any axis is on track to
//! exceed the cap before the run terminates.
//!
//! Two projections are produced:
//!
//! * **Linear** — extrapolates from current cost/rate against the binding
//!   axis (wall-time if capped, else tool-calls, else current cost).
//! * **EWMA** — exponentially-weighted-moving-average of per-step cost, used
//!   to dampen single-step spikes. The EWMA state is carried across steps
//!   via [`ForecastInputs::prior_ewma_step_cost_cents`].
//!
//! All math is deterministic via [`rust_decimal::Decimal`] — no ML
//! dependency at this layer.

use rust_decimal::prelude::*;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::budget::Budget;

/// EWMA smoothing factor (α) applied to the most recent step's cost.
///
/// Numerator/denominator form keeps the math deterministic in decimal.
const EWMA_ALPHA_NUM: u64 = 3;
const EWMA_ALPHA_DEN: u64 = 10;

/// Inputs gathered just after a step completes.
#[derive(Debug, Clone)]
pub struct ForecastInputs {
    /// Cumulative cost spent so far on the run (in cents).
    pub cost_so_far_cents: u64,
    /// Number of tool calls consumed so far.
    pub tool_calls_so_far: u32,
    /// Wall-time elapsed since the run started (in milliseconds).
    pub wall_time_ms_so_far: u64,
    /// Number of completed steps (used as the divisor for per-step EWMA).
    pub steps_completed: u32,
    /// Cost in cents incurred by the step that just completed.
    pub step_cost_cents: u64,
    /// Carry-over of the per-step EWMA in cents. `None` when this is the
    /// first step (the EWMA is then seeded from `step_cost_cents`).
    pub prior_ewma_step_cost_cents: Option<u64>,
}

/// Axis that is projected to exceed its configured cap first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BreachKind {
    CostCents,
    ToolCalls,
    WallTime,
}

/// Output of [`compute_forecast`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ForecastSnapshot {
    /// Linear projection of end-of-run cost in cents.
    pub projected_cost_cents: u64,
    /// EWMA-smoothed projection of end-of-run cost in cents.
    pub ewma_cost_cents: u64,
    /// Updated EWMA per-step cost (carry forward for the next step).
    pub ewma_step_cost_cents: u64,
    /// `true` when any axis is projected to exceed its cap before the run
    /// can terminate.
    pub budget_breach_projected: bool,
    /// Which axis triggered the breach projection, if any.
    pub breach_kind: Option<BreachKind>,
}

/// Compute a forecast snapshot for the run.
pub fn compute_forecast(inputs: ForecastInputs, budget: &Budget) -> ForecastSnapshot {
    let projected_cost_cents = linear_projection(&inputs, budget);
    let ewma_step_cost_cents = update_ewma(&inputs);
    let ewma_cost_cents = ewma_projection(&inputs, budget, ewma_step_cost_cents);

    let breach_kind = projected_breach(projected_cost_cents, ewma_cost_cents, &inputs, budget);

    ForecastSnapshot {
        projected_cost_cents,
        ewma_cost_cents,
        ewma_step_cost_cents,
        budget_breach_projected: breach_kind.is_some(),
        breach_kind,
    }
}

/// Linear projection: extrapolate end-of-run cost from the rate against the
/// binding axis. Picks the most-aggressively-burning ratio across cost,
/// tool-calls, and wall-time so the projection is conservative.
fn linear_projection(inputs: &ForecastInputs, budget: &Budget) -> u64 {
    let cost = Decimal::from(inputs.cost_so_far_cents);
    if cost.is_zero() {
        return inputs.cost_so_far_cents;
    }

    // Compute the largest "fraction of axis consumed" across the configured caps.
    // The most-burned axis is the binding constraint; project total cost as
    // `cost_so_far / fraction_consumed`.
    let mut max_fraction: Option<Decimal> = None;

    if let Some(cap) = budget.max_cost_cents {
        if let Some(f) = fraction(inputs.cost_so_far_cents, cap) {
            max_fraction = max_decimal(max_fraction, f);
        }
    }
    if let Some(cap) = budget.max_tool_calls {
        if let Some(f) = fraction(inputs.tool_calls_so_far as u64, cap as u64) {
            max_fraction = max_decimal(max_fraction, f);
        }
    }
    if let Some(cap) = budget.max_wall_time_ms {
        if let Some(f) = fraction(inputs.wall_time_ms_so_far, cap) {
            max_fraction = max_decimal(max_fraction, f);
        }
    }

    match max_fraction {
        Some(frac) if frac > Decimal::ZERO => {
            let projected = cost / frac;
            projected
                .round_dp_with_strategy(0, rust_decimal::RoundingStrategy::AwayFromZero)
                .to_u64()
                .unwrap_or(u64::MAX)
        }
        // No binding axis configured (or no consumption yet) — best estimate is
        // current cost.
        _ => inputs.cost_so_far_cents,
    }
}

/// Update the per-step EWMA carry value. Seeds from `step_cost_cents` on the
/// first step (when no prior is available).
fn update_ewma(inputs: &ForecastInputs) -> u64 {
    let step = Decimal::from(inputs.step_cost_cents);
    let alpha_num = Decimal::from(EWMA_ALPHA_NUM);
    let alpha_den = Decimal::from(EWMA_ALPHA_DEN);

    match inputs.prior_ewma_step_cost_cents {
        None => inputs.step_cost_cents,
        Some(prior) => {
            let prior = Decimal::from(prior);
            // ewma = α * step + (1 - α) * prior
            //      = (α_num * step + (α_den - α_num) * prior) / α_den
            let weighted = alpha_num * step + (alpha_den - alpha_num) * prior;
            (weighted / alpha_den)
                .round_dp_with_strategy(0, rust_decimal::RoundingStrategy::AwayFromZero)
                .to_u64()
                .unwrap_or(prior.to_u64().unwrap_or(0))
        }
    }
}

/// Project remaining cost using EWMA-smoothed per-step cost over the most
/// generous estimate of remaining steps. Falls back to the linear projection
/// when no step-based cap is configured.
fn ewma_projection(inputs: &ForecastInputs, budget: &Budget, ewma_step: u64) -> u64 {
    let remaining_steps = match budget.max_tool_calls {
        Some(cap) if cap > inputs.tool_calls_so_far => (cap - inputs.tool_calls_so_far) as u64,
        _ => return linear_projection(inputs, budget),
    };

    inputs
        .cost_so_far_cents
        .saturating_add(ewma_step.saturating_mul(remaining_steps))
}

/// Decide whether any axis is projected to exceed its cap before the run can
/// terminate. Cost uses the linear projection (conservative). Tool-calls and
/// wall-time use a steady-rate extrapolation.
fn projected_breach(
    projected_cost_cents: u64,
    ewma_cost_cents: u64,
    inputs: &ForecastInputs,
    budget: &Budget,
) -> Option<BreachKind> {
    // Hard facts come before projections: a run that has already burned past
    // its wall-time cap should report WallTime, not a derived cost breach.
    if let Some(cap) = budget.max_wall_time_ms {
        if inputs.wall_time_ms_so_far >= cap {
            return Some(BreachKind::WallTime);
        }
    }

    if let Some(cap) = budget.max_cost_cents {
        if projected_cost_cents > cap || ewma_cost_cents > cap {
            return Some(BreachKind::CostCents);
        }
    }

    if let (Some(cap), Some(rate)) = (
        budget.max_tool_calls,
        per_ms_rate(inputs.tool_calls_so_far as u64, inputs.wall_time_ms_so_far),
    ) {
        if let Some(remaining_ms) = remaining_wall_ms(inputs, budget) {
            let projected_calls = inputs.tool_calls_so_far as u64
                + (rate * Decimal::from(remaining_ms))
                    .round_dp_with_strategy(0, rust_decimal::RoundingStrategy::AwayFromZero)
                    .to_u64()
                    .unwrap_or(0);
            if projected_calls > cap as u64 {
                return Some(BreachKind::ToolCalls);
            }
        }
    }

    None
}

fn fraction(used: u64, cap: u64) -> Option<Decimal> {
    if cap == 0 {
        return None;
    }
    Some(Decimal::from(used) / Decimal::from(cap))
}

fn per_ms_rate(used: u64, elapsed_ms: u64) -> Option<Decimal> {
    if elapsed_ms == 0 {
        return None;
    }
    Some(Decimal::from(used) / Decimal::from(elapsed_ms))
}

fn remaining_wall_ms(inputs: &ForecastInputs, budget: &Budget) -> Option<u64> {
    let cap = budget.max_wall_time_ms?;
    Some(cap.saturating_sub(inputs.wall_time_ms_so_far))
}

fn max_decimal(current: Option<Decimal>, candidate: Decimal) -> Option<Decimal> {
    match current {
        Some(c) if c >= candidate => Some(c),
        _ => Some(candidate),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn small_budget() -> Budget {
        Budget {
            max_input_tokens: None,
            max_output_tokens: None,
            max_total_tokens: None,
            max_tool_calls: Some(10),
            max_wall_time_ms: Some(60_000),
            max_cost_cents: Some(500),
        }
    }

    // -------------------------------------------------------------------------
    // Linear projection
    // -------------------------------------------------------------------------

    #[test]
    fn linear_projects_pro_rata_against_walltime() {
        // Spent $1.00 in 10s of a 60s budget — projected ~$6.00
        let inputs = ForecastInputs {
            cost_so_far_cents: 100,
            tool_calls_so_far: 1,
            wall_time_ms_so_far: 10_000,
            steps_completed: 1,
            step_cost_cents: 100,
            prior_ewma_step_cost_cents: None,
        };
        let snap = compute_forecast(inputs, &small_budget());
        // Tool-call axis is 1/10 burned = 10%; wall-time is 10/60 = 16.7%; cost
        // is 100/500 = 20%. Cost is the binding axis, so projection = 500.
        assert_eq!(snap.projected_cost_cents, 500);
    }

    #[test]
    fn linear_zero_cost_stays_zero() {
        let inputs = ForecastInputs {
            cost_so_far_cents: 0,
            tool_calls_so_far: 0,
            wall_time_ms_so_far: 0,
            steps_completed: 0,
            step_cost_cents: 0,
            prior_ewma_step_cost_cents: None,
        };
        let snap = compute_forecast(inputs, &small_budget());
        assert_eq!(snap.projected_cost_cents, 0);
        assert!(!snap.budget_breach_projected);
    }

    #[test]
    fn linear_no_budget_returns_cost_so_far() {
        let inputs = ForecastInputs {
            cost_so_far_cents: 250,
            tool_calls_so_far: 3,
            wall_time_ms_so_far: 5_000,
            steps_completed: 3,
            step_cost_cents: 80,
            prior_ewma_step_cost_cents: None,
        };
        let budget = Budget {
            max_input_tokens: None,
            max_output_tokens: None,
            max_total_tokens: None,
            max_tool_calls: None,
            max_wall_time_ms: None,
            max_cost_cents: None,
        };
        let snap = compute_forecast(inputs, &budget);
        assert_eq!(snap.projected_cost_cents, 250);
        assert!(!snap.budget_breach_projected);
    }

    // -------------------------------------------------------------------------
    // EWMA
    // -------------------------------------------------------------------------

    #[test]
    fn ewma_seeds_from_first_step() {
        let inputs = ForecastInputs {
            cost_so_far_cents: 50,
            tool_calls_so_far: 1,
            wall_time_ms_so_far: 5_000,
            steps_completed: 1,
            step_cost_cents: 50,
            prior_ewma_step_cost_cents: None,
        };
        let snap = compute_forecast(inputs, &small_budget());
        assert_eq!(snap.ewma_step_cost_cents, 50);
    }

    #[test]
    fn ewma_converges_under_constant_step_cost() {
        // Feed the same step cost repeatedly — the EWMA should stay at that value.
        let mut ewma = 30u64;
        for _ in 0..10 {
            let inputs = ForecastInputs {
                cost_so_far_cents: 30 * 10,
                tool_calls_so_far: 3,
                wall_time_ms_so_far: 10_000,
                steps_completed: 3,
                step_cost_cents: 30,
                prior_ewma_step_cost_cents: Some(ewma),
            };
            let snap = compute_forecast(inputs, &small_budget());
            ewma = snap.ewma_step_cost_cents;
        }
        assert_eq!(ewma, 30, "EWMA must converge to the constant step cost");
    }

    #[test]
    fn ewma_dampens_single_spike() {
        // Prior steady state 10c/step, then a single 100c spike.
        let inputs = ForecastInputs {
            cost_so_far_cents: 50,
            tool_calls_so_far: 5,
            wall_time_ms_so_far: 5_000,
            steps_completed: 5,
            step_cost_cents: 100,
            prior_ewma_step_cost_cents: Some(10),
        };
        let snap = compute_forecast(inputs, &small_budget());
        // ewma = 0.3 * 100 + 0.7 * 10 = 37
        assert_eq!(snap.ewma_step_cost_cents, 37);
    }

    // -------------------------------------------------------------------------
    // Breach projection
    // -------------------------------------------------------------------------

    #[test]
    fn no_breach_when_well_under_budget() {
        // 25c spent on 1 call halfway through wall-time → projection stays
        // well inside all caps.
        let inputs = ForecastInputs {
            cost_so_far_cents: 25,
            tool_calls_so_far: 1,
            wall_time_ms_so_far: 30_000,
            steps_completed: 1,
            step_cost_cents: 25,
            prior_ewma_step_cost_cents: None,
        };
        let snap = compute_forecast(inputs, &small_budget());
        assert!(!snap.budget_breach_projected);
        assert!(snap.breach_kind.is_none());
    }

    #[test]
    fn breach_flagged_when_projection_exceeds_cost_cap() {
        // 60% burned in 10s of a 60s budget on tool-calls — projection blows
        // through the cost cap.
        let inputs = ForecastInputs {
            cost_so_far_cents: 350,
            tool_calls_so_far: 6,
            wall_time_ms_so_far: 10_000,
            steps_completed: 6,
            step_cost_cents: 50,
            prior_ewma_step_cost_cents: Some(50),
        };
        let snap = compute_forecast(inputs, &small_budget());
        assert!(snap.budget_breach_projected);
        assert_eq!(snap.breach_kind, Some(BreachKind::CostCents));
    }

    #[test]
    fn breach_flagged_when_walltime_already_exceeded() {
        let inputs = ForecastInputs {
            cost_so_far_cents: 100,
            tool_calls_so_far: 1,
            wall_time_ms_so_far: 65_000,
            steps_completed: 1,
            step_cost_cents: 100,
            prior_ewma_step_cost_cents: None,
        };
        let snap = compute_forecast(inputs, &small_budget());
        assert!(snap.budget_breach_projected);
        assert_eq!(snap.breach_kind, Some(BreachKind::WallTime));
    }

    #[test]
    fn breach_flagged_for_runaway_tool_calls() {
        // 4 calls in 10s of a 60s budget = 24-call extrapolated total vs cap 10
        let inputs = ForecastInputs {
            cost_so_far_cents: 50,
            tool_calls_so_far: 4,
            wall_time_ms_so_far: 10_000,
            steps_completed: 4,
            step_cost_cents: 10,
            prior_ewma_step_cost_cents: Some(10),
        };
        let snap = compute_forecast(inputs, &small_budget());
        assert!(snap.budget_breach_projected);
        // Cost projection blows the cap first (50 * 6 = 300 — actually still
        // under 500, so tool-calls should be the binding breach).
        assert_eq!(snap.breach_kind, Some(BreachKind::ToolCalls));
    }

    // -------------------------------------------------------------------------
    // Stability properties
    // -------------------------------------------------------------------------

    #[test]
    fn snapshot_is_serde_round_trip() {
        let snap = ForecastSnapshot {
            projected_cost_cents: 750,
            ewma_cost_cents: 720,
            ewma_step_cost_cents: 60,
            budget_breach_projected: true,
            breach_kind: Some(BreachKind::CostCents),
        };
        let json = serde_json::to_string(&snap).unwrap();
        let back: ForecastSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snap, back);
    }
}
