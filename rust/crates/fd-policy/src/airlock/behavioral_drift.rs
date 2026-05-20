//! Behavioral-drift inspection — fifth Airlock RASP layer.
//!
//! Per-agent rolling-window z-score over scalar call metadata. When the
//! latest observation for any tracked dimension exceeds `z_threshold`
//! standard deviations from the rolling mean (after a warmup of at least
//! `min_observations` samples), the call is flagged as drifted.
//!
//! Anchored on GPRL (arxiv:2605.18721) — applying the closed-loop
//! drift-monitor primitive at inference time rather than during policy
//! training. Unlike [`super::schema_drift`], which watches payloads
//! against a static contract, this layer watches behavior against the
//! agent's own recent history.
//!
//! The v1 scope only feeds `cost_cents` from `InspectionContext`. Latency,
//! refusal, and schema-violation observations are post-hoc and will be
//! pushed by the worker in a follow-up PR.

use super::config::BehavioralDriftConfig;
use super::inspector::{AirlockViolation, RiskLevel, ViolationType};
use fd_core::AgentId;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use tokio::sync::RwLock;
use tracing::warn;

/// A single per-call observation. Pre-call fields are populated by the
/// gateway; post-call fields are filled by the worker once results come
/// back. `None` for a dimension means "skip this dimension on this call".
#[derive(Debug, Clone, Copy, Default)]
pub struct Observation {
    pub cost_cents: Option<u64>,
    pub latency_ms: Option<u64>,
    pub refused: Option<bool>,
    pub schema_violation: Option<bool>,
}

impl Observation {
    pub fn with_cost(cents: u64) -> Self {
        Self {
            cost_cents: Some(cents),
            ..Default::default()
        }
    }
}

/// Structured payload encoded into [`AirlockViolation::details`] when a
/// behavioral-drift violation fires.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehavioralDriftDetails {
    pub agent_id: String,
    /// One of `cost_cents`, `latency_ms`, `refused`, `schema_violation`.
    pub dimension: String,
    pub z_score: f64,
    pub mean: f64,
    pub stddev: f64,
    pub observed: f64,
    pub window_size: usize,
}

/// Per-agent rolling state. Held under the monitor's `RwLock` map.
struct RollingState {
    cost_cents: VecDeque<f64>,
    latency_ms: VecDeque<f64>,
    refused: VecDeque<f64>,
    schema_violation: VecDeque<f64>,
}

impl RollingState {
    fn new() -> Self {
        Self {
            cost_cents: VecDeque::new(),
            latency_ms: VecDeque::new(),
            refused: VecDeque::new(),
            schema_violation: VecDeque::new(),
        }
    }
}

fn push_bounded(buf: &mut VecDeque<f64>, value: f64, cap: usize) {
    if buf.len() == cap {
        buf.pop_front();
    }
    buf.push_back(value);
}

/// Returns (mean, stddev). `stddev` is the population stddev (divide by N,
/// not N-1) — we treat the window as the entire population we care about
/// rather than a sample of a larger distribution.
fn mean_stddev(buf: &VecDeque<f64>) -> (f64, f64) {
    let n = buf.len() as f64;
    if n == 0.0 {
        return (0.0, 0.0);
    }
    let sum: f64 = buf.iter().sum();
    let mean = sum / n;
    let variance: f64 = buf.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / n;
    (mean, variance.sqrt())
}

/// Tracks per-agent rolling observations and reports z-score outliers.
///
/// Mirror the construction pattern used elsewhere in `airlock/`: instantiate
/// at gateway boot via [`BehavioralDriftMonitor::new`], wrap in `Arc`, and
/// hand to [`super::inspector::AirlockInspector::with_behavioral_drift_monitor`].
pub struct BehavioralDriftMonitor {
    agents: RwLock<HashMap<AgentId, RollingState>>,
}

impl Default for BehavioralDriftMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl BehavioralDriftMonitor {
    pub fn new() -> Self {
        Self {
            agents: RwLock::new(HashMap::new()),
        }
    }

    /// Whether this monitor has any state recorded for the given agent —
    /// primarily for tests.
    pub async fn is_tracked(&self, agent_id: &AgentId) -> bool {
        self.agents.read().await.contains_key(agent_id)
    }

    /// Drop all rolling state for an agent. Call when a run completes if
    /// you don't want drift signal to bleed across runs of the same agent.
    pub async fn clear_agent(&self, agent_id: &AgentId) {
        self.agents.write().await.remove(agent_id);
    }

    /// Record an observation and, if it pushes any dimension past
    /// `config.z_threshold`, return the corresponding violation. The
    /// observation is always added to the window — even when it fires a
    /// violation — so subsequent calls see today's behavior as the new
    /// baseline.
    pub async fn observe(
        &self,
        agent_id: AgentId,
        obs: Observation,
        config: &BehavioralDriftConfig,
    ) -> Option<AirlockViolation> {
        if !config.enabled {
            return None;
        }

        let mut agents = self.agents.write().await;
        let state = agents.entry(agent_id).or_insert_with(RollingState::new);

        // Compute z-score against the window AS IT STANDS BEFORE this obs,
        // then insert. This is what makes "the new sample is anomalous"
        // meaningful — otherwise the new sample shifts the mean and dampens
        // its own z-score.
        let mut violation: Option<AirlockViolation> = check_dimension(
            "cost_cents",
            &state.cost_cents,
            obs.cost_cents,
            &agent_id,
            config,
        )
        .or_else(|| {
            check_dimension(
                "latency_ms",
                &state.latency_ms,
                obs.latency_ms,
                &agent_id,
                config,
            )
        })
        .or_else(|| check_bool_dimension("refused", &state.refused, obs.refused, &agent_id, config))
        .or_else(|| {
            check_bool_dimension(
                "schema_violation",
                &state.schema_violation,
                obs.schema_violation,
                &agent_id,
                config,
            )
        });

        // Always insert, capped at window_size.
        if let Some(v) = obs.cost_cents {
            push_bounded(&mut state.cost_cents, v as f64, config.window_size);
        }
        if let Some(v) = obs.latency_ms {
            push_bounded(&mut state.latency_ms, v as f64, config.window_size);
        }
        if let Some(v) = obs.refused {
            push_bounded(
                &mut state.refused,
                if v { 1.0 } else { 0.0 },
                config.window_size,
            );
        }
        if let Some(v) = obs.schema_violation {
            push_bounded(
                &mut state.schema_violation,
                if v { 1.0 } else { 0.0 },
                config.window_size,
            );
        }

        // Clamp the risk score now that we've decided to surface this.
        if let Some(ref mut v) = violation {
            v.risk_score = v.risk_score.min(100);
            v.risk_level = RiskLevel::from_score(v.risk_score);
        }

        violation
    }
}

fn check_dimension(
    name: &'static str,
    buf: &VecDeque<f64>,
    incoming: Option<u64>,
    agent_id: &AgentId,
    config: &BehavioralDriftConfig,
) -> Option<AirlockViolation> {
    let value = incoming? as f64;
    if buf.len() < config.min_observations {
        return None;
    }
    let (mean, stddev) = mean_stddev(buf);
    if stddev == 0.0 {
        // Constant traffic — a deviation is meaningful but z is undefined.
        // Be conservative: don't fire, and let the window grow until variance
        // emerges. Avoids spurious flags on a long flat warmup.
        return None;
    }
    let z = (value - mean).abs() / stddev;
    if z <= config.z_threshold as f64 {
        return None;
    }

    let details = BehavioralDriftDetails {
        agent_id: agent_id.to_string(),
        dimension: name.to_string(),
        z_score: z,
        mean,
        stddev,
        observed: value,
        window_size: buf.len(),
    };
    let serialized = serde_json::to_string(&details)
        .unwrap_or_else(|_| format!("behavioral_drift {} agent={} z={:.2}", name, agent_id, z));

    warn!(
        agent_id = %agent_id,
        dimension = name,
        z_score = z,
        mean = mean,
        stddev = stddev,
        observed = value,
        "behavioral drift detected"
    );

    Some(AirlockViolation {
        violation_type: ViolationType::BehavioralDrift,
        risk_score: config.risk_score,
        risk_level: RiskLevel::from_score(config.risk_score),
        details: serialized,
        trigger: format!("behavioral_drift:{name}"),
    })
}

fn check_bool_dimension(
    name: &'static str,
    buf: &VecDeque<f64>,
    incoming: Option<bool>,
    agent_id: &AgentId,
    config: &BehavioralDriftConfig,
) -> Option<AirlockViolation> {
    // Reuse the scalar path with bool→{0.0, 1.0}.
    let incoming = incoming?;
    let as_u64 = if incoming { 1 } else { 0 };
    check_dimension(name, buf, Some(as_u64), agent_id, config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::airlock::config::BehavioralDriftConfig;

    fn config() -> BehavioralDriftConfig {
        BehavioralDriftConfig {
            enabled: true,
            window_size: 100,
            min_observations: 20,
            z_threshold: 3.0,
            risk_score: 65,
        }
    }

    #[tokio::test]
    async fn under_window_does_not_fire() {
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        // 15 normal observations then a spike — but we haven't reached
        // min_observations=20 yet, so no violation.
        for _ in 0..15 {
            let v = monitor
                .observe(agent, Observation::with_cost(10), &config())
                .await;
            assert!(v.is_none());
        }
        let spike = monitor
            .observe(agent, Observation::with_cost(10_000), &config())
            .await;
        assert!(
            spike.is_none(),
            "expected no violation before warmup completes, got {spike:?}"
        );
    }

    #[tokio::test]
    async fn clean_traffic_does_not_fire() {
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        // 50 observations alternating between 10 and 12 — small variance,
        // nothing past 3σ.
        for i in 0..50 {
            let v = monitor
                .observe(
                    agent,
                    Observation::with_cost(if i % 2 == 0 { 10 } else { 12 }),
                    &config(),
                )
                .await;
            assert!(v.is_none(), "clean traffic triggered at i={i}: {v:?}");
        }
    }

    #[tokio::test]
    async fn cost_spike_fires_after_warmup() {
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        // Warm up with 50 cheap calls (small variance around 10).
        for i in 0..50 {
            monitor
                .observe(
                    agent,
                    Observation::with_cost(if i % 2 == 0 { 10 } else { 11 }),
                    &config(),
                )
                .await;
        }
        // 1000-cent call should be many standard deviations away.
        let violation = monitor
            .observe(agent, Observation::with_cost(1000), &config())
            .await
            .expect("cost spike should fire");
        assert_eq!(violation.violation_type, ViolationType::BehavioralDrift);
        let details: BehavioralDriftDetails = serde_json::from_str(&violation.details).unwrap();
        assert_eq!(details.dimension, "cost_cents");
        assert!(
            details.z_score > 3.0,
            "z_score {} should exceed threshold",
            details.z_score
        );
    }

    #[tokio::test]
    async fn latency_spike_fires_after_warmup() {
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        for i in 0..50 {
            monitor
                .observe(
                    agent,
                    Observation {
                        latency_ms: Some(if i % 2 == 0 { 100 } else { 110 }),
                        ..Default::default()
                    },
                    &config(),
                )
                .await;
        }
        let violation = monitor
            .observe(
                agent,
                Observation {
                    latency_ms: Some(5_000),
                    ..Default::default()
                },
                &config(),
            )
            .await
            .expect("latency spike should fire");
        let details: BehavioralDriftDetails = serde_json::from_str(&violation.details).unwrap();
        assert_eq!(details.dimension, "latency_ms");
    }

    #[tokio::test]
    async fn disabled_config_short_circuits() {
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        let mut cfg = config();
        cfg.enabled = false;
        // Push 50 normal then a spike — should never fire when disabled.
        for _ in 0..50 {
            monitor
                .observe(agent, Observation::with_cost(10), &cfg)
                .await;
        }
        let v = monitor
            .observe(agent, Observation::with_cost(10_000), &cfg)
            .await;
        assert!(v.is_none());
    }

    #[tokio::test]
    async fn clear_agent_resets_state() {
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        for _ in 0..50 {
            monitor
                .observe(agent, Observation::with_cost(10), &config())
                .await;
        }
        assert!(monitor.is_tracked(&agent).await);
        monitor.clear_agent(&agent).await;
        assert!(!monitor.is_tracked(&agent).await);
        // Post-clear: a single spike should NOT fire (window is empty,
        // can't compute drift on an unseen agent).
        let v = monitor
            .observe(agent, Observation::with_cost(10_000), &config())
            .await;
        assert!(v.is_none());
    }

    #[tokio::test]
    async fn zero_stddev_does_not_panic() {
        // 30 identical observations followed by a deviant one. Stddev is 0
        // until the new sample arrives. We skip the z-check rather than
        // divide by zero, so no violation fires here either.
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        for _ in 0..30 {
            monitor
                .observe(agent, Observation::with_cost(10), &config())
                .await;
        }
        let v = monitor
            .observe(agent, Observation::with_cost(99_999), &config())
            .await;
        assert!(
            v.is_none(),
            "zero-stddev path must not divide-by-zero or fire spurious violation"
        );
    }

    #[tokio::test]
    async fn window_caps_at_window_size() {
        let monitor = BehavioralDriftMonitor::new();
        let agent = AgentId::new();
        let mut cfg = config();
        cfg.window_size = 30;
        cfg.min_observations = 10;
        for i in 0..100 {
            monitor
                .observe(agent, Observation::with_cost(i), &cfg)
                .await;
        }
        let agents = monitor.agents.read().await;
        let state = agents.get(&agent).expect("agent tracked");
        assert_eq!(state.cost_cents.len(), 30);
        // Latest 30 values were 70..100 — the front of the deque is 70.
        assert_eq!(state.cost_cents.front().copied(), Some(70.0));
    }
}
