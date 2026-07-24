//! x402-aware pre-call spend gate — budget enforcement for autonomous payments.
//!
//! FerrumDeck's [`Budget`](crate::budget::Budget) gate already caps token/model
//! spend: the reversibility ladder's R2 rung admits a `Costly` tool call *only
//! while [`Budget::has_cost_headroom`](crate::budget::Budget::has_cost_headroom)
//! returns `true`* (see [`crate::reversibility`]). That covers inference cost.
//! It does **not** cover the new spend category the [x402 protocol][x402] opens
//! up: an agent making an outbound HTTP call to a paywalled endpoint that
//! answers **`402 Payment Required`** and quotes a price the agent is expected
//! to pay (in a stablecoin, over HTTP) before it retries.
//!
//! This module extends the *same* budget gate to that category. Given a parsed
//! 402 challenge, it:
//!
//! 1. **Reads the quoted price** off the challenge (amount, asset, scheme).
//! 2. **Normalizes it to the common budget unit** — cents — so a paid-API call
//!    lands in the exact same `cost_cents` ledger as token cost, and a run's
//!    cost slope includes autonomous payments, not just inference
//!    ([`X402CostEvent`]).
//! 3. **Checks it against the per-agent remaining budget *before* authorizing**
//!    the payment, reusing [`Budget::has_cost_headroom`] — identical semantics
//!    to the R2 token gate.
//! 4. **Hard-stops** (deny + exactly one operator alert) if paying would breach
//!    the ceiling ([`evaluate_x402_payment`] → [`X402GateOutcome::Deny`]).
//!
//! ## Deny-by-default on unpriceable quotes
//!
//! A quote FerrumDeck cannot convert to cents offline — an asset with no known
//! USD peg — is **not** waved through. You cannot check a payment against a
//! cents budget if you cannot price it in cents, so an unpriceable challenge is
//! denied ([`X402GateOutcome::DenyUnpriceable`]). This mirrors the crate's
//! deny-by-default posture everywhere else: the unclassified case is the
//! restrictive case.
//!
//! ## This module never moves money
//!
//! It is a **gate + cost model**, not a wallet. It reads a challenge, prices it,
//! and returns an authorize/deny *decision*. Settlement (signing an `X-PAYMENT`
//! header, broadcasting a transfer) is entirely the caller's concern and lives
//! outside FerrumDeck. Nothing here touches a key, a chain, or a balance.
//!
//! [x402]: https://x402.org

use serde::{Deserialize, Serialize};

use crate::budget::{Budget, BudgetUsage};
use crate::decision::PolicyDecision;

/// Stable anchor recorded alongside an x402 decision so audit consumers can cite
/// the protocol without re-reading docstrings. x402 keys the whole flow on the
/// HTTP `402 Payment Required` status.
pub const X402_ANCHOR: &str = "x402:http-402-payment-required";

/// The HTTP status code the x402 protocol overloads for its payment challenge.
pub const X402_PAYMENT_REQUIRED_STATUS: u16 = 402;

/// A parsed x402 `402 Payment Required` challenge — the price quote an agent
/// must clear before a paywalled call succeeds.
///
/// Built from the JSON an x402 server returns (`{ "x402Version", "accepts":
/// [ requirements… ], "error"? }`) via [`X402Challenge::from_body`], or from a
/// single requirements object via [`X402Challenge::from_requirements`]. Field
/// names track the x402 `PaymentRequirements` shape; the amount is kept in the
/// asset's smallest (atomic) unit, exactly as quoted, so no precision is lost
/// before normalization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct X402Challenge {
    /// Payment scheme, e.g. `"exact"` (the canonical x402 scheme).
    pub scheme: String,
    /// Settlement asset symbol, e.g. `"USDC"`.
    pub asset: String,
    /// Settlement network, e.g. `"base-sepolia"`. Optional — informational.
    pub network: Option<String>,
    /// Quoted amount in the asset's atomic unit (e.g. 6-decimal USDC: `10_000`
    /// == $0.01). Kept exact; normalization to cents happens in
    /// [`X402Challenge::to_cost_event`].
    pub amount_atomic: u128,
    /// Asset decimals used to interpret `amount_atomic` (USDC/USDT/PYUSD = 6,
    /// DAI = 18).
    pub decimals: u32,
    /// Destination address the payment would settle to. Optional; recorded, not
    /// validated.
    pub pay_to: Option<String>,
    /// The paywalled resource URL the 402 guards. Optional.
    pub resource: Option<String>,
}

impl X402Challenge {
    /// Parse the full body of an x402 `402` response
    /// (`{ "x402Version", "accepts": [ … ], "error"? }`), taking the **first**
    /// entry of `accepts` (x402 lists a server's acceptable payment options
    /// most-preferred-first). Returns `None` if the body has no usable
    /// requirements object.
    pub fn from_body(body: &serde_json::Value) -> Option<Self> {
        let first = body.get("accepts").and_then(|a| a.as_array())?.first()?;
        Self::from_requirements(first)
    }

    /// Parse a single x402 `PaymentRequirements` object.
    ///
    /// Reads `scheme` (default `"exact"`), `network`, `payTo`, `resource`, the
    /// atomic amount (`maxAmountRequired` | `amount`, string or number), and the
    /// asset symbol + decimals (from `extra.name`/`extra.decimals`, or the
    /// top-level `asset`/`symbol`/`decimals`). Missing decimals are inferred
    /// from the known-stablecoin table. Returns `None` when no amount can be
    /// read — an unquoted challenge is not a price.
    pub fn from_requirements(req: &serde_json::Value) -> Option<Self> {
        let amount_atomic = req
            .get("maxAmountRequired")
            .or_else(|| req.get("amount"))
            .and_then(parse_atomic_amount)?;

        let extra = req.get("extra");
        let asset = extra
            .and_then(|e| e.get("name"))
            .and_then(|v| v.as_str())
            .or_else(|| req.get("symbol").and_then(|v| v.as_str()))
            .or_else(|| {
                req.get("asset")
                    .and_then(|v| v.as_str())
                    .filter(|s| !is_address(s))
            })
            .unwrap_or("UNKNOWN")
            .to_string();

        let decimals = extra
            .and_then(|e| e.get("decimals"))
            .or_else(|| req.get("decimals"))
            .and_then(|v| v.as_u64())
            .map(|d| d as u32)
            .or_else(|| default_decimals(&asset))
            .unwrap_or(0);

        let scheme = req
            .get("scheme")
            .and_then(|v| v.as_str())
            .unwrap_or("exact")
            .to_string();

        Some(Self {
            scheme,
            asset,
            network: req
                .get("network")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            amount_atomic,
            decimals,
            pay_to: req
                .get("payTo")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            resource: req
                .get("resource")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        })
    }

    /// Normalize the quoted price to a [`X402CostEvent`] in cents — the common
    /// budget unit.
    ///
    /// Only assets with a **known 1:1 USD peg** (the stablecoins in
    /// [`is_usd_pegged`]) can be priced offline. For those,
    /// `cents = ⌈amount_atomic · 100 / 10^decimals⌉`: integer math, **rounded
    /// up**, so a sub-cent quote is never charged as free (which would let a
    /// stream of dust payments slip the budget). Any other asset returns `None`
    /// — see the module's deny-by-default note.
    pub fn to_cost_event(&self) -> Option<X402CostEvent> {
        if !is_usd_pegged(&self.asset) {
            return None;
        }
        let cost_cents = atomic_to_cents_ceil(self.amount_atomic, self.decimals);
        Some(X402CostEvent {
            scheme: self.scheme.clone(),
            asset: self.asset.clone(),
            network: self.network.clone(),
            amount_atomic: self.amount_atomic,
            decimals: self.decimals,
            cost_cents,
            resource: self.resource.clone(),
            pay_to: self.pay_to.clone(),
        })
    }

    /// A short human-readable summary of the quote, for alerts + audit reasons.
    pub fn summary(&self) -> String {
        match &self.network {
            Some(net) => format!(
                "{} {} ({} atomic, {} decimals) on {net} [{}]",
                self.scheme, self.asset, self.amount_atomic, self.decimals, self.scheme
            ),
            None => format!(
                "{} {} ({} atomic, {} decimals)",
                self.scheme, self.asset, self.amount_atomic, self.decimals
            ),
        }
    }
}

/// A settled (or authorized) paid-API cost, normalized to cents — a first-class
/// cost event that rides the **same** `cost_cents` ledger as token cost.
///
/// Fold it into a run's [`BudgetUsage`] with [`X402CostEvent::apply_to`] once a
/// payment is authorized, so the run's cost slope reflects autonomous payments
/// alongside inference. Mirror the fields onto an OTel span with
/// `fd_otel::genai::span_helpers::record_x402_cost` so a paid call is queryable
/// next to its token cost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct X402CostEvent {
    /// Payment scheme the price was quoted under (e.g. `"exact"`).
    pub scheme: String,
    /// Settlement asset symbol (e.g. `"USDC"`).
    pub asset: String,
    /// Settlement network, if the challenge named one.
    pub network: Option<String>,
    /// The quoted amount in the asset's atomic unit (unchanged from the quote).
    pub amount_atomic: u128,
    /// Asset decimals used for the conversion.
    pub decimals: u32,
    /// The quoted price normalized to cents (rounded up). This is what the
    /// budget gate checks and what `apply_to` charges.
    pub cost_cents: u64,
    /// The paywalled resource, if known.
    pub resource: Option<String>,
    /// The destination address, if known.
    pub pay_to: Option<String>,
}

impl X402CostEvent {
    /// Fold this paid-API cost into a run's [`BudgetUsage`], **alongside token
    /// cost**, by adding `cost_cents` to the same ledger the LLM spend uses.
    ///
    /// It intentionally does **not** touch `tool_calls`: an x402 payment rides
    /// an outbound tool call the caller already counts, so incrementing here
    /// would double-count. Saturating add — a run can't wrap its cost ledger.
    pub fn apply_to(&self, usage: &mut BudgetUsage) {
        usage.cost_cents = usage.cost_cents.saturating_add(self.cost_cents);
    }
}

/// The pre-call spend-gate decision for an x402 payment.
///
/// Produced by [`evaluate_x402_payment`] *before* any payment is authorized.
/// `Authorize` is the only variant that lets the paid call proceed; both deny
/// variants hard-stop it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum X402GateOutcome {
    /// The quoted payment fits under the remaining budget — the caller may
    /// authorize it. `budget_remaining_cents` is the headroom that *would*
    /// remain after this payment settles (`None` when no cost cap is set).
    Authorize {
        event: X402CostEvent,
        budget_remaining_cents: Option<u64>,
    },
    /// Paying would breach the per-agent cost ceiling — **hard stop**.
    /// `over_by_cents` is how far over the cap the payment would push spend.
    Deny {
        event: X402CostEvent,
        reason: String,
        over_by_cents: u64,
    },
    /// The quote could not be priced in cents (no known USD peg), so it cannot
    /// be checked against the budget — denied by default.
    DenyUnpriceable { asset: String, reason: String },
}

impl X402GateOutcome {
    /// Whether the paid call may proceed.
    pub fn is_authorized(&self) -> bool {
        matches!(self, X402GateOutcome::Authorize { .. })
    }

    /// The single operator alert to emit on a hard stop, or `None` when the
    /// payment was authorized. Exactly one alert per over-budget (or
    /// unpriceable) quote — the gate is a single pre-call check, so this fires
    /// once, not per retry.
    pub fn alert_line(&self) -> Option<String> {
        match self {
            X402GateOutcome::Authorize { .. } => None,
            X402GateOutcome::Deny {
                event,
                over_by_cents,
                ..
            } => Some(format!(
                "x402 spend gate BLOCKED payment: {}¢ in {} would breach the budget by {over_by_cents}¢ — payment not authorized",
                event.cost_cents, event.asset
            )),
            X402GateOutcome::DenyUnpriceable { asset, reason } => Some(format!(
                "x402 spend gate BLOCKED payment: asset {asset} is unpriceable ({reason}) — payment not authorized"
            )),
        }
    }

    /// Map onto the crate's [`PolicyDecision`] so an x402 verdict flows through
    /// the same allow/deny pipeline as every other gate. `Authorize` → allow;
    /// either deny → deny.
    pub fn to_policy_decision(&self) -> PolicyDecision {
        match self {
            X402GateOutcome::Authorize { event, .. } => PolicyDecision::allow(format!(
                "x402 payment authorized: {}¢ in {} within budget",
                event.cost_cents, event.asset
            )),
            X402GateOutcome::Deny { reason, .. } => PolicyDecision::deny(reason.clone()),
            X402GateOutcome::DenyUnpriceable { reason, .. } => PolicyDecision::deny(reason.clone()),
        }
    }
}

/// The x402 pre-call spend gate: check a quoted payment against the per-agent
/// remaining budget **before** authorizing it.
///
/// This is the token gate's [`Budget::has_cost_headroom`] applied to a paid-API
/// quote instead of a token estimate — same primitive, new spend category. On a
/// priceable quote it authorizes iff `usage.cost_cents + price <= cap`,
/// otherwise it denies with the exact overage. An unpriceable quote is denied by
/// default (see the module docs). Pure and deterministic — no clock, no I/O, no
/// settlement.
pub fn evaluate_x402_payment(
    challenge: &X402Challenge,
    budget: &Budget,
    usage: &BudgetUsage,
) -> X402GateOutcome {
    let Some(event) = challenge.to_cost_event() else {
        return X402GateOutcome::DenyUnpriceable {
            asset: challenge.asset.clone(),
            reason: format!(
                "x402 quote in '{}' has no known USD peg; cannot price against a cents budget (deny-by-default)",
                challenge.asset
            ),
        };
    };

    if budget.has_cost_headroom(usage, event.cost_cents) {
        // Headroom that would remain after this payment settles.
        let budget_remaining_cents = budget
            .max_cost_cents
            .map(|cap| cap.saturating_sub(usage.cost_cents.saturating_add(event.cost_cents)));
        X402GateOutcome::Authorize {
            event,
            budget_remaining_cents,
        }
    } else {
        // Safe because we only land here when a cap exists and is exceeded.
        let cap = budget.max_cost_cents.unwrap_or(0);
        let projected = usage.cost_cents.saturating_add(event.cost_cents);
        let over_by_cents = projected.saturating_sub(cap);
        let reason = format!(
            "x402 spend gate: paying {}¢ ({} {}) would push run cost to {projected}¢ over the {cap}¢ budget (by {over_by_cents}¢)",
            event.cost_cents, event.amount_atomic, event.asset
        );
        X402GateOutcome::Deny {
            event,
            reason,
            over_by_cents,
        }
    }
}

// =============================================================================
// Normalization helpers
// =============================================================================

/// Known USD-pegged stablecoins (1 whole token == $1.00). Symbol-cased loosely.
fn is_usd_pegged(symbol: &str) -> bool {
    matches!(
        symbol.trim().to_ascii_uppercase().as_str(),
        "USDC" | "USDC.E" | "USDT" | "DAI" | "PYUSD" | "USDP" | "GUSD" | "USDG" | "OUSD"
    )
}

/// Default decimals for known stablecoins, when the challenge omits them.
fn default_decimals(symbol: &str) -> Option<u32> {
    match symbol.trim().to_ascii_uppercase().as_str() {
        "USDC" | "USDC.E" | "USDT" | "PYUSD" | "USDP" | "GUSD" | "USDG" | "OUSD" => Some(6),
        "DAI" => Some(18),
        _ => None,
    }
}

/// Convert an atomic stablecoin amount to cents, **rounding up**. For a
/// USD-pegged token, `whole_tokens = atomic / 10^decimals` dollars, so
/// `cents = ⌈atomic · 100 / 10^decimals⌉`. u128 math throughout; saturates to
/// `u64::MAX` on the (absurd) overflow case rather than wrapping.
fn atomic_to_cents_ceil(amount_atomic: u128, decimals: u32) -> u64 {
    // 10^decimals; saturate to keep the function total for pathological inputs.
    let divisor = 10u128.checked_pow(decimals).unwrap_or(u128::MAX);
    let numerator = amount_atomic.saturating_mul(100);
    // Ceil division.
    let cents = numerator.div_ceil(divisor);
    cents.min(u64::MAX as u128) as u64
}

/// Read an atomic amount that x402 encodes as either a decimal string (the spec
/// default for large integers) or a JSON number.
fn parse_atomic_amount(v: &serde_json::Value) -> Option<u128> {
    if let Some(s) = v.as_str() {
        s.trim().parse::<u128>().ok()
    } else {
        v.as_u64().map(u128::from)
    }
}

/// Heuristic: does this string look like a 0x contract address (so it's the
/// asset *address*, not a human symbol we can peg)?
fn is_address(s: &str) -> bool {
    let s = s.trim();
    s.starts_with("0x") && s.len() >= 6
}

#[cfg(test)]
mod tests {
    use super::*;

    fn budget_with_cap(cap: u64) -> Budget {
        Budget {
            max_cost_cents: Some(cap),
            ..Budget::default()
        }
    }

    fn usdc_body(atomic: &str) -> serde_json::Value {
        // A faithful-shape x402 402 body (USDC on base-sepolia, "exact" scheme).
        serde_json::json!({
            "x402Version": 1,
            "error": "payment required",
            "accepts": [{
                "scheme": "exact",
                "network": "base-sepolia",
                "maxAmountRequired": atomic,
                "resource": "https://api.example.com/paywalled",
                "payTo": "0xabc0000000000000000000000000000000000001",
                "asset": "0xUSDCcontractaddress0000000000000000000000",
                "extra": { "name": "USDC", "decimals": 6 }
            }]
        })
    }

    #[test]
    fn parses_x402_body_first_accepts_entry() {
        // 10_000 atomic USDC (6 dp) = $0.01 = 1 cent.
        let ch = X402Challenge::from_body(&usdc_body("10000")).expect("parse");
        assert_eq!(ch.scheme, "exact");
        assert_eq!(ch.asset, "USDC");
        assert_eq!(ch.network.as_deref(), Some("base-sepolia"));
        assert_eq!(ch.amount_atomic, 10_000);
        assert_eq!(ch.decimals, 6);
        assert_eq!(
            ch.resource.as_deref(),
            Some("https://api.example.com/paywalled")
        );
    }

    #[test]
    fn normalizes_usdc_atomic_to_cents_rounding_up() {
        // $0.01 exactly → 1 cent.
        let ev = X402Challenge::from_body(&usdc_body("10000"))
            .unwrap()
            .to_cost_event()
            .unwrap();
        assert_eq!(ev.cost_cents, 1);

        // $1.00 → 100 cents.
        let ev = X402Challenge::from_body(&usdc_body("1000000"))
            .unwrap()
            .to_cost_event()
            .unwrap();
        assert_eq!(ev.cost_cents, 100);

        // A sub-cent dust quote (1 atomic = $0.000001) must round UP to 1 cent,
        // never floor to 0 — else a stream of dust payments slips the budget.
        let ev = X402Challenge::from_body(&usdc_body("1"))
            .unwrap()
            .to_cost_event()
            .unwrap();
        assert_eq!(ev.cost_cents, 1);

        // $0.015 → 2 cents (ceil), not 1.
        let ev = X402Challenge::from_body(&usdc_body("15000"))
            .unwrap()
            .to_cost_event()
            .unwrap();
        assert_eq!(ev.cost_cents, 2);
    }

    #[test]
    fn gate_authorizes_a_payment_that_fits() {
        // Cap 100¢, 40¢ already spent (token cost). A 50¢ paid call fits: 90<=100.
        let budget = budget_with_cap(100);
        let usage = BudgetUsage {
            cost_cents: 40,
            ..BudgetUsage::default()
        };
        let ch = X402Challenge::from_body(&usdc_body("500000")).unwrap(); // $0.50
        let outcome = evaluate_x402_payment(&ch, &budget, &usage);
        match outcome {
            X402GateOutcome::Authorize {
                event,
                budget_remaining_cents,
            } => {
                assert_eq!(event.cost_cents, 50);
                assert_eq!(budget_remaining_cents, Some(10)); // 100 - (40+50)
            }
            other => panic!("expected authorize, got {other:?}"),
        }
        assert!(evaluate_x402_payment(&ch, &budget, &usage).is_authorized());
        assert!(evaluate_x402_payment(&ch, &budget, &usage)
            .alert_line()
            .is_none());
    }

    #[test]
    fn gate_hard_stops_a_payment_that_breaches_the_ceiling() {
        // Cap 100¢, 80¢ spent. A 50¢ paid call would push to 130¢ → deny by 30¢.
        let budget = budget_with_cap(100);
        let usage = BudgetUsage {
            cost_cents: 80,
            ..BudgetUsage::default()
        };
        let ch = X402Challenge::from_body(&usdc_body("500000")).unwrap(); // $0.50
        let outcome = evaluate_x402_payment(&ch, &budget, &usage);
        match &outcome {
            X402GateOutcome::Deny {
                event,
                over_by_cents,
                reason,
            } => {
                assert_eq!(event.cost_cents, 50);
                assert_eq!(*over_by_cents, 30);
                assert!(reason.contains("130")); // projected spend
            }
            other => panic!("expected deny, got {other:?}"),
        }
        // Hard stop maps to a policy Deny + exactly one alert.
        assert!(outcome.to_policy_decision().is_denied());
        assert!(outcome.alert_line().unwrap().contains("30¢"));
    }

    #[test]
    fn boundary_exactly_at_cap_is_authorized() {
        // 50¢ spent + 50¢ payment == 100¢ cap → fits (<= is headroom).
        let budget = budget_with_cap(100);
        let usage = BudgetUsage {
            cost_cents: 50,
            ..BudgetUsage::default()
        };
        let ch = X402Challenge::from_body(&usdc_body("500000")).unwrap();
        let outcome = evaluate_x402_payment(&ch, &budget, &usage);
        assert!(outcome.is_authorized());
        if let X402GateOutcome::Authorize {
            budget_remaining_cents,
            ..
        } = outcome
        {
            assert_eq!(budget_remaining_cents, Some(0));
        }
    }

    #[test]
    fn unpriceable_asset_is_denied_by_default() {
        // A non-stablecoin asset has no offline USD peg → deny, don't guess.
        let body = serde_json::json!({
            "accepts": [{
                "scheme": "exact",
                "maxAmountRequired": "1000000000000000000",
                "extra": { "name": "WETH", "decimals": 18 }
            }]
        });
        let ch = X402Challenge::from_body(&body).unwrap();
        assert_eq!(ch.asset, "WETH");
        assert!(ch.to_cost_event().is_none());
        let outcome =
            evaluate_x402_payment(&ch, &budget_with_cap(100_000), &BudgetUsage::default());
        match &outcome {
            X402GateOutcome::DenyUnpriceable { asset, .. } => assert_eq!(asset, "WETH"),
            other => panic!("expected unpriceable deny, got {other:?}"),
        }
        assert!(outcome.to_policy_decision().is_denied());
        assert!(outcome.alert_line().is_some());
    }

    #[test]
    fn no_cost_cap_authorizes_and_reports_unbounded() {
        // has_cost_headroom is true when no cap is set → authorize, remaining None.
        let budget = Budget {
            max_cost_cents: None,
            ..Budget::default()
        };
        let ch = X402Challenge::from_body(&usdc_body("999999999")).unwrap();
        let outcome = evaluate_x402_payment(&ch, &budget, &BudgetUsage::default());
        match outcome {
            X402GateOutcome::Authorize {
                budget_remaining_cents,
                ..
            } => assert_eq!(budget_remaining_cents, None),
            other => panic!("expected authorize, got {other:?}"),
        }
    }

    #[test]
    fn apply_to_folds_paid_cost_into_the_same_ledger_as_tokens() {
        // The run's cost slope must include paid-API calls, not just inference.
        let mut usage = BudgetUsage {
            cost_cents: 30, // token cost so far
            ..BudgetUsage::default()
        };
        let ev = X402Challenge::from_body(&usdc_body("500000"))
            .unwrap()
            .to_cost_event()
            .unwrap(); // 50¢
        ev.apply_to(&mut usage);
        assert_eq!(usage.cost_cents, 80); // 30 token + 50 paid, one ledger
                                          // Tool-call count is the caller's concern; apply_to leaves it alone.
        assert_eq!(usage.tool_calls, 0);
    }

    #[test]
    fn parses_amount_as_json_number_and_string() {
        let as_number = serde_json::json!({
            "accepts": [{ "maxAmountRequired": 1000000u64, "extra": { "name": "USDC", "decimals": 6 } }]
        });
        let as_string = serde_json::json!({
            "accepts": [{ "maxAmountRequired": "1000000", "extra": { "name": "USDC", "decimals": 6 } }]
        });
        assert_eq!(
            X402Challenge::from_body(&as_number).unwrap().amount_atomic,
            1_000_000
        );
        assert_eq!(
            X402Challenge::from_body(&as_string).unwrap().amount_atomic,
            1_000_000
        );
    }

    #[test]
    fn infers_decimals_from_known_symbol_when_omitted() {
        // No `decimals` in the challenge → inferred from the USDC table (6).
        let body = serde_json::json!({
            "accepts": [{ "maxAmountRequired": "2000000", "symbol": "USDC" }]
        });
        let ch = X402Challenge::from_body(&body).unwrap();
        assert_eq!(ch.decimals, 6);
        assert_eq!(ch.to_cost_event().unwrap().cost_cents, 200); // $2.00
    }

    #[test]
    fn body_without_accepts_is_none() {
        assert!(X402Challenge::from_body(&serde_json::json!({"error": "nope"})).is_none());
        assert!(X402Challenge::from_body(&serde_json::json!({"accepts": []})).is_none());
    }

    #[test]
    fn challenge_round_trips_through_serde() {
        let ch = X402Challenge::from_body(&usdc_body("250000")).unwrap();
        let json = serde_json::to_string(&ch).unwrap();
        let back: X402Challenge = serde_json::from_str(&json).unwrap();
        assert_eq!(back, ch);
    }
}
