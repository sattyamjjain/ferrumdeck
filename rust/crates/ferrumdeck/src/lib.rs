//! # FerrumDeck
//!
//! A deterministic, in-path **enforcement engine** for AI agents: it returns an
//! `allow` / `deny` / `requires-approval` decision *before* a tool call
//! executes, rather than charting it after the fact.
//!
//! This is the umbrella crate — it re-exports the enforcement decision path from
//! [`ferrumdeck-policy`](https://crates.io/crates/ferrumdeck-policy) so a single
//! `cargo add ferrumdeck` gets you the engine. Everything here comes from
//! `fd_policy`; see that crate's docs for the full API.
//!
//! ```
//! use ferrumdeck::{PolicyEngine, ToolAllowlist};
//!
//! let engine = PolicyEngine::default();
//! let allowlist = ToolAllowlist {
//!     allowed_tools: vec!["read_file".into()],
//!     approval_required: vec![],
//!     denied_tools: vec!["delete_repo".into()],
//! };
//!
//! // Deny-by-default: only allowlisted tools pass the enforcement check.
//! assert!(engine.evaluate_tool_call_with(&allowlist, "read_file").is_allowed());
//! assert!(engine.evaluate_tool_call_with(&allowlist, "delete_repo").is_denied());
//! assert!(engine.evaluate_tool_call_with(&allowlist, "unknown").is_denied());
//! ```
//!
//! For governed source (the full Rust control plane, Python data plane, and
//! dashboard) see <https://github.com/sattyamjjain/ferrumdeck>.
#![forbid(unsafe_code)]

// Flatten the enforcement decision path into the crate root so
// `use ferrumdeck::{PolicyEngine, ToolAllowlist, AirlockInspector, ...}` works.
pub use fd_policy::*;

/// The underlying [`ferrumdeck-policy`] crate, for fully-qualified access
/// (`ferrumdeck::policy::…`).
pub use fd_policy as policy;

/// The audit trail + out-of-band chain-head checkpoint anchoring, from
/// [`ferrumdeck-audit`](https://crates.io/crates/ferrumdeck-audit). Gated behind
/// the optional `audit` feature (`cargo add ferrumdeck --features audit`); the
/// access path is `ferrumdeck::audit::…` (the crate's own import path is
/// `fd_audit`). This is where `verify_against_checkpoints`, `CheckpointSigner`,
/// and the hash-chain `verify_chain` live.
#[cfg(feature = "audit")]
pub use fd_audit as audit;
