//! FerrumDeck Audit Log
//!
//! Append-only **and hash-chained** audit trail for compliance and forensics.
//! Events are insert-only (no UPDATE/DELETE path; a DB trigger rejects both),
//! and each record commits to its predecessor via a SHA-256 hash-chain
//! ([`chain`]) so any insertion, deletion, or edit is *detectable*.
//!
//! The chain is **anchored out-of-band** by signed head [`checkpoint`]s: a
//! rewritten-but-self-consistent tail — the one thing the chain alone cannot
//! catch — is detected by [`checkpoint::verify_against_checkpoints`], up to the
//! most recent checkpoint. See the guarantee note on [`checkpoint`] for exactly
//! what is and is not proven (detectable up to the last checkpoint; the window
//! after it keeps the in-chain guarantee; not tamper-proof).

pub mod chain;
pub mod checkpoint;
pub mod event;
pub mod redaction;

pub use chain::{
    canonical_bytes, record_hash, verify_chain, ChainBreak, ChainBreakKind, ChainInput,
    ChainRecord, GENESIS,
};
pub use checkpoint::{
    checkpoint_signing_bytes, verify_against_checkpoints, Checkpoint, CheckpointBody,
    CheckpointOutcome, CheckpointSigner, CheckpointSink, CheckpointSinkError, CheckpointVerifier,
    DegradeReason, Divergence, FileCheckpointSink,
};
pub use event::{AuditEvent, AuditEventKind};
pub use redaction::{redact_json, redact_metadata, redact_string, REDACTED_PLACEHOLDER};
