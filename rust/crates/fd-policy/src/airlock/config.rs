//! Airlock configuration types

use serde::{Deserialize, Serialize};

/// Airlock operation mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AirlockMode {
    /// Block violations (production mode)
    Enforce,
    /// Log violations but don't block (testing/rollout mode) - default for safety
    #[default]
    Shadow,
}

/// Main Airlock configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirlockConfig {
    /// Operating mode (enforce or shadow)
    #[serde(default)]
    pub mode: AirlockMode,

    /// Anti-RCE pattern detection configuration
    #[serde(default)]
    pub rce: RceConfig,

    /// Financial circuit breaker configuration
    #[serde(default)]
    pub velocity: VelocityConfig,

    /// Data exfiltration shield configuration
    #[serde(default)]
    pub exfiltration: ExfiltrationConfig,

    /// Schema-drift validation configuration
    #[serde(default)]
    pub schema_drift: SchemaDriftConfig,

    /// Behavioral-drift (per-agent rolling z-score) configuration
    #[serde(default)]
    pub behavioral_drift: BehavioralDriftConfig,
}

impl Default for AirlockConfig {
    fn default() -> Self {
        Self {
            mode: AirlockMode::Shadow,
            rce: RceConfig::default(),
            velocity: VelocityConfig::default(),
            exfiltration: ExfiltrationConfig::default(),
            schema_drift: SchemaDriftConfig::default(),
            behavioral_drift: BehavioralDriftConfig::default(),
        }
    }
}

/// Anti-RCE pattern detection configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RceConfig {
    /// Enable RCE pattern detection
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Tools to apply RCE detection to
    #[serde(default = "default_rce_tools")]
    pub target_tools: Vec<String>,

    /// Custom patterns to add (in addition to built-in)
    #[serde(default)]
    pub custom_patterns: Vec<String>,
}

impl Default for RceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            target_tools: default_rce_tools(),
            custom_patterns: Vec::new(),
        }
    }
}

/// Financial circuit breaker configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VelocityConfig {
    /// Enable velocity checking
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Max cost in cents per time window
    #[serde(default = "default_max_cost_cents")]
    pub max_cost_cents: u64,

    /// Time window in seconds
    #[serde(default = "default_window_seconds")]
    pub window_seconds: u64,

    /// Max identical calls before loop detection triggers
    #[serde(default = "default_loop_threshold")]
    pub loop_threshold: u32,
}

impl Default for VelocityConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_cost_cents: default_max_cost_cents(),
            window_seconds: default_window_seconds(),
            loop_threshold: default_loop_threshold(),
        }
    }
}

/// Data exfiltration shield configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExfiltrationConfig {
    /// Enable exfiltration detection
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Network tools to inspect
    #[serde(default = "default_network_tools")]
    pub target_tools: Vec<String>,

    /// Allowed domains (whitelist)
    #[serde(default)]
    pub allowed_domains: Vec<String>,

    /// Block raw IP addresses (prevents direct C2 connections)
    #[serde(default = "default_true")]
    pub block_ip_addresses: bool,

    /// Run the credential-DLP scanner on outbound payloads. Detects cloud
    /// keys / tokens / Luhn-valid PANs / mod-97-valid IBANs.
    #[serde(default = "default_true")]
    pub credential_dlp_enabled: bool,

    /// Maximum outbound bytes to a single domain per run before the shield
    /// kills further dispatches. `None` disables the budget. The shield
    /// estimates per-call body size from the serialised tool input.
    #[serde(default)]
    pub data_budget_per_domain_bytes: Option<u64>,
}

impl Default for ExfiltrationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            target_tools: default_network_tools(),
            allowed_domains: Vec::new(),
            block_ip_addresses: true,
            credential_dlp_enabled: true,
            data_budget_per_domain_bytes: None,
        }
    }
}

/// Schema-drift validation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDriftConfig {
    /// Enable schema-drift checking
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Risk score (0-100) assigned to drift violations. Clamped to 100.
    #[serde(default = "default_schema_drift_risk_score")]
    pub risk_score: u8,

    /// What to do when a call carries a `tool_version_id` for which the guard
    /// holds **no compiled schema** (registered-but-not-yet-populated, or a
    /// schema that failed to compile).
    ///
    /// * `false` (default) — **fail-open**: skip the check and let the call
    ///   through. This preserves the historical behaviour and never blocks a
    ///   call merely because its schema is unknown.
    /// * `true` — **fail-closed**: treat the missing schema as a drift
    ///   violation and block (enforce) / record (shadow). For a deny-by-default
    ///   enforcement plane this is the stricter, arguably-correct posture, but
    ///   it can reject live traffic for any tool version the guard has not seen,
    ///   so it is opt-in. The gateway exposes it via
    ///   `FERRUMDECK_SCHEMA_DRIFT_FAIL_CLOSED=true`.
    #[serde(default = "default_schema_drift_fail_closed")]
    pub fail_closed_on_unregistered: bool,
}

impl Default for SchemaDriftConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            risk_score: default_schema_drift_risk_score(),
            fail_closed_on_unregistered: default_schema_drift_fail_closed(),
        }
    }
}

fn default_schema_drift_risk_score() -> u8 {
    70
}

fn default_schema_drift_fail_closed() -> bool {
    false
}

/// Behavioral-drift (per-agent rolling z-score) configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehavioralDriftConfig {
    /// Enable behavioral-drift checking
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Max observations retained per agent per dimension.
    #[serde(default = "default_behavioral_window")]
    pub window_size: usize,

    /// Minimum observations required before drift checks fire. z-score on a
    /// small sample is meaningless — keep this honest.
    #[serde(default = "default_behavioral_min_observations")]
    pub min_observations: usize,

    /// Number of standard deviations from the rolling mean that triggers a
    /// violation. 3.0σ is roughly the 99.7th percentile under a normal
    /// distribution.
    #[serde(default = "default_behavioral_z_threshold")]
    pub z_threshold: f32,

    /// Risk score (0-100) assigned to behavioral-drift violations.
    #[serde(default = "default_behavioral_risk_score")]
    pub risk_score: u8,
}

impl Default for BehavioralDriftConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            window_size: default_behavioral_window(),
            min_observations: default_behavioral_min_observations(),
            z_threshold: default_behavioral_z_threshold(),
            risk_score: default_behavioral_risk_score(),
        }
    }
}

fn default_behavioral_window() -> usize {
    100
}

fn default_behavioral_min_observations() -> usize {
    20
}

fn default_behavioral_z_threshold() -> f32 {
    3.0
}

fn default_behavioral_risk_score() -> u8 {
    65
}

/// Coherence-divergence monitor configuration.
///
/// Unlike the per-call layers above, the coherence monitor is *sequential* —
/// it consumes a run trajectory and flags a stated blocking fact followed by
/// a contradicting closure action (see [`super::coherence`]). It is driven by
/// its own [`super::coherence::CoherenceMonitor`] rather than by
/// [`super::inspector::AirlockInspector::inspect`], so this config is consumed
/// directly by that monitor and is intentionally not a field of
/// [`AirlockConfig`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoherenceConfig {
    /// Enable coherence-divergence checking.
    #[serde(default = "default_true")]
    pub enabled: bool,

    /// Max trajectory events between a stated blocking fact and a
    /// contradicting closure action for them to be paired. Beyond this the
    /// fact is treated as stale and dropped.
    #[serde(default = "default_coherence_lookahead")]
    pub lookahead: usize,

    /// Risk score (0-100) assigned to coherence-divergence violations.
    /// Clamped to 100.
    #[serde(default = "default_coherence_risk_score")]
    pub risk_score: u8,

    /// Minimum confidence in `[0, 1]` required to surface a divergence —
    /// guards the false-positive rate.
    #[serde(default = "default_coherence_min_confidence")]
    pub min_confidence: f64,
}

impl Default for CoherenceConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            lookahead: default_coherence_lookahead(),
            risk_score: default_coherence_risk_score(),
            min_confidence: default_coherence_min_confidence(),
        }
    }
}

fn default_coherence_lookahead() -> usize {
    8
}

fn default_coherence_risk_score() -> u8 {
    70
}

fn default_coherence_min_confidence() -> f64 {
    0.5
}

// =============================================================================
// Default value functions for serde
// =============================================================================

fn default_true() -> bool {
    true
}

fn default_max_cost_cents() -> u64 {
    100 // $1.00
}

fn default_window_seconds() -> u64 {
    10
}

fn default_loop_threshold() -> u32 {
    3
}

fn default_rce_tools() -> Vec<String> {
    vec![
        "write_file".to_string(),
        "create_file".to_string(),
        "create_or_update_file".to_string(),
        "python_repl".to_string(),
        "bash".to_string(),
        "execute_command".to_string(),
        "run_script".to_string(),
        "shell".to_string(),
    ]
}

fn default_network_tools() -> Vec<String> {
    vec![
        "http_get".to_string(),
        "http_post".to_string(),
        "http_request".to_string(),
        "curl".to_string(),
        "fetch".to_string(),
        "requests".to_string(),
        "webhook".to_string(),
        "send_email".to_string(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let config = AirlockConfig::default();
        assert_eq!(config.mode, AirlockMode::Shadow);
        assert!(config.rce.enabled);
        assert!(config.velocity.enabled);
        assert!(config.exfiltration.enabled);
    }

    #[test]
    fn test_default_rce_tools() {
        let tools = default_rce_tools();
        assert!(tools.contains(&"write_file".to_string()));
        assert!(tools.contains(&"bash".to_string()));
    }

    #[test]
    fn test_velocity_defaults() {
        let config = VelocityConfig::default();
        assert_eq!(config.max_cost_cents, 100);
        assert_eq!(config.window_seconds, 10);
        assert_eq!(config.loop_threshold, 3);
    }
}
