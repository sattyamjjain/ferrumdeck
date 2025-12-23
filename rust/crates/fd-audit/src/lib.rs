//! FerrumDeck Audit Log
//!
//! Append-only audit trail for compliance and forensics.
//! Events are immutable once written.

pub mod event;

pub use event::{AuditEvent, AuditEventKind};
