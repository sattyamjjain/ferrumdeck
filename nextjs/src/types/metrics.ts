// Tool-call firing-rate metric.
// ===========================================================================
// Wire shape mirrors `fd_otel::firing_rate::FiringRate` (Rust) and
// `fd_evals.firing_rate.FiringRate` (Python). Both planes write the same OTel
// attribute keys so this is the *single* schema for the metric.

/** Per-window firing-rate snapshot. */
export interface FiringRate {
  /** Count of reasoning (LLM) steps observed in the window. */
  reasoning_steps: number;
  /** Count of reasoning steps that invoked at least one tool. */
  invoking_steps: number;
  /** `invoking_steps / reasoning_steps`, clamped to `[0, 1]`. `0` for an empty window. */
  rate: number;
  /** `true` when `rate < low_firing_rate_threshold` and the window is non-empty. */
  low_firing_rate_breached: boolean;
  /** Threshold used for the breach decision. */
  low_firing_rate_threshold: number;
}

/** A single point on the firing-rate trend, one per terminal run in the window. */
export interface FiringRatePoint {
  /** Run id (ULID, `run_*`). */
  run_id: string;
  /** Run completion time as ISO-8601 UTC. */
  completed_at: string;
  /** Per-run firing rate, in `[0, 1]`. */
  rate: number;
  /** Reasoning-step count for this run; null for runs without LLM steps. */
  reasoning_steps: number;
  /** Reasoning steps that invoked >=1 tool for this run. */
  invoking_steps: number;
  /** Mirrors the aggregate breach decision applied at this run's rate. */
  low_firing_rate_breached: boolean;
}

/**
 * Aggregated firing-rate signal for one agent over a sliding time window.
 *
 * Returned by `/api/v1/registry/agents/:agentId/tool-call-firing-rate`.
 * The aggregate (`window`) is the metric the alert is keyed off; the
 * `points` series feeds the Recharts trend on the dashboard panel.
 */
export interface AgentFiringRateResponse {
  agent_id: string;
  /** Window length in hours used for the aggregate. */
  window_hours: number;
  /** Anchor for OTel attribute keys; mirrored on the wire for sanity. */
  anchor_attribute: "ferrumdeck.metrics.tool_call_firing_rate";
  /** Aggregate over every run in the window. */
  window: FiringRate;
  /** Per-run trend, oldest → newest. Empty when there is no run in the window. */
  points: FiringRatePoint[];
  /** When the BFF computed this response (ISO-8601 UTC). */
  computed_at: string;
}
