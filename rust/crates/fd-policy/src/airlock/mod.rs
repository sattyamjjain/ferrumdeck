//! Airlock - Agent RASP (Runtime Application Self-Protection)
//!
//! Provides runtime security inspection for AI agent tool calls:
//!
//! ## Five Inspection Layers
//!
//! Run in this order by [`inspector::AirlockInspector::inspect`]; the first
//! violation short-circuits. The two drift layers only run when the
//! [`inspector::InspectionContext`] carries the relevant id (`agent_id` /
//! `tool_version_id`) AND the inspector was built with the matching
//! guard/monitor — the gateway wires both at boot (`state.rs`) and populates the
//! ids in `check_tool_policy` (`handlers/runs.rs`). When an id is absent the
//! layer skips (fail-open for that SIGNAL; the deny-by-default allowlist is
//! unaffected).
//!
//! -1. **Behavioral-Drift Monitor** (`behavioral_drift.rs`) — per-agent rolling
//!     z-score on cost (and latency / refusal / schema-violation), keyed by
//!     `agent_id`. Fires when a call is anomalous against the agent's baseline.
//!
//! 0. **Schema-Drift Guard** (`schema_drift.rs`) — validates `tool_input`
//!    against the registered input schema for `tool_version_id`. Catches the LLM
//!    fabricating a payload that no longer matches the tool's contract.
//!
//! 1. **Anti-RCE Pattern Matcher** (`patterns.rs`)
//!    - Detects dangerous code patterns: eval(), exec(), __import__
//!    - Catches obfuscation: base64 + eval combos
//!    - Blocks shell injection: pipes, redirects, command substitution
//!    - Prevents path traversal
//!
//! 2. **Financial Circuit Breaker** (`velocity.rs`)
//!    - Spending velocity limits (e.g., max $1.00 in 10 seconds)
//!    - Loop detection (same tool+args called repeatedly)
//!    - Per-run tracking with automatic cleanup
//!
//! 3. **Data Exfiltration Shield** (`exfiltration.rs`)
//!    - Credential DLP (`credential_dlp::scan_json`, default-on): scans the
//!      outbound payload for secrets **first**, so a leaked key is blocked before
//!      the domain allowlist is even consulted (fires even for an allow-listed host)
//!    - Domain whitelist for network tools
//!    - Blocks raw IP addresses (prevents C2 connections)
//!    - Per-domain data budget (`data_budget_per_domain_bytes`, opt-in): caps
//!      cumulative outbound bytes per `(run_id, domain)`
//!    - URL extraction from nested JSON payloads
//!
//! The schema-drift guard is seeded at gateway boot from the `tool_versions`
//! table and kept current at runtime: the registry write path calls
//! [`schema_drift::SchemaDriftGuard::upsert`] on each tool-version registration,
//! so a version registered after boot is drift-checked without a restart. A
//! call whose tool version has no compiled schema is fail-open by default; set
//! `SchemaDriftConfig::fail_closed_on_unregistered` to block it instead.
//!
//! ## Operating Modes
//!
//! - **Shadow Mode** (default): Log violations but don't block - safe for rollout
//! - **Enforce Mode**: Block violations - production mode
//!
//! ## Usage
//!
//! ```ignore
//! use fd_policy::airlock::{AirlockInspector, AirlockConfig, InspectionContext};
//!
//! // Create inspector with configuration
//! let config = AirlockConfig::default(); // Shadow mode by default
//! let inspector = AirlockInspector::new(config);
//!
//! // Inspect a tool call
//! let ctx = InspectionContext {
//!     run_id: run_id.clone(),
//!     tool_name: "write_file".to_string(),
//!     tool_input: serde_json::json!({"content": "hello"}),
//!     estimated_cost_cents: Some(10),
//!     tool_version_id: None, // Some(id) arms the schema-drift layer
//!     agent_id: None,        // Some(id) arms the behavioral-drift layer
//! };
//!
//! let result = inspector.inspect(&ctx).await;
//!
//! if !result.allowed {
//!     // Tool call blocked (or logged in shadow mode)
//!     println!("Blocked: {:?}", result.violation);
//! }
//!
//! // Record successful call for velocity tracking
//! inspector.record_call(&ctx).await;
//!
//! // Cleanup when run completes
//! inspector.clear_run(&run_id.to_string()).await;
//! ```

pub mod behavioral_drift;
pub mod coherence;
pub mod config;
pub mod credential_dlp;
pub mod exfiltration;
pub mod inspector;
pub mod patterns;
pub mod schema_drift;
pub mod velocity;

// Re-export main types for convenience
pub use behavioral_drift::{BehavioralDriftDetails, BehavioralDriftMonitor, Observation};
pub use coherence::{
    BlockingCategory, CoherenceMonitor, CoherenceSpan, TrajectoryEvent, COHERENCE_ANCHOR,
};
pub use config::{
    AirlockConfig, AirlockMode, BehavioralDriftConfig, CoherenceConfig, ExfiltrationConfig,
    RceConfig, SchemaDriftConfig, VelocityConfig,
};
pub use credential_dlp::{CredentialKind, CredentialMatch};
pub use inspector::{
    AirlockInspector, AirlockResult, AirlockViolation, InspectionContext, RiskLevel, ViolationType,
};
pub use schema_drift::{DriftDelta, DriftKind, SchemaDriftDetails, SchemaDriftGuard};
pub use velocity::VelocityStats;
