//! Cryptographic hash-chain over audit records — tamper-*evidence* (#8).
//!
//! Append-only + a DB reject-trigger stops the ordinary UPDATE/DELETE paths, but
//! a privileged DB actor can still drop the trigger and rewrite rows. A
//! hash-chain makes such tampering **detectable**: each record commits to its
//! predecessor's hash, so any insertion, deletion, or edit within the chain
//! changes every hash downstream and fails verification.
//!
//! This module is **pure** — no database, no I/O, no clock. The storage layer
//! ([`fd_storage::AuditRepo`]) computes [`record_hash`] at insert time and calls
//! [`verify_chain`] on read; the logic lives here so it is unit-testable without
//! a database and so the canonical encoding has exactly one definition.
//!
//! **Residual limitation — detectable, not impossible.** An actor who can
//! rewrite the *entire* tail can produce a self-consistent chain, because they
//! hold every input; [`verify_chain`] cannot catch that, because nothing inside
//! the chain is left to disagree with. Detection needs the chain *head* anchored
//! out-of-band. That anchor now exists — signed head checkpoints in
//! [`crate::checkpoint`], verified by [`crate::checkpoint::verify_against_checkpoints`],
//! which catches a rewritten tail up to the most recent checkpoint. This module
//! is the chain; that module is its anchor.

use chrono::{DateTime, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// The sentinel `prev_hash` for the first record in a chain (a genesis row has
/// no predecessor). Domain-separated so it cannot collide with a real hash.
pub const GENESIS: &str = "ferrumdeck/audit-chain/genesis/v1";

/// Byte inserted between `prev_hash` and the record body in the hash preimage,
/// so `prev || body` is unambiguous.
const HASH_SEP: u8 = 0x1f;

/// The content of one audit record that the hash commits to. Everything a
/// verifier needs to recompute a record's hash, and nothing that is not part of
/// the record (the hash columns themselves are excluded — they are *outputs*).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChainInput {
    pub id: String,
    /// Server-generated instant. Serialized to RFC 3339 UTC at microsecond
    /// precision (Postgres `TIMESTAMPTZ` resolution) so an insert-time value and
    /// its read-back round-trip to the same bytes.
    pub occurred_at: DateTime<Utc>,
    pub actor_type: String,
    pub actor_id: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub details: serde_json::Value,
    pub tenant_id: Option<String>,
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub run_id: Option<String>,
    pub request_id: Option<String>,
    pub ip_address: Option<String>,
    pub user_agent: Option<String>,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
    /// Monotonic per-tenant position in the chain (genesis = 1).
    pub chain_seq: i64,
}

/// A persisted record as read back for verification: its content plus the two
/// stored hash columns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainRecord {
    pub input: ChainInput,
    /// The stored `prev_hash` (NULL/None only for a genesis row).
    pub prev_hash: Option<String>,
    /// The stored `record_hash`.
    pub record_hash: String,
}

/// How a chain is broken, for a precise, actionable report.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChainBreakKind {
    /// A record's stored `record_hash` does not match its recomputed hash —
    /// the record's own content (or `prev_hash`) was edited.
    HashMismatch,
    /// A record's `prev_hash` does not equal its predecessor's `record_hash` —
    /// the link between two adjacent records was severed.
    LinkMismatch,
    /// `chain_seq` is not contiguous — a record was removed (or reordered).
    SequenceGap,
}

/// The first break found while verifying a chain. Carries the offending record
/// id and the expected-vs-actual values so the break is diagnosable, not just
/// flagged.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("audit hash-chain broken at record {id} ({kind:?}): expected {expected}, actual {actual}")]
pub struct ChainBreak {
    pub id: String,
    pub kind: ChainBreakKind,
    pub expected: String,
    pub actual: String,
}

/// Deterministic, field-ordered byte encoding of a record's content.
///
/// The entire scheme rests on this being **stable**: the same logical record
/// must always produce the same bytes. Two guarantees make that hold:
/// * every field is length-prefixed (8-byte big-endian) and `Option` carries a
///   presence tag, so field boundaries are unambiguous and `None` differs from
///   `Some("")` — no separator can be forged by embedding it in a value;
/// * `details` is serialized with **recursively sorted object keys** (see
///   [`canonical_json`]), so JSON key-insertion order (and any JSONB reordering
///   on the storage round-trip) does not change the bytes.
///
/// Never replace this with `serde_json::to_vec` on a `Value` — `serde_json`'s
/// object ordering is not guaranteed stable across builds/features, and the
/// chain would silently stop verifying.
pub fn canonical_bytes(event: &ChainInput) -> Vec<u8> {
    let mut buf = Vec::new();
    push_bytes(&mut buf, event.id.as_bytes());
    // RFC 3339 UTC, microsecond precision — matches Postgres TIMESTAMPTZ.
    push_bytes(
        &mut buf,
        event
            .occurred_at
            .to_rfc3339_opts(SecondsFormat::Micros, true)
            .as_bytes(),
    );
    push_bytes(&mut buf, event.actor_type.as_bytes());
    push_opt(&mut buf, event.actor_id.as_deref());
    push_bytes(&mut buf, event.action.as_bytes());
    push_bytes(&mut buf, event.resource_type.as_bytes());
    push_opt(&mut buf, event.resource_id.as_deref());
    push_bytes(&mut buf, canonical_json(&event.details).as_bytes());
    push_opt(&mut buf, event.tenant_id.as_deref());
    push_opt(&mut buf, event.workspace_id.as_deref());
    push_opt(&mut buf, event.project_id.as_deref());
    push_opt(&mut buf, event.run_id.as_deref());
    push_opt(&mut buf, event.request_id.as_deref());
    push_opt(&mut buf, event.ip_address.as_deref());
    push_opt(&mut buf, event.user_agent.as_deref());
    push_opt(&mut buf, event.trace_id.as_deref());
    push_opt(&mut buf, event.span_id.as_deref());
    buf.extend_from_slice(&event.chain_seq.to_be_bytes());
    buf
}

/// Lowercase-hex SHA-256 over `prev_hash || 0x1f || canonical_bytes(input)`,
/// where `prev_hash` defaults to [`GENESIS`] for the first record.
pub fn record_hash(prev_hash: Option<&str>, input: &ChainInput) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prev_hash.unwrap_or(GENESIS).as_bytes());
    hasher.update([HASH_SEP]);
    hasher.update(canonical_bytes(input));
    hex::encode(hasher.finalize())
}

/// Verify a chain read **oldest-first**, returning the first break.
///
/// Checks, per record, in this order (so the diagnosis is the most specific):
/// 1. **sequence** — `chain_seq` is contiguous with its predecessor (a removed
///    record shows up here as a [`ChainBreakKind::SequenceGap`]);
/// 2. **content integrity** — the stored `record_hash` equals the recomputed
///    hash ([`ChainBreakKind::HashMismatch`] when a record's own content was
///    edited);
/// 3. **link** — `prev_hash` equals the predecessor's `record_hash`
///    ([`ChainBreakKind::LinkMismatch`]).
///
/// An empty slice verifies vacuously. The caller is responsible for passing the
/// full per-tenant chain from its genesis; this function verifies internal
/// consistency of whatever contiguous slice it is given.
pub fn verify_chain(records: &[ChainRecord]) -> Result<(), ChainBreak> {
    for (i, rec) in records.iter().enumerate() {
        if i > 0 {
            let prev_seq = records[i - 1].input.chain_seq;
            if rec.input.chain_seq != prev_seq + 1 {
                return Err(ChainBreak {
                    id: rec.input.id.clone(),
                    kind: ChainBreakKind::SequenceGap,
                    expected: (prev_seq + 1).to_string(),
                    actual: rec.input.chain_seq.to_string(),
                });
            }
        }

        let expected = record_hash(rec.prev_hash.as_deref(), &rec.input);
        if expected != rec.record_hash {
            return Err(ChainBreak {
                id: rec.input.id.clone(),
                kind: ChainBreakKind::HashMismatch,
                expected,
                actual: rec.record_hash.clone(),
            });
        }

        if i > 0 {
            let pred_hash = records[i - 1].record_hash.as_str();
            let link = rec.prev_hash.as_deref().unwrap_or(GENESIS);
            if link != pred_hash {
                return Err(ChainBreak {
                    id: rec.input.id.clone(),
                    kind: ChainBreakKind::LinkMismatch,
                    expected: pred_hash.to_string(),
                    actual: link.to_string(),
                });
            }
        }
    }
    Ok(())
}

/// Serialize a JSON value with **recursively sorted object keys** — the stable
/// form the hash is taken over. Rebuilding into a fresh map with keys inserted
/// in sorted order yields sorted output whether `serde_json`'s map is a
/// `BTreeMap` or an `IndexMap`.
fn canonical_json(value: &serde_json::Value) -> String {
    serde_json::to_string(&sort_value(value)).unwrap_or_default()
}

fn sort_value(value: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = serde_json::Map::new();
            for k in keys {
                out.insert(k.clone(), sort_value(&map[k]));
            }
            Value::Object(out)
        }
        Value::Array(arr) => Value::Array(arr.iter().map(sort_value).collect()),
        other => other.clone(),
    }
}

/// Length-prefix a byte field (8-byte big-endian length) so field boundaries
/// are unambiguous regardless of the bytes' content.
///
/// `pub(crate)` so the checkpoint preimage ([`crate::checkpoint`]) reuses the
/// exact same field-boundary encoding — one definition, no chance of the two
/// canonical forms drifting.
pub(crate) fn push_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    buf.extend_from_slice(&(bytes.len() as u64).to_be_bytes());
    buf.extend_from_slice(bytes);
}

/// Encode an optional field: a `0` tag for `None`, or a `1` tag followed by the
/// length-prefixed value — so `None` and `Some("")` are distinct.
pub(crate) fn push_opt(buf: &mut Vec<u8>, value: Option<&str>) {
    match value {
        None => buf.push(0),
        Some(s) => {
            buf.push(1);
            push_bytes(buf, s.as_bytes());
        }
    }
}
