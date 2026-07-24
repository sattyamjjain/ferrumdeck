//! Runnable demo: the x402 spend gate halting an autonomous over-budget payment.
//!
//! The "governed vs ungoverned" story, extended from tool calls to **autonomous
//! payments**. An agent works a paywalled x402 endpoint that answers HTTP
//! `402 Payment Required` with a stablecoin price quote. Run the same fixed
//! workload two ways:
//!
//! - **Ungoverned:** the agent pays every quote it's handed. It sails past its
//!   per-agent budget — nothing is in the path to stop it.
//! - **Governed:** FerrumDeck's spend gate prices each 402 quote in cents and
//!   checks it against the *remaining* budget **before** the payment is
//!   authorized. The call that would breach the ceiling is **hard-stopped**
//!   (deny + one alert), before any money would move.
//!
//! This never moves money. It parses simulated 402 challenge bodies, prices
//! them, and gates them. There is no wallet, no chain, no settlement here — the
//! gate returns an authorize/deny *decision* and stops there.
//!
//! Run it:
//! ```text
//! cargo run -p ferrumdeck --example x402_spend_gate
//! ```
//! It exits non-zero if the gate ever fails to block the over-budget payment, so
//! it's a hard pass/fail, not a screenshot to trust.

use std::process::ExitCode;

use ferrumdeck::budget::{Budget, BudgetUsage};
use ferrumdeck::{evaluate_x402_payment, X402Challenge, X402GateOutcome};

/// A fixed, paywalled x402 endpoint's price quotes (USDC on base-sepolia), as an
/// agent would receive them in successive `402 Payment Required` bodies. Amounts
/// are atomic USDC (6 decimals): 1_000_000 == $1.00 == 100¢.
fn workload() -> Vec<(&'static str, serde_json::Value)> {
    vec![
        ("premium-search  ", quote_402("300000")), // $0.30 → 30¢
        ("dataset-page-1  ", quote_402("250000")), // $0.25 → 25¢
        ("dataset-page-2  ", quote_402("250000")), // $0.25 → 25¢
        ("dataset-page-3  ", quote_402("400000")), // $0.40 → 40¢  ← would breach
        ("dataset-page-4  ", quote_402("250000")), // $0.25 → 25¢  (never reached, governed)
    ]
}

/// Build a faithful-shape x402 `402 Payment Required` body quoting `atomic`
/// USDC under the canonical `exact` scheme.
fn quote_402(atomic: &str) -> serde_json::Value {
    serde_json::json!({
        "x402Version": 1,
        "error": "payment required",
        "accepts": [{
            "scheme": "exact",
            "network": "base-sepolia",
            "maxAmountRequired": atomic,
            "resource": "https://data.example.com/paywalled",
            "payTo": "0xA11ce0000000000000000000000000000000cafe",
            "asset": "0xUSDC00000000000000000000000000000000f00d",
            "extra": { "name": "USDC", "decimals": 6 }
        }]
    })
}

fn main() -> ExitCode {
    // Per-agent budget: $1.00 cost cap, with 10¢ of inference (token) cost
    // already on the ledger — so paid-API calls share the same ceiling as the
    // model spend, not a separate pool.
    let budget = Budget {
        max_cost_cents: Some(100),
        ..Budget::default()
    };
    const STARTING_TOKEN_COST: u64 = 10;

    println!("x402 spend gate — governed vs ungoverned autonomous payments");
    println!("=============================================================");
    println!(
        "Per-agent budget: {}¢ cost cap · {STARTING_TOKEN_COST}¢ already spent on inference\n",
        budget.max_cost_cents.unwrap()
    );

    // ---- Ungoverned: pay everything, no gate in the path ------------------
    println!("UNGOVERNED (no spend gate) — the agent pays every quote:");
    let mut ungoverned = STARTING_TOKEN_COST;
    for (label, body) in workload() {
        let ch = X402Challenge::from_body(&body).expect("valid quote");
        let ev = ch.to_cost_event().expect("priceable");
        ungoverned += ev.cost_cents;
        let flag = if ungoverned > 100 {
            "  ← OVER BUDGET"
        } else {
            ""
        };
        println!(
            "  pay {label} {:>3}¢  → run cost {:>3}¢{flag}",
            ev.cost_cents, ungoverned
        );
    }
    let overshoot = ungoverned.saturating_sub(100);
    println!(
        "  → ungoverned final spend: {ungoverned}¢ ({overshoot}¢ over the {}¢ budget)\n",
        100
    );

    // ---- Governed: the gate checks each quote before authorizing ----------
    println!("GOVERNED (x402 spend gate in the path) — checked before paying:");
    let mut usage = BudgetUsage {
        cost_cents: STARTING_TOKEN_COST,
        ..BudgetUsage::default()
    };
    let mut blocked_over_budget = false;
    let mut alerts = 0usize;

    for (label, body) in workload() {
        let ch = X402Challenge::from_body(&body).expect("valid quote");
        match evaluate_x402_payment(&ch, &budget, &usage) {
            X402GateOutcome::Authorize {
                event,
                budget_remaining_cents,
            } => {
                // Authorized: "settle" the (simulated) payment and fold its cost
                // into the same ledger as token spend, so the cost slope tracks
                // autonomous payments too.
                event.apply_to(&mut usage);
                println!(
                    "  AUTHORIZE {label} {:>3}¢  → run cost {:>3}¢ · {} remaining",
                    event.cost_cents,
                    usage.cost_cents,
                    budget_remaining_cents
                        .map(|r| format!("{r}¢"))
                        .unwrap_or_else(|| "∞".into()),
                );
            }
            outcome @ (X402GateOutcome::Deny { .. } | X402GateOutcome::DenyUnpriceable { .. }) => {
                // Hard stop — before any payment is authorized. Exactly one alert.
                if let Some(alert) = outcome.alert_line() {
                    println!("  DENY      {label}      🛑  {alert}");
                    alerts += 1;
                }
                blocked_over_budget = matches!(outcome, X402GateOutcome::Deny { .. });
                println!(
                    "  → run halted at {}¢ spend; the over-budget payment never settled.",
                    usage.cost_cents
                );
                break;
            }
        }
    }

    println!();
    println!("Result: governed run stopped at {}¢ (≤ {}¢ cap); ungoverned would have paid {ungoverned}¢.",
        usage.cost_cents, budget.max_cost_cents.unwrap());

    // ---- Self-verify: the gate MUST have blocked the over-budget payment ---
    if blocked_over_budget && alerts == 1 && usage.cost_cents <= budget.max_cost_cents.unwrap() {
        println!("DEMO OK ✓  spend gate blocked the over-budget payment (1 alert), budget never breached.");
        ExitCode::SUCCESS
    } else {
        eprintln!(
            "DEMO FAILED ✗  expected exactly one hard stop under the cap \
             (blocked={blocked_over_budget}, alerts={alerts}, spend={}¢)",
            usage.cost_cents
        );
        ExitCode::FAILURE
    }
}
