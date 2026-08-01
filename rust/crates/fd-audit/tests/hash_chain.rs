//! Pure hash-chain tests — no database, no Docker, no clock.
//!
//! These pin the properties the whole tamper-evidence scheme rests on: a chain
//! links and verifies, an edit to any record breaks verification at exactly that
//! record, a removed record shows up as a sequence gap, and — the load-bearing
//! one — the canonical encoding is stable regardless of `details` key order.

use fd_audit::chain::{ChainBreakKind, ChainInput, ChainRecord};
use fd_audit::{canonical_bytes, record_hash, verify_chain};
use serde_json::json;

/// A ChainInput at a given sequence position. `occurred_at` is a fixed instant
/// (tests are clock-free and deterministic).
fn input(seq: i64, details: serde_json::Value) -> ChainInput {
    ChainInput {
        id: format!("aud_{seq:026}"),
        occurred_at: "2026-08-01T12:00:00.000000Z".parse().unwrap(),
        actor_type: "system".into(),
        actor_id: None,
        action: "policy.denied".into(),
        resource_type: "run".into(),
        resource_id: Some(format!("run_{seq}")),
        details,
        tenant_id: Some("ten_acme".into()),
        workspace_id: None,
        project_id: Some("prj_1".into()),
        run_id: Some(format!("run_{seq}")),
        request_id: None,
        ip_address: None,
        user_agent: None,
        trace_id: None,
        span_id: None,
        chain_seq: seq,
    }
}

/// Build a correctly-linked chain of `n` records (seq 1..=n), genesis first.
fn build_chain(n: i64) -> Vec<ChainRecord> {
    let mut records: Vec<ChainRecord> = Vec::new();
    let mut prev: Option<String> = None;
    for seq in 1..=n {
        let inp = input(seq, json!({ "reason": "not in allowlist", "seq": seq }));
        let rh = record_hash(prev.as_deref(), &inp);
        records.push(ChainRecord {
            input: inp,
            prev_hash: prev.clone(),
            record_hash: rh.clone(),
        });
        prev = Some(rh);
    }
    records
}

#[test]
fn genesis_link_is_correct() {
    let inp = input(1, json!({ "reason": "boot" }));
    // Genesis has no predecessor: prev_hash None hashes against GENESIS.
    let rh = record_hash(None, &inp);
    assert_eq!(rh.len(), 64, "sha-256 hex is 64 lowercase chars");
    assert_eq!(rh, rh.to_lowercase());

    let chain = vec![ChainRecord {
        input: inp,
        prev_hash: None,
        record_hash: rh,
    }];
    assert!(
        verify_chain(&chain).is_ok(),
        "a genesis-only chain verifies"
    );
}

#[test]
fn five_record_chain_verifies() {
    let chain = build_chain(5);
    assert!(verify_chain(&chain).is_ok());
    // Each record links to its predecessor.
    for i in 1..chain.len() {
        assert_eq!(
            chain[i].prev_hash.as_deref(),
            Some(chain[i - 1].record_hash.as_str())
        );
    }
}

#[test]
fn editing_a_record_breaks_verification_at_that_id() {
    let mut chain = build_chain(5);
    // Tamper with record #3's content, leaving its stored record_hash intact —
    // exactly what a DB actor editing a row in place would produce.
    let target_id = chain[2].input.id.clone();
    chain[2].input.details = json!({ "reason": "TAMPERED", "seq": 3 });

    let err = verify_chain(&chain).expect_err("an edited record must fail verification");
    assert_eq!(err.id, target_id, "break is reported at the edited record");
    assert_eq!(err.kind, ChainBreakKind::HashMismatch);
}

#[test]
fn deleting_a_middle_record_is_a_sequence_gap() {
    let mut chain = build_chain(5);
    let removed = chain.remove(2); // drop seq 3
                                   // The record that now follows the gap (originally seq 4) is where it shows.
    let after_gap_id = chain[2].input.id.clone();
    assert_ne!(removed.input.id, after_gap_id);

    let err = verify_chain(&chain).expect_err("a removed record must be detected");
    assert_eq!(err.kind, ChainBreakKind::SequenceGap);
    assert_eq!(err.id, after_gap_id);
    assert_eq!(err.expected, "3");
    assert_eq!(err.actual, "4");
}

#[test]
fn canonical_encoding_is_stable_across_details_key_order() {
    // The property everything rests on: the SAME logical record hashes the same
    // no matter what order `details` keys were inserted in.
    let a = input(
        7,
        json!({ "alpha": 1, "beta": { "y": 2, "x": 1 }, "zeta": [3, 2, 1] }),
    );
    let b = input(
        7,
        json!({ "zeta": [3, 2, 1], "beta": { "x": 1, "y": 2 }, "alpha": 1 }),
    );

    assert_eq!(
        canonical_bytes(&a),
        canonical_bytes(&b),
        "key-insertion order must not change the canonical bytes"
    );
    assert_eq!(
        record_hash(None, &a),
        record_hash(None, &b),
        "and therefore must not change the record hash"
    );

    // Array element order IS content and must still matter.
    let c = input(7, json!({ "zeta": [1, 2, 3] }));
    let d = input(7, json!({ "zeta": [3, 2, 1] }));
    assert_ne!(canonical_bytes(&c), canonical_bytes(&d));
}
