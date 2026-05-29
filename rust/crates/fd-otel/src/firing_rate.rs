//! Tool-call firing-rate metric.
//!
//! `firing_rate = (reasoning steps that invoked >= 1 tool) / (total reasoning steps)`
//!
//! "Reasoning steps" map to `StepType::Llm` in
//! [`fd-storage::models::steps`](../../../fd-storage/src/models/steps.rs); a
//! reasoning step is considered to have *invoked* a tool when the GenAI
//! response finish-reason is `tool_calls` (per OpenTelemetry GenAI semconv)
//! or when at least one child `StepType::Tool` step is recorded against it.
//!
//! The metric is a **derived** signal: it is computed from the existing run /
//! step rows the gateway already persists and the existing OTel spans the
//! worker already emits. This module:
//!
//! 1. Defines the canonical span-attribute keys under the existing
//!    `ferrumdeck.*` semconv extension (no new telemetry backend, no new wire
//!    protocol — just naming).
//! 2. Provides a pure compute function that turns two integer counters into a
//!    [`FiringRate`] struct, so the same arithmetic is reused from the
//!    gateway (per-run computation), the worker (per-trace tagging), and the
//!    fd-evals golden-trace test.
//! 3. Records the metric on a `tracing::Span` via [`record_on_span`] so the
//!    existing OTel exporter picks it up without any pipeline change.
//!
//! Anti-pivot guard: this is *observability extension*, not a new state
//! store. The metric is recomputed on demand from the existing step rows;
//! nothing is persisted into a dedicated table.

use serde::{Deserialize, Serialize};
use tracing::Span;

use crate::genai::attrs;

/// Default low-firing-rate alert threshold. Runs and agent-windows whose
/// firing rate falls **below** this value are flagged on the dashboard.
///
/// The 0.40 default is a starting point sourced from internal observability
/// notes — a reasoning-heavy agent that fires tools less than 40% of the
/// time is usually either over-thinking simple tasks or has a broken tool
/// registry. Operators can override via the dashboard settings.
pub const DEFAULT_LOW_FIRING_RATE_THRESHOLD: f64 = 0.40;

/// Pure derived metric. Same inputs always produce the same struct — no
/// hidden state, no I/O, no clock. Surfaced verbatim onto OTel spans and the
/// dashboard's TanStack-Query cache, so a change here is a change to a
/// public contract.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FiringRate {
    /// Count of reasoning (LLM) steps observed in the window.
    pub reasoning_steps: u32,
    /// Count of reasoning steps that invoked at least one tool.
    pub invoking_steps: u32,
    /// `invoking_steps / reasoning_steps`, in `[0.0, 1.0]`. `0.0` when
    /// `reasoning_steps == 0` so the dashboard renders a deterministic
    /// "no data" state rather than `NaN`.
    pub rate: f64,
    /// `true` when `rate < threshold`. Recorded explicitly so the OTel
    /// attribute carries the decision, not just the inputs.
    pub low_firing_rate_breached: bool,
    /// Threshold used for the breach decision. Mirrored on the span so an
    /// audit consumer can reconstruct the verdict without re-querying
    /// config.
    pub low_firing_rate_threshold: f64,
}

impl FiringRate {
    /// Compute the metric from raw counters.
    ///
    /// `reasoning_steps == 0` returns a zero-rate, not-breached value — an
    /// empty window can't breach a threshold, and "no data" should never
    /// page anyone.
    pub fn compute(reasoning_steps: u32, invoking_steps: u32) -> Self {
        Self::compute_with_threshold(
            reasoning_steps,
            invoking_steps,
            DEFAULT_LOW_FIRING_RATE_THRESHOLD,
        )
    }

    /// Same as [`Self::compute`] but with an explicit threshold (used by
    /// the dashboard when the operator overrides the default).
    pub fn compute_with_threshold(
        reasoning_steps: u32,
        invoking_steps: u32,
        threshold: f64,
    ) -> Self {
        let invoking_steps = invoking_steps.min(reasoning_steps);
        let rate = if reasoning_steps == 0 {
            0.0
        } else {
            f64::from(invoking_steps) / f64::from(reasoning_steps)
        };
        let breached = reasoning_steps > 0 && rate < threshold;
        Self {
            reasoning_steps,
            invoking_steps,
            rate,
            low_firing_rate_breached: breached,
            low_firing_rate_threshold: threshold,
        }
    }

    /// Whether this struct represents an empty window (no reasoning steps
    /// observed). The dashboard renders this as "no data" rather than 0%
    /// because a 0% reading on a non-empty window is a real alert; a 0%
    /// reading on an empty window is just absence.
    pub fn is_empty(&self) -> bool {
        self.reasoning_steps == 0
    }
}

/// Tag a [`tracing::Span`] with the firing-rate attributes. Reuses the
/// existing `ferrumdeck.*` semconv extension; no new exporter or backend is
/// introduced.
///
/// Worker code calls this on the run-completion span; gateway code can call
/// it on the agent-stats span when serving the dashboard endpoint.
pub fn record_on_span(span: &Span, metric: &FiringRate) {
    span.record(attrs::FERRUMDECK_TOOL_FIRING_RATE, metric.rate);
    span.record(
        attrs::FERRUMDECK_TOOL_FIRING_REASONING_STEPS,
        i64::from(metric.reasoning_steps),
    );
    span.record(
        attrs::FERRUMDECK_TOOL_FIRING_INVOKING_STEPS,
        i64::from(metric.invoking_steps),
    );
    span.record(
        attrs::FERRUMDECK_TOOL_FIRING_LOW_BREACHED,
        metric.low_firing_rate_breached,
    );
    span.record(
        attrs::FERRUMDECK_TOOL_FIRING_LOW_THRESHOLD,
        metric.low_firing_rate_threshold,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_is_zero_for_empty_window() {
        let m = FiringRate::compute(0, 0);
        assert_eq!(m.rate, 0.0);
        assert!(m.is_empty());
        assert!(!m.low_firing_rate_breached, "empty window must not page");
    }

    #[test]
    fn rate_is_one_when_every_reasoning_step_fires() {
        let m = FiringRate::compute(7, 7);
        assert_eq!(m.rate, 1.0);
        assert!(!m.low_firing_rate_breached);
    }

    #[test]
    fn rate_breaches_at_low_threshold() {
        // 3 / 10 = 0.30, below the 0.40 default → breach.
        let m = FiringRate::compute(10, 3);
        assert!((m.rate - 0.30).abs() < 1e-9);
        assert!(m.low_firing_rate_breached);
    }

    #[test]
    fn rate_at_threshold_does_not_breach() {
        // `< threshold`, not `<=`. A rate exactly equal to the threshold
        // sits on the line and should not page.
        let m = FiringRate::compute_with_threshold(10, 4, 0.40);
        assert_eq!(m.rate, 0.40);
        assert!(
            !m.low_firing_rate_breached,
            "exact-threshold rate must not breach (uses strict <)"
        );
    }

    #[test]
    fn custom_threshold_overrides_default() {
        // Same 50% rate; default 0.40 → no breach, but a 0.60 override → breach.
        let m_default = FiringRate::compute(10, 5);
        let m_strict = FiringRate::compute_with_threshold(10, 5, 0.60);
        assert!(!m_default.low_firing_rate_breached);
        assert!(m_strict.low_firing_rate_breached);
        assert_eq!(m_strict.low_firing_rate_threshold, 0.60);
    }

    #[test]
    fn invoking_steps_clamped_to_reasoning_steps() {
        // Defensive: if counters are mis-reported (e.g. a worker double-
        // counted a tool call), we clamp rather than emit a > 1.0 rate.
        let m = FiringRate::compute(5, 9);
        assert_eq!(m.invoking_steps, 5);
        assert_eq!(m.rate, 1.0);
    }

    #[test]
    fn serialises_as_stable_json() {
        let m = FiringRate::compute(10, 3);
        let json = serde_json::to_value(m).expect("serialise");
        // The keys below are the public wire contract used by the dashboard
        // TanStack-Query cache and the fd-evals golden-trace test. A change
        // to any of these names is a breaking change.
        assert_eq!(json["reasoning_steps"], 10);
        assert_eq!(json["invoking_steps"], 3);
        assert!((json["rate"].as_f64().unwrap() - 0.30).abs() < 1e-9);
        assert_eq!(json["low_firing_rate_breached"], true);
        assert_eq!(
            json["low_firing_rate_threshold"],
            DEFAULT_LOW_FIRING_RATE_THRESHOLD
        );
    }

    #[test]
    fn record_on_span_compiles_against_real_span() {
        // The span attribute keys are only checked at `record` call time —
        // this guards against a typo in the constant names by exercising the
        // record path. A disabled span absorbs the calls cleanly.
        let span = tracing::Span::none();
        let metric = FiringRate::compute(10, 3);
        record_on_span(&span, &metric);
    }
}
