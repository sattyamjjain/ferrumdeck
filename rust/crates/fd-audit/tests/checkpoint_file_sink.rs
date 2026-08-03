//! Round-trip test for the shipped [`FileCheckpointSink`] — the one checkpoint
//! test that touches disk (append-only NDJSON, `fsync`'d). Writes to a unique
//! temp path, reads back, and verifies signatures survive the round-trip.

use fd_audit::chain::{ChainInput, ChainRecord};
use fd_audit::checkpoint::{
    verify_against_checkpoints, CheckpointBody, CheckpointOutcome, CheckpointSigner,
    CheckpointSink, CheckpointVerifier, FileCheckpointSink,
};
use fd_audit::record_hash;
use serde_json::json;

const KEY_ID: &str = "audit-checkpoint-key-1";

fn unique_temp_path() -> std::path::PathBuf {
    // Unique per process + test binary, no RNG: process id + a fixed suffix.
    // Removed up front so a re-run starts from an empty (append-only) sink.
    let mut p = std::env::temp_dir();
    p.push(format!("fd_audit_ckpt_sink_{}.ndjson", std::process::id()));
    let _ = std::fs::remove_file(&p);
    p
}

fn build_chain(n: i64) -> Vec<ChainRecord> {
    let mut records = Vec::new();
    let mut prev: Option<String> = None;
    for seq in 1..=n {
        let inp = ChainInput {
            id: format!("aud_{seq:026}"),
            occurred_at: "2026-08-01T12:00:00.000000Z".parse().unwrap(),
            actor_type: "system".into(),
            actor_id: None,
            action: "policy.denied".into(),
            resource_type: "run".into(),
            resource_id: Some(format!("run_{seq}")),
            details: json!({ "reason": "not in allowlist", "seq": seq }),
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
        };
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
fn file_sink_round_trips_and_read_back_checkpoints_verify() {
    let path = unique_temp_path();
    let sink = FileCheckpointSink::new(&path);

    // Empty (never-written) sink reads back as zero checkpoints, not an error.
    assert!(sink.read_all().unwrap().is_empty());

    let signer = CheckpointSigner::from_seed(KEY_ID, &[11u8; 32]);
    let mut verifier = CheckpointVerifier::new();
    verifier.insert_key(KEY_ID, signer.verifying_key());

    // Append two checkpoints over two successive heads.
    let chain3 = build_chain(3);
    let cp_at_3 = signer.sign(CheckpointBody {
        tenant_id: Some("ten_acme".into()),
        chain_seq: 3,
        record_hash: chain3.last().unwrap().record_hash.clone(),
        checkpointed_at: "2026-08-01T12:03:00.000000Z".parse().unwrap(),
    });
    let chain5 = build_chain(5);
    let cp_at_5 = signer.sign(CheckpointBody {
        tenant_id: Some("ten_acme".into()),
        chain_seq: 5,
        record_hash: chain5.last().unwrap().record_hash.clone(),
        checkpointed_at: "2026-08-01T12:05:00.000000Z".parse().unwrap(),
    });
    sink.append(&cp_at_3).unwrap();
    sink.append(&cp_at_5).unwrap();

    // Read back in append order, byte-identical.
    let read_back = sink.read_all().unwrap();
    assert_eq!(read_back, vec![cp_at_3, cp_at_5]);

    // The read-back checkpoints still verify the live chain (most recent anchor
    // wins → seq 5, nothing after).
    let outcome = verify_against_checkpoints(&chain5, &read_back, &verifier);
    assert!(
        matches!(
            outcome,
            CheckpointOutcome::Verified {
                anchored_seq: 5,
                records_after: 0,
                ..
            }
        ),
        "checkpoints survive the file round-trip and still anchor the chain: {outcome:?}"
    );

    let _ = std::fs::remove_file(&path);
}
