//! Airlock - Agent RASP (Runtime Application Self-Protection)
//!
//! Provides runtime security inspection for AI agent tool calls:
//!
//! ## Three Inspection Layers
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
//!    - Domain whitelist for network tools
//!    - Blocks raw IP addresses (prevents C2 connections)
//!    - URL extraction from nested JSON payloads
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

pub mod config;
pub mod exfiltration;
pub mod inspector;
pub mod patterns;
pub mod velocity;

// Re-export main types for convenience
pub use config::{AirlockConfig, AirlockMode, ExfiltrationConfig, RceConfig, VelocityConfig};
pub use inspector::{
    AirlockInspector, AirlockResult, AirlockViolation, InspectionContext, RiskLevel, ViolationType,
};
pub use velocity::VelocityStats;
