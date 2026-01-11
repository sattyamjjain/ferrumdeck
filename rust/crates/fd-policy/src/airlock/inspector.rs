//! Main Airlock Inspector
//!
//! Coordinates all inspection layers:
//! 1. Anti-RCE pattern matching
//! 2. Velocity/circuit breaker
//! 3. Data exfiltration shield
//!
//! Returns combined result with risk scoring

use super::config::{AirlockConfig, AirlockMode};
use super::exfiltration::ExfiltrationShield;
use super::patterns::RcePatternMatcher;
use super::velocity::VelocityTracker;
use fd_core::RunId;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tracing::{debug, info, warn};

/// Violation type categories
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ViolationType {
    /// Dangerous code pattern detected (eval, exec, etc.)
    RcePattern,
    /// Spending velocity exceeded
    VelocityBreach,
    /// Same tool+args called repeatedly (infinite loop)
    LoopDetection,
    /// Unauthorized network destination
    ExfiltrationAttempt,
    /// Raw IP address used instead of domain
    IpAddressUsed,
}

/// Risk level for violations
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RiskLevel {
    /// Risk score 0-39: Minor concern
    Low,
    /// Risk score 40-59: Moderate concern
    Medium,
    /// Risk score 60-79: Serious concern
    High,
    /// Risk score 80-100: Severe threat
    Critical,
}

impl RiskLevel {
    /// Convert risk score to level
    pub fn from_score(score: u8) -> Self {
        match score {
            0..=39 => RiskLevel::Low,
            40..=59 => RiskLevel::Medium,
            60..=79 => RiskLevel::High,
            _ => RiskLevel::Critical,
        }
    }

    /// Convert level to string for display
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::Low => "low",
            RiskLevel::Medium => "medium",
            RiskLevel::High => "high",
            RiskLevel::Critical => "critical",
        }
    }
}

/// A detected violation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirlockViolation {
    /// Type of violation
    pub violation_type: ViolationType,
    /// Risk score (0-100)
    pub risk_score: u8,
    /// Risk level derived from score
    pub risk_level: RiskLevel,
    /// Human-readable description
    pub details: String,
    /// Pattern or rule that triggered this
    pub trigger: String,
}

/// Context for inspection
#[derive(Debug, Clone)]
pub struct InspectionContext {
    /// Run ID for velocity tracking
    pub run_id: RunId,
    /// Tool being called
    pub tool_name: String,
    /// Tool input payload
    pub tool_input: serde_json::Value,
    /// Estimated cost for this tool call (in cents)
    pub estimated_cost_cents: Option<u64>,
}

/// Result of Airlock inspection
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AirlockResult {
    /// Whether the tool call is allowed
    pub allowed: bool,
    /// Any detected violation (None if clean)
    pub violation: Option<AirlockViolation>,
    /// Whether we're in shadow mode (log-only)
    pub shadow_mode: bool,
    /// Summary risk score across all checks
    pub risk_score: u8,
    /// Summary risk level
    pub risk_level: RiskLevel,
}

impl Default for AirlockResult {
    fn default() -> Self {
        Self {
            allowed: true,
            violation: None,
            shadow_mode: false,
            risk_score: 0,
            risk_level: RiskLevel::Low,
        }
    }
}

/// Main Airlock Inspector
///
/// Coordinates all inspection layers and provides a unified interface
/// for tool call inspection.
pub struct AirlockInspector {
    /// Configuration
    config: AirlockConfig,
    /// Anti-RCE pattern matcher
    rce_matcher: RcePatternMatcher,
    /// Financial circuit breaker
    velocity_tracker: Arc<VelocityTracker>,
    /// Data exfiltration shield
    exfiltration_shield: ExfiltrationShield,
}

impl AirlockInspector {
    /// Create a new Airlock inspector from configuration
    pub fn new(config: AirlockConfig) -> Self {
        let rce_matcher = RcePatternMatcher::new(&config.rce);
        let velocity_tracker = Arc::new(VelocityTracker::new(config.velocity.clone()));
        let exfiltration_shield = ExfiltrationShield::new(&config.exfiltration);

        info!(
            mode = ?config.mode,
            rce_enabled = config.rce.enabled,
            velocity_enabled = config.velocity.enabled,
            exfil_enabled = config.exfiltration.enabled,
            "Airlock inspector initialized"
        );

        Self {
            config,
            rce_matcher,
            velocity_tracker,
            exfiltration_shield,
        }
    }

    /// Check if Airlock is in shadow mode (log-only, don't block)
    pub fn is_shadow_mode(&self) -> bool {
        matches!(self.config.mode, AirlockMode::Shadow)
    }

    /// Get reference to current configuration
    pub fn config(&self) -> &AirlockConfig {
        &self.config
    }

    /// Get reference to velocity tracker for recording calls
    pub fn velocity_tracker(&self) -> Arc<VelocityTracker> {
        Arc::clone(&self.velocity_tracker)
    }

    /// Inspect a tool call through all layers
    ///
    /// Returns an AirlockResult indicating whether the call should be allowed
    /// and any detected violations.
    pub async fn inspect(&self, ctx: &InspectionContext) -> AirlockResult {
        let shadow_mode = self.is_shadow_mode();

        debug!(
            run_id = %ctx.run_id,
            tool = %ctx.tool_name,
            shadow_mode = shadow_mode,
            "Inspecting tool call"
        );

        // Layer 1: Anti-RCE pattern detection
        if self.config.rce.enabled {
            if let Some(violation) = self.rce_matcher.check(&ctx.tool_name, &ctx.tool_input) {
                warn!(
                    run_id = %ctx.run_id,
                    tool = %ctx.tool_name,
                    violation_type = ?violation.violation_type,
                    risk_score = violation.risk_score,
                    trigger = %violation.trigger,
                    shadow_mode = shadow_mode,
                    "RCE pattern detected"
                );

                return AirlockResult {
                    allowed: shadow_mode, // Block if enforce mode
                    violation: Some(violation.clone()),
                    shadow_mode,
                    risk_score: violation.risk_score,
                    risk_level: violation.risk_level,
                };
            }
        }

        // Layer 2: Velocity/circuit breaker
        if self.config.velocity.enabled {
            if let Some(violation) = self.velocity_tracker.check(ctx).await {
                warn!(
                    run_id = %ctx.run_id,
                    tool = %ctx.tool_name,
                    violation_type = ?violation.violation_type,
                    risk_score = violation.risk_score,
                    shadow_mode = shadow_mode,
                    "Velocity violation detected"
                );

                return AirlockResult {
                    allowed: shadow_mode,
                    violation: Some(violation.clone()),
                    shadow_mode,
                    risk_score: violation.risk_score,
                    risk_level: violation.risk_level,
                };
            }
        }

        // Layer 3: Exfiltration shield
        if self.config.exfiltration.enabled {
            if let Some(violation) = self
                .exfiltration_shield
                .check(&ctx.tool_name, &ctx.tool_input)
            {
                warn!(
                    run_id = %ctx.run_id,
                    tool = %ctx.tool_name,
                    violation_type = ?violation.violation_type,
                    risk_score = violation.risk_score,
                    trigger = %violation.trigger,
                    shadow_mode = shadow_mode,
                    "Exfiltration attempt detected"
                );

                return AirlockResult {
                    allowed: shadow_mode,
                    violation: Some(violation.clone()),
                    shadow_mode,
                    risk_score: violation.risk_score,
                    risk_level: violation.risk_level,
                };
            }
        }

        // All checks passed
        debug!(
            run_id = %ctx.run_id,
            tool = %ctx.tool_name,
            "Tool call passed all Airlock checks"
        );

        AirlockResult::default()
    }

    /// Record a completed tool call for velocity tracking
    ///
    /// Should be called after a tool call completes successfully.
    pub async fn record_call(&self, ctx: &InspectionContext) {
        if self.config.velocity.enabled {
            self.velocity_tracker.record(ctx).await;
        }
    }

    /// Clear velocity tracking data for a completed run
    ///
    /// Should be called when a run completes to free memory.
    pub async fn clear_run(&self, run_id: &str) {
        self.velocity_tracker.clear_run(run_id).await;
    }

    /// Get current velocity tracker statistics
    pub async fn velocity_stats(&self) -> super::velocity::VelocityStats {
        self.velocity_tracker.stats().await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::airlock::config::{ExfiltrationConfig, RceConfig, VelocityConfig};

    fn create_test_config() -> AirlockConfig {
        AirlockConfig {
            mode: AirlockMode::Enforce,
            rce: RceConfig::default(),
            velocity: VelocityConfig::default(),
            exfiltration: ExfiltrationConfig::default(),
        }
    }

    fn create_shadow_config() -> AirlockConfig {
        AirlockConfig {
            mode: AirlockMode::Shadow,
            ..create_test_config()
        }
    }

    fn create_context(tool: &str, input: serde_json::Value) -> InspectionContext {
        InspectionContext {
            run_id: RunId::new(),
            tool_name: tool.to_string(),
            tool_input: input,
            estimated_cost_cents: Some(10),
        }
    }

    #[tokio::test]
    async fn test_clean_tool_call() {
        let inspector = AirlockInspector::new(create_test_config());

        let ctx = create_context(
            "read_file",
            serde_json::json!({
                "path": "/home/user/document.txt"
            }),
        );

        let result = inspector.inspect(&ctx).await;
        assert!(result.allowed);
        assert!(result.violation.is_none());
        assert_eq!(result.risk_score, 0);
    }

    #[tokio::test]
    async fn test_rce_pattern_blocked_enforce() {
        let inspector = AirlockInspector::new(create_test_config());

        let ctx = create_context(
            "write_file",
            serde_json::json!({
                "content": "result = eval(user_input)"
            }),
        );

        let result = inspector.inspect(&ctx).await;
        assert!(!result.allowed); // Blocked in enforce mode
        assert!(result.violation.is_some());
        assert_eq!(
            result.violation.unwrap().violation_type,
            ViolationType::RcePattern
        );
    }

    #[tokio::test]
    async fn test_rce_pattern_logged_shadow() {
        let inspector = AirlockInspector::new(create_shadow_config());

        let ctx = create_context(
            "write_file",
            serde_json::json!({
                "content": "result = eval(user_input)"
            }),
        );

        let result = inspector.inspect(&ctx).await;
        assert!(result.allowed); // Allowed in shadow mode
        assert!(result.shadow_mode);
        assert!(result.violation.is_some()); // But violation still detected
    }

    #[tokio::test]
    async fn test_exfiltration_blocked() {
        let config = AirlockConfig {
            mode: AirlockMode::Enforce,
            rce: RceConfig::default(),
            velocity: VelocityConfig::default(),
            exfiltration: ExfiltrationConfig {
                enabled: true,
                target_tools: vec!["http_get".to_string()],
                allowed_domains: vec!["allowed.com".to_string()],
                block_ip_addresses: true,
            },
        };

        let inspector = AirlockInspector::new(config);

        let ctx = create_context(
            "http_get",
            serde_json::json!({
                "url": "https://evil.com/steal"
            }),
        );

        let result = inspector.inspect(&ctx).await;
        assert!(!result.allowed);
        assert!(result.violation.is_some());
        assert_eq!(
            result.violation.unwrap().violation_type,
            ViolationType::ExfiltrationAttempt
        );
    }

    #[tokio::test]
    async fn test_ip_address_blocked() {
        let config = AirlockConfig {
            mode: AirlockMode::Enforce,
            rce: RceConfig::default(),
            velocity: VelocityConfig::default(),
            exfiltration: ExfiltrationConfig {
                enabled: true,
                target_tools: vec!["http_get".to_string()],
                allowed_domains: vec![], // No whitelist
                block_ip_addresses: true,
            },
        };

        let inspector = AirlockInspector::new(config);

        let ctx = create_context(
            "http_get",
            serde_json::json!({
                "url": "http://192.168.1.100:8080/api"
            }),
        );

        let result = inspector.inspect(&ctx).await;
        assert!(!result.allowed);
        assert!(result.violation.is_some());
        assert_eq!(
            result.violation.unwrap().violation_type,
            ViolationType::IpAddressUsed
        );
    }

    #[tokio::test]
    async fn test_velocity_loop_detection() {
        let config = AirlockConfig {
            mode: AirlockMode::Enforce,
            rce: RceConfig::default(),
            velocity: VelocityConfig {
                enabled: true,
                max_cost_cents: 1000,
                window_seconds: 60,
                loop_threshold: 3,
            },
            exfiltration: ExfiltrationConfig::default(),
        };

        let inspector = AirlockInspector::new(config);

        let ctx = create_context(
            "some_tool",
            serde_json::json!({
                "same": "input"
            }),
        );

        // Record 3 identical calls (threshold)
        for _ in 0..3 {
            inspector.record_call(&ctx).await;
        }

        // 4th call should trigger loop detection
        let result = inspector.inspect(&ctx).await;
        assert!(!result.allowed);
        assert!(result.violation.is_some());
        assert_eq!(
            result.violation.unwrap().violation_type,
            ViolationType::LoopDetection
        );
    }

    #[tokio::test]
    async fn test_risk_level_from_score() {
        assert_eq!(RiskLevel::from_score(0), RiskLevel::Low);
        assert_eq!(RiskLevel::from_score(39), RiskLevel::Low);
        assert_eq!(RiskLevel::from_score(40), RiskLevel::Medium);
        assert_eq!(RiskLevel::from_score(59), RiskLevel::Medium);
        assert_eq!(RiskLevel::from_score(60), RiskLevel::High);
        assert_eq!(RiskLevel::from_score(79), RiskLevel::High);
        assert_eq!(RiskLevel::from_score(80), RiskLevel::Critical);
        assert_eq!(RiskLevel::from_score(100), RiskLevel::Critical);
    }

    #[tokio::test]
    async fn test_clear_run() {
        let inspector = AirlockInspector::new(create_test_config());
        let run_id = RunId::new();

        let ctx = InspectionContext {
            run_id,
            tool_name: "tool".to_string(),
            tool_input: serde_json::json!({}),
            estimated_cost_cents: Some(10),
        };

        // Record some calls
        inspector.record_call(&ctx).await;
        inspector.record_call(&ctx).await;

        let stats = inspector.velocity_stats().await;
        assert_eq!(stats.tracked_runs, 1);

        // Clear the run
        inspector.clear_run(&run_id.to_string()).await;

        let stats = inspector.velocity_stats().await;
        assert_eq!(stats.tracked_runs, 0);
    }
}
