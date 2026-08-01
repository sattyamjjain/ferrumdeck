//! FerrumDeck Audit Log
//!
//! Append-only **and hash-chained** audit trail for compliance and forensics.
//! Events are insert-only (no UPDATE/DELETE path; a DB trigger rejects both),
//! and each record commits to its predecessor via a SHA-256 hash-chain
//! ([`chain`]) so any insertion, deletion, or edit is *detectable* — see the
//! residual-limitation note on [`chain`] for what a hash-chain does and does not
//! guarantee.

pub mod chain;
pub mod event;
pub mod redaction;

pub use chain::{
    canonical_bytes, record_hash, verify_chain, ChainBreak, ChainBreakKind, ChainInput,
    ChainRecord, GENESIS,
};
pub use event::{AuditEvent, AuditEventKind};
pub use redaction::{redact_json, redact_metadata, redact_string, REDACTED_PLACEHOLDER};
