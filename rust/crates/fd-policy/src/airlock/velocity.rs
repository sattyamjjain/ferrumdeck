//! Financial circuit breaker and loop detection
//!
//! Provides velocity-based protection:
//! - Spending velocity limits (e.g., max $1.00 in 10 seconds)
//! - Loop detection (same tool+args called repeatedly)

use super::config::VelocityConfig;
use super::inspector::{AirlockViolation, InspectionContext, RiskLevel, ViolationType};
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::debug;

/// A recorded tool call for velocity tracking
#[derive(Debug, Clone)]
struct CallRecord {
    tool_name: String,
    input_hash: u64,
    cost_cents: u64,
    timestamp: Instant,
}

/// Per-run tracking data
#[derive(Debug)]
struct RunTracker {
    calls: Vec<CallRecord>,
    last_cleanup: Instant,
}

impl RunTracker {
    fn new() -> Self {
        Self {
            calls: Vec::new(),
            last_cleanup: Instant::now(),
        }
    }

    /// Clean up old records outside the window
    fn cleanup(&mut self, window: Duration) {
        let now = Instant::now();
        // Only cleanup periodically to avoid performance impact
        if now.duration_since(self.last_cleanup) > Duration::from_secs(5) {
            self.calls
                .retain(|c| now.duration_since(c.timestamp) < window);
            self.last_cleanup = now;
        }
    }
}

impl Default for RunTracker {
    fn default() -> Self {
        Self::new()
    }
}

/// Velocity tracker for circuit breaker functionality
pub struct VelocityTracker {
    config: VelocityConfig,
    /// Per-run tracking, protected by RwLock for concurrent access
    runs: RwLock<HashMap<String, RunTracker>>,
}

impl VelocityTracker {
    /// Create a new velocity tracker
    pub fn new(config: VelocityConfig) -> Self {
        Self {
            config,
            runs: RwLock::new(HashMap::new()),
        }
    }

    /// Hash the tool input for loop detection
    fn hash_input(input: &serde_json::Value) -> u64 {
        let mut hasher = DefaultHasher::new();
        // Serialize to string for consistent hashing
        input.to_string().hash(&mut hasher);
        hasher.finish()
    }

    /// Check if this call violates velocity limits
    pub async fn check(&self, ctx: &InspectionContext) -> Option<AirlockViolation> {
        let run_key = ctx.run_id.to_string();
        let input_hash = Self::hash_input(&ctx.tool_input);
        let window = Duration::from_secs(self.config.window_seconds);
        let now = Instant::now();

        let runs = self.runs.read().await;

        if let Some(tracker) = runs.get(&run_key) {
            // Check 1: Spending velocity
            let recent_cost: u64 = tracker
                .calls
                .iter()
                .filter(|c| now.duration_since(c.timestamp) < window)
                .map(|c| c.cost_cents)
                .sum();

            let projected_cost = recent_cost + ctx.estimated_cost_cents.unwrap_or(0);

            if projected_cost > self.config.max_cost_cents {
                debug!(
                    run_id = %ctx.run_id,
                    recent_cost = recent_cost,
                    projected_cost = projected_cost,
                    limit = self.config.max_cost_cents,
                    "Velocity limit exceeded"
                );

                return Some(AirlockViolation {
                    violation_type: ViolationType::VelocityBreach,
                    risk_score: 85,
                    risk_level: RiskLevel::Critical,
                    details: format!(
                        "Spending velocity exceeded: ${:.2} in {} seconds (limit: ${:.2})",
                        projected_cost as f64 / 100.0,
                        self.config.window_seconds,
                        self.config.max_cost_cents as f64 / 100.0
                    ),
                    trigger: "velocity_limit".to_string(),
                });
            }

            // Check 2: Loop detection (same tool + args called repeatedly)
            let identical_calls = tracker
                .calls
                .iter()
                .rev() // Check most recent first
                .take(self.config.loop_threshold as usize + 1)
                .filter(|c| c.tool_name == ctx.tool_name && c.input_hash == input_hash)
                .count();

            if identical_calls >= self.config.loop_threshold as usize {
                debug!(
                    run_id = %ctx.run_id,
                    tool = %ctx.tool_name,
                    identical_calls = identical_calls,
                    threshold = self.config.loop_threshold,
                    "Loop detected"
                );

                return Some(AirlockViolation {
                    violation_type: ViolationType::LoopDetection,
                    risk_score: 75,
                    risk_level: RiskLevel::High,
                    details: format!(
                        "Loop detected: {} identical calls to '{}' in sequence (threshold: {})",
                        identical_calls, ctx.tool_name, self.config.loop_threshold
                    ),
                    trigger: "loop_detection".to_string(),
                });
            }
        }

        None
    }

    /// Record a completed call for future velocity checks
    pub async fn record(&self, ctx: &InspectionContext) {
        let run_key = ctx.run_id.to_string();
        let input_hash = Self::hash_input(&ctx.tool_input);
        let window = Duration::from_secs(self.config.window_seconds);

        let mut runs = self.runs.write().await;

        let tracker = runs.entry(run_key).or_insert_with(RunTracker::new);

        // Cleanup old records (keep 2x window for safety)
        tracker.cleanup(window * 2);

        // Add new record
        tracker.calls.push(CallRecord {
            tool_name: ctx.tool_name.clone(),
            input_hash,
            cost_cents: ctx.estimated_cost_cents.unwrap_or(0),
            timestamp: Instant::now(),
        });
    }

    /// Clear tracking data for a completed run (memory cleanup)
    pub async fn clear_run(&self, run_id: &str) {
        let mut runs = self.runs.write().await;
        runs.remove(run_id);
    }

    /// Get statistics about tracked runs (for monitoring)
    pub async fn stats(&self) -> VelocityStats {
        let runs = self.runs.read().await;
        VelocityStats {
            tracked_runs: runs.len(),
            total_records: runs.values().map(|t| t.calls.len()).sum(),
        }
    }
}

/// Statistics about velocity tracker state
#[derive(Debug, Clone)]
pub struct VelocityStats {
    pub tracked_runs: usize,
    pub total_records: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use fd_core::RunId;

    fn create_tracker() -> VelocityTracker {
        VelocityTracker::new(VelocityConfig {
            enabled: true,
            max_cost_cents: 100, // $1.00
            window_seconds: 10,
            loop_threshold: 3,
        })
    }

    fn create_context(run_id: &RunId, tool: &str, cost: Option<u64>) -> InspectionContext {
        InspectionContext {
            run_id: *run_id,
            tool_name: tool.to_string(),
            tool_input: serde_json::json!({"test": "data"}),
            estimated_cost_cents: cost,
        }
    }

    #[tokio::test]
    async fn test_velocity_within_limits() {
        let tracker = create_tracker();
        let run_id = RunId::new();

        // First call with low cost should pass
        let ctx = create_context(&run_id, "test_tool", Some(50));
        let result = tracker.check(&ctx).await;
        assert!(result.is_none());

        // Record the call
        tracker.record(&ctx).await;

        // Second call with low cost should still pass
        let ctx2 = create_context(&run_id, "test_tool", Some(40));
        let result2 = tracker.check(&ctx2).await;
        assert!(result2.is_none());
    }

    #[tokio::test]
    async fn test_velocity_exceeded() {
        let tracker = create_tracker();
        let run_id = RunId::new();

        // Record several expensive calls
        for _ in 0..3 {
            let ctx = create_context(&run_id, "expensive_tool", Some(40));
            tracker.record(&ctx).await;
        }

        // Next call should trigger velocity limit (40*3 = 120, plus new 40 = 160 > 100)
        let ctx = create_context(&run_id, "expensive_tool", Some(40));
        let result = tracker.check(&ctx).await;

        assert!(result.is_some());
        let violation = result.unwrap();
        assert_eq!(violation.violation_type, ViolationType::VelocityBreach);
        assert!(violation.risk_score >= 80);
    }

    #[tokio::test]
    async fn test_loop_detection() {
        let tracker = create_tracker();
        let run_id = RunId::new();

        // Make identical calls
        let ctx = InspectionContext {
            run_id,
            tool_name: "looping_tool".to_string(),
            tool_input: serde_json::json!({"same": "input"}),
            estimated_cost_cents: Some(1),
        };

        // Record 3 identical calls (at threshold)
        for _ in 0..3 {
            tracker.record(&ctx).await;
        }

        // 4th identical call should trigger loop detection
        let result = tracker.check(&ctx).await;

        assert!(result.is_some());
        let violation = result.unwrap();
        assert_eq!(violation.violation_type, ViolationType::LoopDetection);
    }

    #[tokio::test]
    async fn test_different_inputs_no_loop() {
        let tracker = create_tracker();
        let run_id = RunId::new();

        // Make calls with different inputs
        for i in 0..5 {
            let ctx = InspectionContext {
                run_id,
                tool_name: "tool".to_string(),
                tool_input: serde_json::json!({"iteration": i}),
                estimated_cost_cents: Some(1),
            };
            tracker.record(&ctx).await;

            let result = tracker.check(&ctx).await;
            assert!(result.is_none());
        }
    }

    #[tokio::test]
    async fn test_clear_run() {
        let tracker = create_tracker();
        let run_id = RunId::new();

        // Record some calls
        let ctx = create_context(&run_id, "tool", Some(50));
        tracker.record(&ctx).await;
        tracker.record(&ctx).await;

        // Verify data exists
        let stats = tracker.stats().await;
        assert_eq!(stats.tracked_runs, 1);

        // Clear run
        tracker.clear_run(&run_id.to_string()).await;

        // Verify data cleared
        let stats = tracker.stats().await;
        assert_eq!(stats.tracked_runs, 0);
    }

    #[tokio::test]
    async fn test_separate_runs() {
        let tracker = create_tracker();
        let run1 = RunId::new();
        let run2 = RunId::new();

        // Record expensive calls for run1
        for _ in 0..3 {
            let ctx = create_context(&run1, "tool", Some(40));
            tracker.record(&ctx).await;
        }

        // Run2 should start fresh and not be affected by run1's costs
        let ctx2 = create_context(&run2, "tool", Some(40));
        let result = tracker.check(&ctx2).await;
        assert!(result.is_none());
    }

    #[tokio::test]
    async fn test_input_hash_consistency() {
        // Same input should produce same hash
        let input1 = serde_json::json!({"key": "value", "num": 123});
        let input2 = serde_json::json!({"key": "value", "num": 123});

        let hash1 = VelocityTracker::hash_input(&input1);
        let hash2 = VelocityTracker::hash_input(&input2);

        assert_eq!(hash1, hash2);

        // Different input should produce different hash
        let input3 = serde_json::json!({"key": "different"});
        let hash3 = VelocityTracker::hash_input(&input3);

        assert_ne!(hash1, hash3);
    }
}
