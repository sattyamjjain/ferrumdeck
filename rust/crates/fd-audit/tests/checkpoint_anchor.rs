//! Pure checkpoint-anchoring tests — no database, no filesystem, no clock, no
//! RNG (the signing key is a fixed seed; timestamps are fixed instants).
//!
//! These pin the properties the anchor rests on: a checkpoint over a known head
//! verifies; the load-bearing one — a whole-tail rewrite *after* a checkpoint is
//! DETECTED even though the rewritten chain is internally self-consistent; a
//! missing checkpoint degrades to the in-chain guarantee and says so rather than
//! silently passing; the signing preimage is stable across JSON key order; and a
//! checkpoint signed by an untrusted key cannot rescue a rewritten tail.

use fd_audit::chain::{ChainInput, ChainRecord};
use fd_audit::checkpoint::{
    checkpoint_signing_bytes, verify_against_checkpoints, CheckpointBody, CheckpointOutcome,
    CheckpointSigner, CheckpointVerifier, DegradeReason, Divergence,
};
use fd_audit::record_hash;
use serde_json::json;

const KEY_ID: &str = "audit-checkpoint-key-1";

fn signer() -> CheckpointSigner {
    // Fixed seed → deterministic key. NEVER the database's key.
    CheckpointSigner::from_seed(KEY_ID, &[11u8; 32])
}

fn trusting_verifier(s: &CheckpointSigner) -> CheckpointVerifier {
    let mut v = CheckpointVerifier::new();
    v.insert_key(KEY_ID, s.verifying_key());
    v
}

/// A ChainInput at `seq` with a `marker` folded into `details`, so two chains
/// built with different markers have different content (and thus hashes) at
/// every position — exactly what a tail-rewrite produces.
fn input(seq: i64, marker: &str) -> ChainInput {
    ChainInput {
        id: format!("aud_{seq:026}"),
        occurred_at: "2026-08-01T12:00:00.000000Z".parse().unwrap(),
        actor_type: "system".into(),
        actor_id: None,
        action: "policy.denied".into(),
        resource_type: "run".into(),
        resource_id: Some(format!("run_{seq}")),
        details: json!({ "reason": marker, "seq": seq }),
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

/// Build a correctly-linked chain of `n` records for tenant `ten_acme`, each
/// carrying `marker` in its details.
fn build_chain(n: i64, marker: &str) -> Vec<ChainRecord> {
    let mut records: Vec<ChainRecord> = Vec::new();
    let mut prev: Option<String> = None;
    for seq in 1..=n {
        let inp = input(seq, marker);
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

/// A checkpoint over the head of `records`, signed by `s`, taken at a fixed
/// instant.
fn checkpoint_head(s: &CheckpointSigner, records: &[ChainRecord]) -> fd_audit::Checkpoint {
    let head = records.last().expect("non-empty chain");
    s.sign(CheckpointBody {
        tenant_id: head.input.tenant_id.clone(),
        chain_seq: head.input.chain_seq,
        record_hash: head.record_hash.clone(),
        checkpointed_at: "2026-08-01T12:05:00.000000Z".parse().unwrap(),
    })
}

#[test]
fn checkpoint_over_known_head_verifies() {
    let s = signer();
    let chain = build_chain(5, "genuine");
    let cp = checkpoint_head(&s, &chain);

    let outcome = verify_against_checkpoints(&chain, &[cp], &trusting_verifier(&s));
    match outcome {
        CheckpointOutcome::Verified {
            anchored_seq,
            records_after,
            ..
        } => {
            assert_eq!(anchored_seq, 5, "anchored at the head");
            assert_eq!(records_after, 0, "nothing past the head is unprotected");
        }
        other => panic!("a checkpoint over the real head must verify, got {other:?}"),
    }
}

#[test]
fn whole_tail_rewrite_after_checkpoint_is_detected() {
    // This is the test that makes the feature real. Without it, the anchor is
    // not proven to catch the one attack the hash-chain alone cannot.
    let s = signer();
    let verifier = trusting_verifier(&s);

    // 1. A genuine chain, checkpointed at its head.
    let genuine = build_chain(5, "genuine");
    let cp = checkpoint_head(&s, &genuine);

    // 2. A privileged actor rewrites the ENTIRE tail: a fresh, *self-consistent*
    //    chain of the same length with different content. It passes internal
    //    verification — the attacker recomputed every hash and link.
    let rewritten = build_chain(5, "TAMPERED");
    assert!(
        fd_audit::verify_chain(&rewritten).is_ok(),
        "the rewritten chain is internally self-consistent — that is the whole \
         point: verify_chain alone cannot catch it"
    );
    assert_ne!(
        genuine.last().unwrap().record_hash,
        rewritten.last().unwrap().record_hash,
        "the rewrite changed the head hash"
    );

    // 3. Against the signed checkpoint, the rewrite is DETECTED.
    let outcome = verify_against_checkpoints(&rewritten, std::slice::from_ref(&cp), &verifier);
    match &outcome {
        CheckpointOutcome::Diverged {
            anchored_seq,
            expected_hash,
            divergence: Divergence::HashMismatch { actual_hash },
        } => {
            assert_eq!(*anchored_seq, 5);
            assert_eq!(expected_hash, &genuine.last().unwrap().record_hash);
            assert_eq!(actual_hash, &rewritten.last().unwrap().record_hash);
        }
        other => panic!("a rewritten tail must be DETECTED as Diverged, got {other:?}"),
    }
    assert!(outcome.is_diverged());
    assert!(!outcome.is_verified(), "a rewritten tail must never verify");
}

#[test]
fn missing_checkpoint_degrades_and_says_so() {
    // No checkpoint at all: the chain is internally fine, but a whole-tail
    // rewrite would be undetectable. That MUST be a distinct, named outcome —
    // never a silent pass.
    let s = signer();
    let chain = build_chain(5, "genuine");

    let outcome = verify_against_checkpoints(&chain, &[], &trusting_verifier(&s));
    assert_eq!(
        outcome,
        CheckpointOutcome::Degraded {
            reason: DegradeReason::NoCheckpoints
        }
    );
    assert!(outcome.is_degraded());
    assert!(
        !outcome.is_verified(),
        "no checkpoint means not-proven, not proven-good"
    );
}

#[test]
fn untrusted_key_checkpoint_is_ignored() {
    // An attacker who can write the sink but does not hold a trusted key signs a
    // checkpoint over their rewritten tail with their OWN key. It must not
    // upgrade the verdict — the verifier trusts only the real key.
    let real = signer();
    let attacker = CheckpointSigner::from_seed("attacker-key", &[99u8; 32]);
    let verifier = trusting_verifier(&real); // trusts `real` only

    let rewritten = build_chain(5, "TAMPERED");
    let forged = checkpoint_head(&attacker, &rewritten); // "anchors" the rewrite

    let outcome = verify_against_checkpoints(&rewritten, &[forged], &verifier);
    assert_eq!(
        outcome,
        CheckpointOutcome::Degraded {
            reason: DegradeReason::NoTrustedCheckpoint
        },
        "a checkpoint from an untrusted key is ignored — it cannot rescue a rewrite"
    );
    assert!(!outcome.is_verified());
}

#[test]
fn truncated_tail_below_checkpoint_is_detected() {
    // Checkpoint the head at seq 5, then truncate the chain to 3 records. The
    // chain no longer reaches the anchored seq — a truncation past the anchor.
    let s = signer();
    let full = build_chain(5, "genuine");
    let cp = checkpoint_head(&s, &full);

    let truncated: Vec<ChainRecord> = full.into_iter().take(3).collect();
    let outcome = verify_against_checkpoints(&truncated, &[cp], &trusting_verifier(&s));
    match outcome {
        CheckpointOutcome::Diverged {
            anchored_seq,
            divergence: Divergence::Truncated { chain_len },
            ..
        } => {
            assert_eq!(anchored_seq, 5);
            assert_eq!(chain_len, 3);
        }
        other => panic!("a truncation below the anchor must be Diverged, got {other:?}"),
    }
}

#[test]
fn checkpoint_signing_bytes_stable_across_json_key_order() {
    // The property the signature rests on, mirroring the chain's
    // canonical-encoding test: the SAME logical checkpoint signs the same bytes
    // no matter what order its JSON object's keys were written in — because the
    // preimage is built from typed fields, not the JSON text.
    let body = CheckpointBody {
        tenant_id: Some("ten_acme".into()),
        chain_seq: 42,
        record_hash: "deadbeef".repeat(8),
        checkpointed_at: "2026-08-01T12:05:00.000000Z".parse().unwrap(),
    };

    let ordered = json!({
        "tenant_id": "ten_acme",
        "chain_seq": 42,
        "record_hash": "deadbeef".repeat(8),
        "checkpointed_at": "2026-08-01T12:05:00.000000Z",
    });
    let shuffled = json!({
        "checkpointed_at": "2026-08-01T12:05:00.000000Z",
        "record_hash": "deadbeef".repeat(8),
        "tenant_id": "ten_acme",
        "chain_seq": 42,
    });

    let from_ordered: CheckpointBody = serde_json::from_value(ordered).unwrap();
    let from_shuffled: CheckpointBody = serde_json::from_value(shuffled).unwrap();

    assert_eq!(from_ordered, body);
    assert_eq!(from_shuffled, body);
    assert_eq!(
        checkpoint_signing_bytes(&from_ordered),
        checkpoint_signing_bytes(&from_shuffled),
        "JSON key order must not change the signed preimage"
    );

    // And the signature made over one verifies against the other's preimage.
    let s = signer();
    let cp = s.sign(from_ordered);
    assert!(
        trusting_verifier(&s).verify_signature(&cp),
        "signature verifies over the recomputed preimage"
    );
}
