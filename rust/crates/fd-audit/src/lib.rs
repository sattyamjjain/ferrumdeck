//! FerrumDeck Audit Log
//!
//! Append-only audit trail for compliance and forensics.
//! Events are immutable once written.

pub mod event;
pub mod redaction;

pub use event::{AuditEvent, AuditEventKind};
pub use redaction::{redact_json, redact_metadata, redact_string, REDACTED_PLACEHOLDER};
