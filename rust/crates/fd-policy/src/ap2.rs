//! AP2 (Agent Payments Protocol) signed-Mandate pre-call spend gate.
//!
//! This is the **second payment rail** on the *same* pre-call spend gate the
//! [`x402`](crate::x402) module added on 2026-07-24. Where x402 gates a payment
//! quoted inline as an HTTP `402 Payment Required` challenge, [Google AP2][ap2]
//! gates a payment authorized ahead of time by a **signed Mandate chain**:
//!
//! - an **Intent Mandate** — the user (or their key) pre-authorizes an agent to
//!   spend, *within a scope*: which merchants/categories, up to a max amount
//!   ([`Ap2IntentMandate`]); and
//! - a **Cart Mandate** — the concrete cart the agent assembled, **bound to that
//!   intent** by `intent_id` and signed ([`Ap2CartMandate`]).
//!
//! Before an autonomous payment is authorized, [`evaluate_ap2_payment`]:
//!
//! 1. **verifies the signature chain** — the Intent and the Cart are each signed
//!    by a key in the trusted [`Ap2Keyring`], and the Cart is cryptographically
//!    bound to the Intent it claims (real Ed25519, RFC 8032);
//! 2. checks the **cart total against the per-task ceiling the policy already
//!    enforces for x402** — the very same [`Budget::has_cost_headroom`]
//!    (crate::budget::Budget::has_cost_headroom); and
//! 3. checks the cart stays **within the Intent's authorized scope** (merchant,
//!    category, the user's own max amount).
//!
//! It is **deny-by-default**: a missing or invalid signature, an unknown signing
//! key, a Cart not bound to its Intent, a cart total over the budget ceiling, an
//! amount over the user's intent max, or a merchant/category outside the intent
//! scope all return an [`Ap2GateOutcome::Deny`] and authorize nothing.
//!
//! Like the x402 gate, **this module never moves money**. It verifies mandates
//! and returns an authorize/deny *decision*; executing the payment (card rail,
//! bank transfer, stablecoin settlement) lives entirely outside FerrumDeck. An
//! authorized payment normalizes to an [`Ap2CostEvent`] that folds into the
//! **same `cost_cents` ledger** as x402 and token cost, so a run's cost slope
//! covers both payment rails.
//!
//! [ap2]: https://github.com/google-agentic-commerce/AP2

use std::collections::BTreeMap;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};

use crate::budget::{Budget, BudgetUsage};
use crate::decision::PolicyDecision;

/// Stable anchor recorded alongside an AP2 decision so audit consumers can cite
/// the protocol without re-reading docstrings.
pub const AP2_ANCHOR: &str = "ap2:signed-mandate-chain";

/// A money amount on the AP2 rail, normalized to the common budget unit (cents).
///
/// AP2 settles in fiat (and stablecoins); FerrumDeck's budget ceiling is in
/// cents, so only USD-denominated totals can be checked offline. A non-USD
/// currency is **unpriceable** here and denied by default — the same posture the
/// x402 gate takes for an asset with no known USD peg.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ap2Money {
    /// Amount in the currency's minor unit (USD cents).
    pub amount_cents: u64,
    /// ISO-4217-style currency code, e.g. `"USD"`.
    pub currency: String,
}

impl Ap2Money {
    /// Cents if this amount can be priced against a cents budget (USD), else
    /// `None` (deny-by-default upstream).
    pub fn to_cents(&self) -> Option<u64> {
        if self.currency.trim().eq_ignore_ascii_case("USD") {
            Some(self.amount_cents)
        } else {
            None
        }
    }
}

/// The scope an [`Ap2IntentMandate`] authorizes — what the user actually
/// consented to. An empty `merchants`/`categories` list means "unconstrained on
/// that axis"; `max_amount` always binds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ap2Scope {
    /// Allowed merchants; empty ⇒ any merchant.
    #[serde(default)]
    pub merchants: Vec<String>,
    /// Allowed categories; empty ⇒ any category.
    #[serde(default)]
    pub categories: Vec<String>,
    /// The maximum the user authorized (their own ceiling, distinct from the
    /// per-task budget ceiling the policy enforces).
    pub max_amount: Ap2Money,
}

/// A parsed AP2 **Intent Mandate**: the user's pre-authorization for an agent to
/// spend within [`Ap2Scope`], signed by a key in the [`Ap2Keyring`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ap2IntentMandate {
    /// Unique id the Cart binds to.
    pub intent_id: String,
    /// The principal who authorized (audit/display).
    pub subject: String,
    /// What the user consented to.
    pub scope: Ap2Scope,
    /// Id of the verifying key in the keyring that signed this intent.
    pub key_id: String,
    /// Hex-encoded Ed25519 signature over [`Ap2IntentMandate::signing_bytes`].
    #[serde(default)]
    pub signature: String,
}

impl Ap2IntentMandate {
    /// The canonical bytes the signature covers. Fixed field order + a version
    /// tag so the signed payload is stable and unambiguous (not dependent on
    /// JSON key ordering).
    pub fn signing_bytes(&self) -> Vec<u8> {
        let mut merchants = self.scope.merchants.clone();
        merchants.sort();
        let mut categories = self.scope.categories.clone();
        categories.sort();
        format!(
            "ap2-intent-v1|{}|{}|{}|{}|{}|{}",
            self.intent_id,
            self.subject,
            merchants.join(","),
            categories.join(","),
            self.scope.max_amount.amount_cents,
            self.scope.max_amount.currency.to_ascii_uppercase(),
        )
        .into_bytes()
    }
}

/// A parsed AP2 **Cart Mandate**: the concrete cart the agent assembled, bound to
/// an Intent by `intent_id` and signed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ap2CartMandate {
    /// Unique cart id (audit/display).
    pub cart_id: String,
    /// The Intent this cart is authorized under — the binding link.
    pub intent_id: String,
    /// The merchant this cart pays.
    pub merchant: String,
    /// Optional category (checked against the intent scope when the scope
    /// constrains categories).
    #[serde(default)]
    pub category: Option<String>,
    /// The cart total.
    pub total: Ap2Money,
    /// Id of the verifying key in the keyring that signed this cart.
    pub key_id: String,
    /// Hex-encoded Ed25519 signature over [`Ap2CartMandate::signing_bytes`].
    #[serde(default)]
    pub signature: String,
}

impl Ap2CartMandate {
    /// The canonical bytes the signature covers — includes `intent_id`, so a
    /// valid cart signature cryptographically binds the cart to one specific
    /// intent (the chain link).
    pub fn signing_bytes(&self) -> Vec<u8> {
        format!(
            "ap2-cart-v1|{}|{}|{}|{}|{}|{}",
            self.cart_id,
            self.intent_id,
            self.merchant,
            self.category.as_deref().unwrap_or(""),
            self.total.amount_cents,
            self.total.currency.to_ascii_uppercase(),
        )
        .into_bytes()
    }
}

/// A registry of trusted Ed25519 verifying keys, keyed by `key_id`. A mandate
/// signed by a `key_id` absent here is denied ([`Ap2DenyKind::UnknownKey`]).
#[derive(Debug, Clone, Default)]
pub struct Ap2Keyring {
    keys: BTreeMap<String, VerifyingKey>,
}

impl Ap2Keyring {
    /// An empty keyring — every mandate is denied for an unknown key until one is
    /// registered (deny-by-default).
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a verifying key from its 32 raw bytes.
    pub fn insert_key(&mut self, key_id: impl Into<String>, key: VerifyingKey) {
        self.keys.insert(key_id.into(), key);
    }

    /// Register a verifying key from a 64-hex-char (32-byte) string. Returns an
    /// error string on malformed hex / wrong length / invalid point.
    pub fn insert_hex(&mut self, key_id: impl Into<String>, hex_key: &str) -> Result<(), String> {
        let bytes = hex::decode(hex_key.trim()).map_err(|e| format!("bad hex key: {e}"))?;
        let arr: [u8; 32] = bytes
            .as_slice()
            .try_into()
            .map_err(|_| format!("verifying key must be 32 bytes, got {}", bytes.len()))?;
        let vk = VerifyingKey::from_bytes(&arr).map_err(|e| format!("invalid ed25519 key: {e}"))?;
        self.insert_key(key_id, vk);
        Ok(())
    }

    fn get(&self, key_id: &str) -> Option<&VerifyingKey> {
        self.keys.get(key_id)
    }

    /// Number of registered keys.
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    /// Whether the keyring has no keys (so every mandate is denied).
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }
}

/// Why an AP2 payment was denied. Every variant is a **hard stop** — the payment
/// is not authorized.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Ap2DenyKind {
    /// The Cart's `intent_id` does not match the Intent presented.
    IntentCartMismatch,
    /// A mandate carried an empty signature.
    MissingSignature,
    /// A mandate was signed by a `key_id` not in the trusted keyring.
    UnknownKey,
    /// A signature failed Ed25519 verification (tampered / wrong key).
    InvalidSignature,
    /// The cart total is in a currency that can't be priced against the cents
    /// budget (non-USD).
    Unpriceable,
    /// The cart's merchant/category/amount falls outside the Intent's scope.
    IntentScopeMismatch,
    /// The cart total would breach the per-task budget ceiling.
    CartOverCeiling,
}

impl Ap2DenyKind {
    /// Stable snake_case wire label.
    pub fn as_str(self) -> &'static str {
        match self {
            Ap2DenyKind::IntentCartMismatch => "intent_cart_mismatch",
            Ap2DenyKind::MissingSignature => "missing_signature",
            Ap2DenyKind::UnknownKey => "unknown_key",
            Ap2DenyKind::InvalidSignature => "invalid_signature",
            Ap2DenyKind::Unpriceable => "unpriceable",
            Ap2DenyKind::IntentScopeMismatch => "intent_scope_mismatch",
            Ap2DenyKind::CartOverCeiling => "cart_over_ceiling",
        }
    }
}

/// A verified, authorized AP2 payment normalized to cents — a first-class cost
/// event that folds into the **same `cost_cents` ledger** as x402 and token
/// cost.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Ap2CostEvent {
    /// The authorized cart id.
    pub cart_id: String,
    /// The intent it was authorized under.
    pub intent_id: String,
    /// The merchant paid.
    pub merchant: String,
    /// The authorized amount, normalized to cents.
    pub cost_cents: u64,
    /// The settlement currency (`"USD"`).
    pub currency: String,
}

impl Ap2CostEvent {
    /// Fold this authorized payment into a run's [`BudgetUsage`], **alongside
    /// token + x402 cost**, by adding `cost_cents` to the shared ledger.
    /// Saturating — a run can't wrap its cost ledger. Does not touch
    /// `tool_calls` (the payment rides a tool call the caller already counts).
    pub fn apply_to(&self, usage: &mut BudgetUsage) {
        usage.cost_cents = usage.cost_cents.saturating_add(self.cost_cents);
    }
}

/// The pre-call spend-gate decision for an AP2 payment, produced by
/// [`evaluate_ap2_payment`] *before* any payment is authorized.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Ap2GateOutcome {
    /// The signed mandate chain verified, the cart is in scope, and it fits the
    /// budget ceiling — the caller may authorize the payment.
    /// `budget_remaining_cents` is the headroom that would remain after it
    /// settles (`None` when no cost cap is set).
    Authorize {
        event: Ap2CostEvent,
        budget_remaining_cents: Option<u64>,
    },
    /// The payment is refused — hard stop.
    Deny { kind: Ap2DenyKind, reason: String },
}

impl Ap2GateOutcome {
    /// Whether the payment may proceed.
    pub fn is_authorized(&self) -> bool {
        matches!(self, Ap2GateOutcome::Authorize { .. })
    }

    /// The deny kind, or `None` when authorized.
    pub fn deny_kind(&self) -> Option<Ap2DenyKind> {
        match self {
            Ap2GateOutcome::Deny { kind, .. } => Some(*kind),
            Ap2GateOutcome::Authorize { .. } => None,
        }
    }

    /// The single operator alert to emit on a hard stop, or `None` when
    /// authorized. Exactly one alert per denied mandate — one pre-call check.
    pub fn alert_line(&self) -> Option<String> {
        match self {
            Ap2GateOutcome::Authorize { .. } => None,
            Ap2GateOutcome::Deny { kind, reason } => Some(format!(
                "AP2 spend gate BLOCKED payment [{}]: {reason} — payment not authorized",
                kind.as_str()
            )),
        }
    }

    /// Map onto the crate's [`PolicyDecision`] so an AP2 verdict flows through
    /// the same allow/deny pipeline as x402 and every other gate.
    pub fn to_policy_decision(&self) -> PolicyDecision {
        match self {
            Ap2GateOutcome::Authorize { event, .. } => PolicyDecision::allow(format!(
                "ap2 payment authorized: {}¢ to {} (intent {}) within budget + scope",
                event.cost_cents, event.merchant, event.intent_id
            )),
            Ap2GateOutcome::Deny { reason, .. } => PolicyDecision::deny(reason.clone()),
        }
    }
}

/// Verify a hex Ed25519 signature over `msg` under `vk`. Maps each failure onto
/// the precise [`Ap2DenyKind`].
fn verify_hex_sig(vk: &VerifyingKey, msg: &[u8], sig_hex: &str) -> Result<(), Ap2DenyKind> {
    let sig_hex = sig_hex.trim();
    if sig_hex.is_empty() {
        return Err(Ap2DenyKind::MissingSignature);
    }
    let bytes = hex::decode(sig_hex).map_err(|_| Ap2DenyKind::InvalidSignature)?;
    let arr: [u8; 64] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| Ap2DenyKind::InvalidSignature)?;
    let sig = Signature::from_bytes(&arr);
    vk.verify(msg, &sig)
        .map_err(|_| Ap2DenyKind::InvalidSignature)
}

/// Verify one mandate's signature under the keyring, resolving the key first.
fn verify_mandate(
    keyring: &Ap2Keyring,
    key_id: &str,
    msg: &[u8],
    sig_hex: &str,
) -> Result<(), Ap2DenyKind> {
    let vk = keyring.get(key_id).ok_or(Ap2DenyKind::UnknownKey)?;
    verify_hex_sig(vk, msg, sig_hex)
}

/// The AP2 pre-call spend gate: verify the signed mandate chain, the intent
/// scope, and the per-task budget ceiling **before** authorizing an autonomous
/// payment.
///
/// Reuses [`Budget::has_cost_headroom`] — the *same* per-task cost ceiling the
/// x402 gate enforces — so both payment rails answer to one budget. Pure and
/// deterministic (Ed25519 verification is I/O-free): same mandates + keyring +
/// budget ⇒ same decision.
///
/// Deny-by-default order (first failure wins, most specific reason surfaced):
/// intent/cart binding → currency priceable → intent signature → cart signature
/// → intent scope → budget ceiling.
pub fn evaluate_ap2_payment(
    intent: &Ap2IntentMandate,
    cart: &Ap2CartMandate,
    keyring: &Ap2Keyring,
    budget: &Budget,
    usage: &BudgetUsage,
) -> Ap2GateOutcome {
    // 1. Binding: the cart must claim the intent presented.
    if cart.intent_id != intent.intent_id {
        return deny(
            Ap2DenyKind::IntentCartMismatch,
            format!(
                "cart '{}' is bound to intent '{}', not the presented intent '{}'",
                cart.cart_id, cart.intent_id, intent.intent_id
            ),
        );
    }

    // 2. Priceable: an amount we can't put in cents can't be checked at all.
    let Some(amount_cents) = cart.total.to_cents() else {
        return deny(
            Ap2DenyKind::Unpriceable,
            format!(
                "cart total in '{}' cannot be priced against a cents budget (deny-by-default)",
                cart.total.currency
            ),
        );
    };

    // 3-4. Signature chain: intent then cart, each under the trusted keyring.
    if let Err(kind) = verify_mandate(
        keyring,
        &intent.key_id,
        &intent.signing_bytes(),
        &intent.signature,
    ) {
        return deny(
            kind,
            format!(
                "intent '{}' signature ({}) failed verification under key '{}'",
                intent.intent_id,
                kind.as_str(),
                intent.key_id
            ),
        );
    }
    if let Err(kind) = verify_mandate(
        keyring,
        &cart.key_id,
        &cart.signing_bytes(),
        &cart.signature,
    ) {
        return deny(
            kind,
            format!(
                "cart '{}' signature ({}) failed verification under key '{}'",
                cart.cart_id,
                kind.as_str(),
                cart.key_id
            ),
        );
    }

    // 5. Scope: the verified cart must stay within what the user authorized.
    if let Some(reason) = scope_violation(intent, cart, amount_cents) {
        return deny(Ap2DenyKind::IntentScopeMismatch, reason);
    }

    // 6. Ceiling: the SAME per-task budget gate x402 uses.
    if !budget.has_cost_headroom(usage, amount_cents) {
        let cap = budget.max_cost_cents.unwrap_or(0);
        let projected = usage.cost_cents.saturating_add(amount_cents);
        return deny(
            Ap2DenyKind::CartOverCeiling,
            format!(
                "ap2 spend gate: paying {amount_cents}¢ to {} would push run cost to {projected}¢ over the {cap}¢ budget (by {}¢)",
                cart.merchant,
                projected.saturating_sub(cap)
            ),
        );
    }

    // Authorized.
    let event = Ap2CostEvent {
        cart_id: cart.cart_id.clone(),
        intent_id: cart.intent_id.clone(),
        merchant: cart.merchant.clone(),
        cost_cents: amount_cents,
        currency: cart.total.currency.to_ascii_uppercase(),
    };
    let budget_remaining_cents = budget
        .max_cost_cents
        .map(|cap| cap.saturating_sub(usage.cost_cents.saturating_add(amount_cents)));
    Ap2GateOutcome::Authorize {
        event,
        budget_remaining_cents,
    }
}

/// Scope check: merchant (if constrained), category (if constrained), currency,
/// and the user's own intent max. `None` ⇒ in scope.
fn scope_violation(
    intent: &Ap2IntentMandate,
    cart: &Ap2CartMandate,
    amount_cents: u64,
) -> Option<String> {
    let scope = &intent.scope;
    if !scope.merchants.is_empty() && !scope.merchants.iter().any(|m| m == &cart.merchant) {
        return Some(format!(
            "merchant '{}' is not in the intent's authorized merchants",
            cart.merchant
        ));
    }
    if !scope.categories.is_empty() {
        match &cart.category {
            Some(c) if scope.categories.iter().any(|sc| sc == c) => {}
            _ => {
                return Some(format!(
                    "cart category {:?} is not in the intent's authorized categories",
                    cart.category
                ))
            }
        }
    }
    if !cart
        .total
        .currency
        .eq_ignore_ascii_case(&scope.max_amount.currency)
    {
        return Some(format!(
            "cart currency '{}' does not match the intent currency '{}'",
            cart.total.currency, scope.max_amount.currency
        ));
    }
    if amount_cents > scope.max_amount.amount_cents {
        return Some(format!(
            "cart total {amount_cents}¢ exceeds the user's authorized intent max {}¢",
            scope.max_amount.amount_cents
        ));
    }
    None
}

fn deny(kind: Ap2DenyKind, reason: String) -> Ap2GateOutcome {
    Ap2GateOutcome::Deny { kind, reason }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const USER_KEY_ID: &str = "user-key-1";

    fn signing_key() -> SigningKey {
        // Fixed 32-byte seed → deterministic key + signatures (RFC 8032).
        SigningKey::from_bytes(&[7u8; 32])
    }

    fn keyring_with(signer: &SigningKey) -> Ap2Keyring {
        let mut kr = Ap2Keyring::new();
        kr.insert_key(USER_KEY_ID, signer.verifying_key());
        kr
    }

    fn usd(cents: u64) -> Ap2Money {
        Ap2Money {
            amount_cents: cents,
            currency: "USD".into(),
        }
    }

    fn signed_intent(signer: &SigningKey, max_cents: u64) -> Ap2IntentMandate {
        let mut intent = Ap2IntentMandate {
            intent_id: "intent-abc".into(),
            subject: "user@example.com".into(),
            scope: Ap2Scope {
                merchants: vec!["acme-store".into()],
                categories: vec!["office-supplies".into()],
                max_amount: usd(max_cents),
            },
            key_id: USER_KEY_ID.into(),
            signature: String::new(),
        };
        intent.signature = hex::encode(signer.sign(&intent.signing_bytes()).to_bytes());
        intent
    }

    fn signed_cart(signer: &SigningKey, total_cents: u64) -> Ap2CartMandate {
        let mut cart = Ap2CartMandate {
            cart_id: "cart-xyz".into(),
            intent_id: "intent-abc".into(),
            merchant: "acme-store".into(),
            category: Some("office-supplies".into()),
            total: usd(total_cents),
            key_id: USER_KEY_ID.into(),
            signature: String::new(),
        };
        cart.signature = hex::encode(signer.sign(&cart.signing_bytes()).to_bytes());
        cart
    }

    fn budget(cap: u64) -> Budget {
        Budget {
            max_cost_cents: Some(cap),
            ..Budget::default()
        }
    }

    #[test]
    fn authorizes_a_valid_in_scope_in_budget_payment() {
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000); // user authorized up to $50
        let cart = signed_cart(&signer, 4000); // $40 cart
        let usage = BudgetUsage {
            cost_cents: 10,
            ..BudgetUsage::default()
        };
        let outcome = evaluate_ap2_payment(&intent, &cart, &kr, &budget(10_000), &usage);
        match outcome {
            Ap2GateOutcome::Authorize {
                event,
                budget_remaining_cents,
            } => {
                assert_eq!(event.cost_cents, 4000);
                assert_eq!(event.merchant, "acme-store");
                assert_eq!(budget_remaining_cents, Some(10_000 - 10 - 4000));
            }
            other => panic!("expected authorize, got {other:?}"),
        }
    }

    #[test]
    fn authorized_payment_folds_into_the_shared_cost_ledger() {
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000);
        let cart = signed_cart(&signer, 4000);
        let mut usage = BudgetUsage {
            cost_cents: 30, // token + x402 so far
            ..BudgetUsage::default()
        };
        if let Ap2GateOutcome::Authorize { event, .. } =
            evaluate_ap2_payment(&intent, &cart, &kr, &budget(10_000), &usage)
        {
            event.apply_to(&mut usage);
        } else {
            panic!("expected authorize");
        }
        assert_eq!(usage.cost_cents, 4030); // one ledger across rails
        assert_eq!(usage.tool_calls, 0);
    }

    #[test]
    fn denies_a_tampered_cart_signature() {
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000);
        let mut cart = signed_cart(&signer, 4000);
        // Tamper the total AFTER signing — signature no longer matches the bytes.
        cart.total.amount_cents = 1; // agent tries to under-report to fit the budget
        let outcome = evaluate_ap2_payment(
            &intent,
            &cart,
            &kr,
            &budget(10_000),
            &BudgetUsage::default(),
        );
        assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::InvalidSignature));
        assert!(outcome.to_policy_decision().is_denied());
        assert!(outcome.alert_line().unwrap().contains("invalid_signature"));
    }

    #[test]
    fn denies_a_missing_signature() {
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000);
        let mut cart = signed_cart(&signer, 4000);
        cart.signature = String::new();
        let outcome = evaluate_ap2_payment(
            &intent,
            &cart,
            &kr,
            &budget(10_000),
            &BudgetUsage::default(),
        );
        assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::MissingSignature));
    }

    #[test]
    fn denies_an_unknown_signing_key() {
        let signer = signing_key();
        let empty = Ap2Keyring::new(); // no keys registered → deny-by-default
        let intent = signed_intent(&signer, 5000);
        let cart = signed_cart(&signer, 4000);
        let outcome = evaluate_ap2_payment(
            &intent,
            &cart,
            &empty,
            &budget(10_000),
            &BudgetUsage::default(),
        );
        assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::UnknownKey));
    }

    #[test]
    fn denies_a_cart_over_the_per_task_ceiling() {
        // Cart is validly signed + in the user's intent scope, but breaches the
        // SAME per-task budget ceiling x402 uses.
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 20_000); // user allows up to $200
        let cart = signed_cart(&signer, 15_000); // $150 cart
        let usage = BudgetUsage {
            cost_cents: 0,
            ..BudgetUsage::default()
        };
        let outcome = evaluate_ap2_payment(&intent, &cart, &kr, &budget(100), &usage); // $1 task ceiling
        match &outcome {
            Ap2GateOutcome::Deny { kind, reason } => {
                assert_eq!(*kind, Ap2DenyKind::CartOverCeiling);
                assert!(reason.contains("15000"));
            }
            other => panic!("expected deny, got {other:?}"),
        }
    }

    #[test]
    fn denies_a_merchant_outside_intent_scope() {
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000);
        let mut cart = Ap2CartMandate {
            merchant: "evil-merchant".into(), // not in the intent's authorized merchants
            ..signed_cart(&signer, 4000)
        };
        // Re-sign so the signature is valid over the tampered merchant — the
        // failure must be SCOPE, not signature.
        cart.signature = hex::encode(signer.sign(&cart.signing_bytes()).to_bytes());
        let outcome = evaluate_ap2_payment(
            &intent,
            &cart,
            &kr,
            &budget(10_000),
            &BudgetUsage::default(),
        );
        assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::IntentScopeMismatch));
    }

    #[test]
    fn denies_a_cart_over_the_users_own_intent_max() {
        // Signed + in-merchant + under the per-task ceiling, but over what the
        // user themselves authorized in the intent.
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 3000); // user max $30
        let cart = signed_cart(&signer, 4000); // $40 cart
        let outcome = evaluate_ap2_payment(
            &intent,
            &cart,
            &kr,
            &budget(100_000),
            &BudgetUsage::default(),
        );
        assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::IntentScopeMismatch));
    }

    #[test]
    fn denies_a_cart_not_bound_to_the_intent() {
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000);
        let mut cart = signed_cart(&signer, 4000);
        cart.intent_id = "some-other-intent".into();
        cart.signature = hex::encode(signer.sign(&cart.signing_bytes()).to_bytes());
        let outcome = evaluate_ap2_payment(
            &intent,
            &cart,
            &kr,
            &budget(10_000),
            &BudgetUsage::default(),
        );
        assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::IntentCartMismatch));
    }

    #[test]
    fn denies_an_unpriceable_non_usd_cart() {
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000);
        let mut cart = signed_cart(&signer, 4000);
        cart.total.currency = "EUR".into();
        cart.signature = hex::encode(signer.sign(&cart.signing_bytes()).to_bytes());
        let outcome = evaluate_ap2_payment(
            &intent,
            &cart,
            &kr,
            &budget(10_000),
            &BudgetUsage::default(),
        );
        assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::Unpriceable));
    }

    #[test]
    fn mandates_round_trip_through_json_and_verify() {
        // The parse path an external caller uses: mandates arrive as JSON.
        let signer = signing_key();
        let kr = keyring_with(&signer);
        let intent = signed_intent(&signer, 5000);
        let cart = signed_cart(&signer, 4000);
        let intent2: Ap2IntentMandate =
            serde_json::from_str(&serde_json::to_string(&intent).unwrap()).unwrap();
        let cart2: Ap2CartMandate =
            serde_json::from_str(&serde_json::to_string(&cart).unwrap()).unwrap();
        assert!(evaluate_ap2_payment(
            &intent2,
            &cart2,
            &kr,
            &budget(10_000),
            &BudgetUsage::default()
        )
        .is_authorized());
    }

    #[test]
    fn keyring_insert_hex_round_trips() {
        let signer = signing_key();
        let hexkey = hex::encode(signer.verifying_key().to_bytes());
        let mut kr = Ap2Keyring::new();
        kr.insert_hex(USER_KEY_ID, &hexkey).expect("valid hex key");
        assert_eq!(kr.len(), 1);
        assert!(!kr.is_empty());
        // A bad key is rejected, not silently dropped.
        assert!(kr.insert_hex("bad", "zzzz").is_err());
    }

    #[test]
    fn deny_kind_wire_labels_are_stable() {
        assert_eq!(Ap2DenyKind::InvalidSignature.as_str(), "invalid_signature");
        assert_eq!(Ap2DenyKind::CartOverCeiling.as_str(), "cart_over_ceiling");
        assert_eq!(
            Ap2DenyKind::IntentScopeMismatch.as_str(),
            "intent_scope_mismatch"
        );
    }
}
