//! Out-of-band **chain-head checkpoints** — anchoring the hash-chain so a
//! rewritten tail is detectable (#14).
//!
//! The hash-chain in [`crate::chain`] makes tampering *within* the chain
//! detectable, but it has one honest residual: an actor who holds every input
//! can rewrite the **entire tail** and recompute a *self-consistent* chain —
//! every `record_hash` and link validates, because the attacker produced them
//! all. [`crate::chain::verify_chain`] cannot catch that, because there is
//! nothing left inside the chain to disagree with.
//!
//! A **checkpoint** closes the gap by committing to the chain *head* somewhere
//! the attacker cannot rewrite. It is a small signed record of
//! `(tenant_id, chain_seq, record_hash, checkpointed_at)` — the head's position
//! and hash at a moment in time — signed with an **Ed25519 key that is not the
//! database's**. Because a record's `record_hash` transitively commits to the
//! entire prefix before it (each hash is `H(prev_hash || content)`), a checkpoint
//! over seq *S* pins every record with `chain_seq <= S`. [`verify_against_checkpoints`]
//! then proves the chain has not been rewritten past the most recent checkpoint,
//! and names the checkpoint it verified against.
//!
//! **The guarantee, stated exactly.** Tampering is detectable **up to the most
//! recent checkpoint**: any rewrite of a record at or before the anchored
//! `chain_seq` changes that seq's `record_hash` and fails against the signed
//! checkpoint. Records **after** the last checkpoint keep only the previous
//! (in-chain) guarantee — that window is reported, not hidden. This is
//! detection, **not prevention**: it is *not* tamper-proof, and the anchor is
//! only as strong as the sink being genuinely out-of-band and the signing key
//! being off-box (a file sink on the DB host and a key a root actor can read is
//! a weak anchor — see the residual note on [`FileCheckpointSink`]).
//!
//! **Purity.** The signing, verification, and [`verify_against_checkpoints`]
//! detection logic are I/O-free and clock-free (the caller supplies the
//! timestamp, exactly as [`crate::chain::ChainInput`] does), so the load-bearing
//! detection is unit-testable with no database and no filesystem. Only the
//! concrete [`FileCheckpointSink`] touches disk; the [`CheckpointSink`] trait
//! keeps that boundary swappable.

use chrono::{DateTime, SecondsFormat, Utc};
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::chain::{push_bytes, push_opt, verify_chain, ChainBreak, ChainRecord};

/// Domain-separation tag mixed into every checkpoint signing preimage, so a
/// checkpoint's signed bytes can never be confused with a chain record's hash
/// preimage or any other signed message in the system.
const CHECKPOINT_DOMAIN: &str = "ferrumdeck/audit-checkpoint/v1";

/// The facts a checkpoint commits to: one tenant's chain head at a moment in
/// time. This is the body that gets signed — the signature and key id live on
/// [`Checkpoint`], not here (they are outputs).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckpointBody {
    /// The chain this anchors. `None` is the global/system chain (the same
    /// sentinel-folded chain `AuditRepo` maintains for NULL-tenant events).
    pub tenant_id: Option<String>,
    /// The head position anchored (genesis = 1).
    pub chain_seq: i64,
    /// The head record's `record_hash` at `chain_seq`. Because the chain is a
    /// hash-chain, this transitively commits to the whole prefix `1..=chain_seq`.
    pub record_hash: String,
    /// When the checkpoint was taken. RFC 3339 UTC, microsecond precision — the
    /// caller supplies it (this module reads no clock).
    pub checkpointed_at: DateTime<Utc>,
}

/// A signed [`CheckpointBody`]: the anchored head plus an Ed25519 signature over
/// its canonical preimage and the id of the key that produced it. Serialized to
/// the sink (one JSON object per line); the signature is verified by recomputing
/// the preimage from the typed fields, so JSON key order on the wire is
/// irrelevant.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Checkpoint {
    pub body: CheckpointBody,
    /// Which trusted key signed this (a verifier selects the key by this id).
    pub key_id: String,
    /// Lowercase-hex Ed25519 signature over [`checkpoint_signing_bytes`].
    pub signature_hex: String,
}

/// Deterministic, field-ordered, length-prefixed preimage a checkpoint's
/// signature is taken over — the exact analogue of
/// [`crate::chain::canonical_bytes`], sharing its field-boundary primitives so
/// the two encodings cannot drift. Never sign `serde_json::to_vec` of the body:
/// JSON object ordering is not a stable signing surface.
pub fn checkpoint_signing_bytes(body: &CheckpointBody) -> Vec<u8> {
    let mut buf = Vec::new();
    push_bytes(&mut buf, CHECKPOINT_DOMAIN.as_bytes());
    push_opt(&mut buf, body.tenant_id.as_deref());
    buf.extend_from_slice(&body.chain_seq.to_be_bytes());
    push_bytes(&mut buf, body.record_hash.as_bytes());
    push_bytes(
        &mut buf,
        body.checkpointed_at
            .to_rfc3339_opts(SecondsFormat::Micros, true)
            .as_bytes(),
    );
    buf
}

/// Signs chain-head checkpoints with an Ed25519 key.
///
/// The key is **not** the database's — that is the whole point: a DB-privileged
/// actor who rewrites rows still cannot mint a checkpoint that
/// [`verify_against_checkpoints`] will trust. Construct from raw key bytes the
/// operator provisions out-of-band (env / file / KMS export); this type reads no
/// RNG and no clock.
pub struct CheckpointSigner {
    key_id: String,
    signing_key: SigningKey,
}

impl CheckpointSigner {
    /// Build a signer from a 32-byte Ed25519 seed and the id verifiers will use
    /// to select this key. Deterministic — the same seed yields the same key.
    pub fn from_seed(key_id: impl Into<String>, seed: &[u8; 32]) -> Self {
        Self {
            key_id: key_id.into(),
            signing_key: SigningKey::from_bytes(seed),
        }
    }

    /// The public half, for handing to a [`CheckpointVerifier`].
    pub fn verifying_key(&self) -> VerifyingKey {
        self.signing_key.verifying_key()
    }

    /// The key id this signer stamps onto its checkpoints.
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// Sign a checkpoint body, producing a [`Checkpoint`] ready to append to a
    /// sink. Ed25519 signing is deterministic (RFC 8032).
    pub fn sign(&self, body: CheckpointBody) -> Checkpoint {
        let sig: Signature = self.signing_key.sign(&checkpoint_signing_bytes(&body));
        Checkpoint {
            body,
            key_id: self.key_id.clone(),
            signature_hex: hex::encode(sig.to_bytes()),
        }
    }
}

/// The set of trusted public keys checkpoints are verified against, keyed by id.
///
/// A checkpoint is trusted only if its `key_id` is present here **and** its
/// signature verifies under that key. A checkpoint signed by any other key — the
/// case where an attacker who can write the sink but does not hold a trusted key
/// forges a checkpoint over their rewritten tail — is not trusted and cannot
/// upgrade the verdict to [`CheckpointOutcome::Verified`].
#[derive(Debug, Clone, Default)]
pub struct CheckpointVerifier {
    keys: BTreeMap<String, VerifyingKey>,
}

impl CheckpointVerifier {
    pub fn new() -> Self {
        Self::default()
    }

    /// Trust `key` under `key_id`.
    pub fn insert_key(&mut self, key_id: impl Into<String>, key: VerifyingKey) {
        self.keys.insert(key_id.into(), key);
    }

    /// Trust a key given its 32-byte public key as lowercase hex.
    pub fn insert_key_hex(
        &mut self,
        key_id: impl Into<String>,
        key_hex: &str,
    ) -> Result<(), CheckpointKeyError> {
        let raw = hex::decode(key_hex).map_err(|_| CheckpointKeyError::Malformed)?;
        let arr: [u8; 32] = raw.try_into().map_err(|_| CheckpointKeyError::Malformed)?;
        let vk = VerifyingKey::from_bytes(&arr).map_err(|_| CheckpointKeyError::Malformed)?;
        self.insert_key(key_id, vk);
        Ok(())
    }

    /// True iff `cp.key_id` is a trusted key and the signature verifies over the
    /// checkpoint's recomputed preimage.
    pub fn verify_signature(&self, cp: &Checkpoint) -> bool {
        let Some(vk) = self.keys.get(&cp.key_id) else {
            return false;
        };
        let Ok(raw) = hex::decode(&cp.signature_hex) else {
            return false;
        };
        let Ok(arr) = <[u8; 64]>::try_from(raw) else {
            return false;
        };
        let sig = Signature::from_bytes(&arr);
        vk.verify(&checkpoint_signing_bytes(&cp.body), &sig).is_ok()
    }
}

/// A malformed key or signature bytes (bad hex or wrong length).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum CheckpointKeyError {
    #[error("malformed ed25519 key (expected 32-byte lowercase hex)")]
    Malformed,
}

/// How a chain diverged from its anchor — the concrete detection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Divergence {
    /// The record at the anchored `chain_seq` exists but its `record_hash`
    /// differs from the signed checkpoint — the tail was rewritten.
    HashMismatch { actual_hash: String },
    /// The chain no longer reaches the anchored `chain_seq` (it is shorter) —
    /// the tail was truncated below an anchored point.
    Truncated { chain_len: usize },
}

/// Why verification degraded to the in-chain-only guarantee.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DegradeReason {
    /// No checkpoints were supplied at all.
    NoCheckpoints,
    /// Checkpoints exist but none carried a valid signature from a trusted key,
    /// or none belonged to this chain's tenant — nothing to anchor against.
    NoTrustedCheckpoint,
}

/// The verdict from [`verify_against_checkpoints`]. Strictly stronger than
/// [`crate::chain::verify_chain`]: it first requires internal consistency, then
/// cross-checks the head against the most recent trusted checkpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CheckpointOutcome {
    /// The chain is internally consistent **and** anchored: the record at the
    /// most recent trusted checkpoint's `anchored_seq` matches the signed
    /// `checkpoint_hash`, so the whole prefix `1..=anchored_seq` is pinned.
    /// `records_after` is the number of records past the anchor — the window
    /// that keeps only the previous (in-chain) guarantee.
    Verified {
        anchored_seq: i64,
        checkpoint_hash: String,
        records_after: usize,
    },
    /// A trusted checkpoint anchors `anchored_seq`, but the chain we hold
    /// disagrees there. This is the whole-tail-rewrite / truncation detection —
    /// the case [`crate::chain::verify_chain`] alone cannot catch.
    Diverged {
        anchored_seq: i64,
        expected_hash: String,
        divergence: Divergence,
    },
    /// The chain is internally consistent, but there is **no** trusted checkpoint
    /// to anchor it. This is **not** a pass: the guarantee is exactly the
    /// previous one (insertion/deletion/edit within the chain are detected; a
    /// whole-tail rewrite is **not**). Surfaced as its own variant precisely so a
    /// missing anchor cannot be mistaken for a proven-untampered chain.
    Degraded { reason: DegradeReason },
    /// The chain is internally broken — the weaker case, already caught by
    /// [`crate::chain::verify_chain`]. Reported as-is; no checkpoint needed.
    ChainBroken(ChainBreak),
}

impl CheckpointOutcome {
    /// True only for [`CheckpointOutcome::Verified`] — a chain proven unaltered
    /// up to a trusted checkpoint. Everything else (diverged, degraded, broken)
    /// is *not* an affirmative proof and must not be treated as one.
    pub fn is_verified(&self) -> bool {
        matches!(self, CheckpointOutcome::Verified { .. })
    }

    /// True for a detected rewrite/truncation.
    pub fn is_diverged(&self) -> bool {
        matches!(self, CheckpointOutcome::Diverged { .. })
    }

    /// True when the guarantee degraded to in-chain-only (no trusted anchor).
    pub fn is_degraded(&self) -> bool {
        matches!(self, CheckpointOutcome::Degraded { .. })
    }
}

/// Verify a per-tenant chain **against** its checkpoints — the anchored,
/// whole-tail-rewrite-catching verification.
///
/// `records` is one tenant's chain, oldest-first (as [`crate::chain::verify_chain`]
/// consumes it). `checkpoints` is any set of checkpoints; only those with a valid
/// signature from a key in `verifier` and belonging to this chain's tenant are
/// considered. The steps, in order of strength:
///
/// 1. **Internal consistency** — run [`crate::chain::verify_chain`]. A break here
///    returns [`CheckpointOutcome::ChainBroken`] (the weaker attacker).
/// 2. **Select the anchor** — among trusted, in-tenant checkpoints, take the one
///    with the highest `chain_seq`. None ⇒ [`CheckpointOutcome::Degraded`]
///    (stated, not silently passed).
/// 3. **Cross-check the head** — find the record at the anchored `chain_seq`.
///    Its `record_hash` matching the checkpoint proves the prefix up to there is
///    unaltered ⇒ [`CheckpointOutcome::Verified`], reporting the unprotected
///    window after it. A mismatch, or a chain too short to reach the anchor, is
///    the detection ⇒ [`CheckpointOutcome::Diverged`].
pub fn verify_against_checkpoints(
    records: &[ChainRecord],
    checkpoints: &[Checkpoint],
    verifier: &CheckpointVerifier,
) -> CheckpointOutcome {
    // 1. Internal consistency is a precondition — a chain that fails here is
    //    already caught without any checkpoint.
    if let Err(brk) = verify_chain(records) {
        return CheckpointOutcome::ChainBroken(brk);
    }

    // This chain's tenant. Inferred from the records; an empty chain cannot be
    // bound to a tenant here, so every trusted checkpoint is eligible (an empty
    // chain against a checkpoint at seq >= 1 is a truncation-to-empty below the
    // anchor, which the seq lookup below reports as Diverged/Truncated).
    let tenant: Option<Option<&str>> = records.first().map(|r| r.input.tenant_id.as_deref());

    // 2. Trusted, in-tenant checkpoints, most-recent (highest seq) first.
    let mut trusted: Vec<&Checkpoint> = checkpoints
        .iter()
        .filter(|c| verifier.verify_signature(c))
        .filter(|c| match tenant {
            Some(t) => c.body.tenant_id.as_deref() == t,
            None => true,
        })
        .collect();

    if trusted.is_empty() {
        let reason = if checkpoints.is_empty() {
            DegradeReason::NoCheckpoints
        } else {
            DegradeReason::NoTrustedCheckpoint
        };
        return CheckpointOutcome::Degraded { reason };
    }

    trusted.sort_by_key(|c| std::cmp::Reverse(c.body.chain_seq));
    let anchor = trusted[0];
    let anchored_seq = anchor.body.chain_seq;

    // 3. Cross-check the head. The record_hash at anchored_seq transitively
    //    commits to the entire prefix 1..=anchored_seq, so one comparison pins
    //    everything up to the anchor.
    match records.iter().find(|r| r.input.chain_seq == anchored_seq) {
        None => CheckpointOutcome::Diverged {
            anchored_seq,
            expected_hash: anchor.body.record_hash.clone(),
            divergence: Divergence::Truncated {
                chain_len: records.len(),
            },
        },
        Some(rec) if rec.record_hash == anchor.body.record_hash => {
            let records_after = records
                .iter()
                .filter(|r| r.input.chain_seq > anchored_seq)
                .count();
            CheckpointOutcome::Verified {
                anchored_seq,
                checkpoint_hash: anchor.body.record_hash.clone(),
                records_after,
            }
        }
        Some(rec) => CheckpointOutcome::Diverged {
            anchored_seq,
            expected_hash: anchor.body.record_hash.clone(),
            divergence: Divergence::HashMismatch {
                actual_hash: rec.record_hash.clone(),
            },
        },
    }
}

// ---------------------------------------------------------------------------
// Append-only sinks (the only I/O in this module).
//
// A checkpoint is worthless if it lives where the DB actor can rewrite it. The
// sink is the out-of-band medium; the trait keeps it swappable so an operator
// can point checkpoints at object storage or a transparency log without the
// crypto above changing.
// ---------------------------------------------------------------------------

/// A read/write error from a [`CheckpointSink`].
#[derive(Debug, thiserror::Error)]
pub enum CheckpointSinkError {
    #[error("checkpoint sink I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("checkpoint sink holds a malformed record: {0}")]
    Malformed(#[from] serde_json::Error),
}

/// An append-only store for checkpoints, outside the database.
///
/// Implementations MUST be append-only (never rewrite or drop an existing
/// record) and SHOULD durably persist before returning from [`append`](CheckpointSink::append).
/// The trait exists so the out-of-band medium is swappable — ship a file sink,
/// add object storage / a transparency log later — while [`verify_against_checkpoints`]
/// stays medium-agnostic.
pub trait CheckpointSink {
    /// Durably append one checkpoint.
    fn append(&self, checkpoint: &Checkpoint) -> Result<(), CheckpointSinkError>;
    /// Read every checkpoint back, in append order.
    fn read_all(&self) -> Result<Vec<Checkpoint>, CheckpointSinkError>;
}

/// A newline-delimited-JSON file sink, `fsync`'d on every append.
///
/// Each checkpoint is one JSON object on its own line; the file is opened
/// append-only and flushed to disk (`sync_all`) before `append` returns.
///
/// **Residual, stated plainly:** a file on the *same host as the database* is a
/// **weak anchor** — a root actor who can rewrite `audit_events` can usually
/// rewrite this file too, and read the signing key if it also lives on that
/// host. This sink is the reference implementation and is correct for a
/// deployment whose sink host / key custody is separated from the DB; a robust
/// anchor wants a remote append-only medium (object-lock bucket, transparency
/// log) and an off-host key. That separation is deployment/ops, not this type.
pub struct FileCheckpointSink {
    path: std::path::PathBuf,
}

impl FileCheckpointSink {
    pub fn new(path: impl Into<std::path::PathBuf>) -> Self {
        Self { path: path.into() }
    }

    /// The file this sink writes to.
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl CheckpointSink for FileCheckpointSink {
    fn append(&self, checkpoint: &Checkpoint) -> Result<(), CheckpointSinkError> {
        use std::io::Write;
        let mut line = serde_json::to_string(checkpoint)?;
        line.push('\n');
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        file.write_all(line.as_bytes())?;
        // Durable before we claim success — an anchor that can be lost on a
        // crash is not an anchor.
        file.sync_all()?;
        Ok(())
    }

    fn read_all(&self) -> Result<Vec<Checkpoint>, CheckpointSinkError> {
        let contents = match std::fs::read_to_string(&self.path) {
            Ok(c) => c,
            // A sink that was never written to holds zero checkpoints — that is
            // a legitimate "no anchor yet" state, not an error.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(e.into()),
        };
        let mut out = Vec::new();
        for line in contents.lines() {
            if line.trim().is_empty() {
                continue;
            }
            out.push(serde_json::from_str::<Checkpoint>(line)?);
        }
        Ok(out)
    }
}
