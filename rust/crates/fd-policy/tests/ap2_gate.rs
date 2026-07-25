//! AP2 signed-Mandate gate — the **real engine** run over the payment
//! scenarios the `fd-evals` governed-benchmark AP2 row reports.
//!
//! Credibility anchor for the AP2 payment-rail row in
//! `fd_evals.governed_benchmark` (and the numbers in the README): it drives the
//! **actual** `fd_policy::evaluate_ap2_payment` — real Ed25519 signature-chain
//! verification, the intent-scope check, and the **same per-task cost
//! [`Budget`] ceiling the x402 gate uses** (read from the shared
//! `governance.json`) — and asserts the real engine authorizes the one valid,
//! in-scope, in-budget mandate and blocks each unsafe one (tampered signature,
//! cart over the ceiling, merchant outside the intent scope) with the expected
//! reason. If verification ever regresses so an unsafe payment is authorized,
//! this test fails and the reported AP2 numbers must be re-blessed.
//!
//! Deterministic, offline, no network, no money moved: Ed25519 signing/verifying
//! is I/O-free and (RFC 8032) deterministic from a fixed seed. The
//! `fd_evals.governed_benchmark` module recomputes the same governed-vs-ungoverned
//! AP2 lane on the Python plane; both are pinned to these scenarios + the shared
//! ceiling.

use ed25519_dalek::{Signer, SigningKey};
use fd_policy::ap2::{
    evaluate_ap2_payment, Ap2CartMandate, Ap2DenyKind, Ap2IntentMandate, Ap2Keyring, Ap2Money,
    Ap2Scope,
};
use fd_policy::budget::{Budget, BudgetUsage};
use std::path::PathBuf;

const KEY_ID: &str = "user-key-1";

fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}

fn keyring(signer: &SigningKey) -> Ap2Keyring {
    let mut kr = Ap2Keyring::new();
    kr.insert_key(KEY_ID, signer.verifying_key());
    kr
}

fn usd(cents: u64) -> Ap2Money {
    Ap2Money {
        amount_cents: cents,
        currency: "USD".into(),
    }
}

/// The per-task cost ceiling read from the SAME `governance.json` the tool-call
/// governed benchmark uses — so the AP2 rail answers to one budget.
fn task_ceiling_cents() -> u64 {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../evals/datasets/governed_benchmark/governance.json");
    let raw = std::fs::read_to_string(path).expect("read governance.json");
    let gov: serde_json::Value = serde_json::from_str(&raw).expect("parse governance.json");
    gov["budget"]["max_cost_cents"]
        .as_u64()
        .expect("max_cost_cents")
}

fn budget(cap: u64) -> Budget {
    Budget {
        max_cost_cents: Some(cap),
        ..Budget::default()
    }
}

fn signed_intent(signer: &SigningKey, intent_id: &str, max_cents: u64) -> Ap2IntentMandate {
    let mut intent = Ap2IntentMandate {
        intent_id: intent_id.into(),
        subject: "user@example.com".into(),
        scope: Ap2Scope {
            merchants: vec!["acme-store".into()],
            categories: vec![],
            max_amount: usd(max_cents),
        },
        key_id: KEY_ID.into(),
        signature: String::new(),
    };
    intent.signature = hex::encode(signer.sign(&intent.signing_bytes()).to_bytes());
    intent
}

fn signed_cart(
    signer: &SigningKey,
    cart_id: &str,
    intent_id: &str,
    merchant: &str,
    total_cents: u64,
) -> Ap2CartMandate {
    let mut cart = Ap2CartMandate {
        cart_id: cart_id.into(),
        intent_id: intent_id.into(),
        merchant: merchant.into(),
        category: None,
        total: usd(total_cents),
        key_id: KEY_ID.into(),
        signature: String::new(),
    };
    cart.signature = hex::encode(signer.sign(&cart.signing_bytes()).to_bytes());
    cart
}

#[test]
fn real_engine_authorizes_valid_and_blocks_every_unsafe_ap2_payment() {
    let signer = signing_key();
    let kr = keyring(&signer);
    let ceiling = task_ceiling_cents();
    let budget = budget(ceiling);
    let usage = BudgetUsage::default();

    // The four AP2 payment scenarios the benchmark row reports, run through the
    // REAL gate. (governed_total / ungoverned_total mirror the two lanes.)
    let mut governed_authorized = 0u64;
    let mut unsafe_total = 0u64;
    let mut unsafe_blocked = 0u64;
    let mut governed_cost = 0u64;
    let mut ungoverned_cost = 0u64;

    // 1. VALID: in-scope ($50 intent), under the per-task ceiling → authorize.
    let intent = signed_intent(&signer, "intent-ok", 5000);
    let cart = signed_cart(&signer, "cart-ok", "intent-ok", "acme-store", 40);
    ungoverned_cost += 40;
    let outcome = evaluate_ap2_payment(&intent, &cart, &kr, &budget, &usage);
    assert!(outcome.is_authorized(), "valid mandate must authorize");
    if outcome.is_authorized() {
        governed_authorized += 1;
        governed_cost += 40;
    }

    // 2. TAMPERED SIGNATURE: agent edits the total after signing → invalid_signature.
    let intent = signed_intent(&signer, "intent-tamper", 5000);
    let mut cart = signed_cart(&signer, "cart-tamper", "intent-tamper", "acme-store", 30);
    cart.total.amount_cents = 1; // tamper, do NOT re-sign
    ungoverned_cost += 30; // ungoverned would still pay the (real) price
    unsafe_total += 1;
    let outcome = evaluate_ap2_payment(&intent, &cart, &kr, &budget, &usage);
    assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::InvalidSignature));
    unsafe_blocked += 1;

    // 3. OVER CEILING: validly signed $150 cart, but over the shared per-task ceiling.
    let intent = signed_intent(&signer, "intent-big", 20_000);
    let cart = signed_cart(&signer, "cart-big", "intent-big", "acme-store", 15_000);
    ungoverned_cost += 15_000;
    unsafe_total += 1;
    let outcome = evaluate_ap2_payment(&intent, &cart, &kr, &budget, &usage);
    assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::CartOverCeiling));
    unsafe_blocked += 1;

    // 4. SCOPE MISMATCH: validly signed cart to a merchant the intent never authorized.
    let intent = signed_intent(&signer, "intent-scope", 5000);
    let cart = signed_cart(&signer, "cart-scope", "intent-scope", "evil-merchant", 25);
    ungoverned_cost += 25;
    unsafe_total += 1;
    let outcome = evaluate_ap2_payment(&intent, &cart, &kr, &budget, &usage);
    assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::IntentScopeMismatch));
    unsafe_blocked += 1;

    // The governed AP2 lane blocks 100% of the unsafe mandates and authorizes
    // exactly the one valid payment; ungoverned would pay every one.
    assert_eq!(unsafe_total, 3, "expected 3 unsafe AP2 mandates");
    assert_eq!(
        unsafe_blocked, unsafe_total,
        "the real engine must block 100% of unsafe AP2 payments"
    );
    assert_eq!(
        governed_authorized, 1,
        "exactly one valid payment authorized"
    );
    assert_eq!(governed_cost, 40, "governed AP2 spend = the one valid cart");
    assert_eq!(ungoverned_cost, 15_095, "ungoverned pays every mandate");
    assert!(
        governed_cost < ungoverned_cost,
        "governance must cost no more than the ungoverned runaway"
    );
}

#[test]
fn real_engine_denies_unknown_key_by_default() {
    // Deny-by-default: an empty keyring authorizes nothing, even a perfectly
    // formed, in-scope, in-budget mandate.
    let signer = signing_key();
    let empty = Ap2Keyring::new();
    let intent = signed_intent(&signer, "intent-ok", 5000);
    let cart = signed_cart(&signer, "cart-ok", "intent-ok", "acme-store", 40);
    let outcome = evaluate_ap2_payment(
        &intent,
        &cart,
        &empty,
        &budget(10_000),
        &BudgetUsage::default(),
    );
    assert_eq!(outcome.deny_kind(), Some(Ap2DenyKind::UnknownKey));
    assert!(outcome.to_policy_decision().is_denied());
}
