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
}

impl Default for AirlockConfig {
    fn default() -> Self {
        Self {
            mode: AirlockMode::Shadow,
            rce: RceConfig::default(),
            velocity: VelocityConfig::default(),
            exfiltration: ExfiltrationConfig::default(),
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
}

impl Default for ExfiltrationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            target_tools: default_network_tools(),
            allowed_domains: Vec::new(),
            block_ip_addresses: true,
        }
    }
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
