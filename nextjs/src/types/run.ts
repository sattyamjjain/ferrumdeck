// Run status types - matches Rust RunStatus enum
export type RunStatus =
  | "created"
  | "queued"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled"
  | "timeout"
  | "budget_killed"
  | "policy_blocked";

// Step type - matches Rust StepType enum
export type StepType = "llm" | "tool" | "retrieval" | "human" | "approval";

// Step status - matches Rust StepStatus enum (includes waiting_approval)
export type StepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped";

// Budget constraints for a run
export interface Budget {
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_total_tokens?: number;
  max_tool_calls?: number;
  max_wall_time_ms?: number;
  max_cost_cents?: number;
}

// Budget usage tracking
export interface BudgetUsage {
  input_tokens: number;
  output_tokens: number;
  tool_calls: number;
  wall_time_ms: number;
  cost_cents: number;
}

// Tool call details within a run
export interface ToolCall {
  tool_name: string;
  tool_version?: string;
  arguments: Record<string, unknown>;
  success: boolean;
  error?: string;
  output_preview?: string;
}

// Agentic output structure
export interface AgenticOutput {
  response: string;
  tool_calls: ToolCall[];
  iterations: number;
  status: string;
}

// Run model - matches Rust Run struct
export interface Run {
  id: string;
  project_id: string;
  agent_id?: string; // Derived from agent_version for display
  agent_version_id: string;
  status: RunStatus;
  status_reason?: string; // Human-readable status explanation
  input: Record<string, unknown>;
  output?: string | Record<string, unknown> | AgenticOutput;
  error?: Record<string, unknown>;
  config?: Record<string, unknown>; // Run configuration overrides
  budget?: Budget;
  usage?: BudgetUsage;
  // Token and cost tracking (required, default to 0)
  input_tokens: number;
  output_tokens: number;
  tool_calls: number;
  cost_cents: number;
  // Airlock security fields
  threat_count?: number;
  highest_threat_level?: string;
  // Timestamps
  created_at: string;
  started_at?: string;
  completed_at?: string;
  // Observability
  trace_id?: string;
  span_id?: string;
  // Predictive run-budget forecast (populated after the first step completes)
  projected_cost_cents?: number;
  ewma_cost_cents?: number;
  budget_breach_projected?: boolean;
  breach_kind?: BudgetBreachKind;
  forecast_at?: string;
  // Reversibility-aware graduated response (DeepMind AI Control Roadmap R1-R3).
  // The rung last applied to a tool call on this run; populated by the gateway's
  // policy check and surfaced via the polled run endpoint. Absent on legacy runs.
  response_level?: ResponseLevel;
  // Claim Grounding Rate (VeriGraph, arXiv:2606.16603): fraction of the final
  // output's claims reachable from a tool-output source node. Reliability
  // signal; `claim_grounding_flagged` is set when below a project's optional
  // threshold (never blocks a run). Absent on legacy runs.
  claim_grounding_rate?: number;
  claim_grounding_flagged?: boolean;
  // Coherence divergence (Strained Coherence, arXiv:2606.07889): `true` when the
  // live gateway monitor surfaced a stated-blocking-fact -> contradicting-
  // closure-action divergence on this run, `false` for a coherent completed
  // run. Reliability signal only (never blocks). Absent (undefined) on legacy
  // runs that predate the live consumer — the console hides the card for them.
  coherence_divergence_flagged?: boolean;
}

// Graduated response level — the DeepMind R1-R3 control ladder. Mirrors
// `fd_policy::reversibility::ResponseLevel` (snake_case wire form).
//   allow_and_log (R1) · allow_under_budget (R2) · require_approval (R3)
export type ResponseLevel =
  | "allow_and_log"
  | "allow_under_budget"
  | "require_approval";

// Axis that triggered a projected breach. Matches the Rust BreachKind enum
// (serialized in snake_case).
export type BudgetBreachKind = "cost_cents" | "tool_calls" | "wall_time";

// SSE event payload schema for `run.forecast.updated`. See
// docs/runbooks/budget-forecast.md for the contract.
export interface RunForecastUpdatedPayload {
  run_id: string;
  projected_cost_cents: number;
  ewma_cost_cents: number;
  budget_breach_projected: boolean;
  breach_kind: BudgetBreachKind | null;
  at: string;
}

// Run with statistics for list views
export interface RunWithStats extends Run {
  step_count: number;
  pending_steps: number;
  completed_steps: number;
  failed_steps: number;
}

// Step model - matches Rust Step struct
export interface Step {
  id: string;
  run_id: string;
  parent_step_id?: string; // For hierarchical steps
  step_number: number;
  step_type: StepType;
  status: StepStatus;
  // Tool execution details
  tool_name?: string;
  tool_version?: string;
  model?: string;
  // Input/Output
  input: Record<string, unknown>;
  output?: string | Record<string, unknown>;
  error?: Record<string, unknown>;
  // Token tracking
  input_tokens?: number;
  output_tokens?: number;
  // Airlock security fields
  airlock_risk_score?: number;
  airlock_violation_type?: string;
  airlock_blocked?: boolean;
  // Timestamps
  created_at: string;
  started_at?: string;
  completed_at?: string;
  // Observability
  span_id?: string;
}

// Step artifact (files, outputs)
export interface StepArtifact {
  id: string;
  step_id: string;
  name: string;
  content_type: string;
  size_bytes: number;
  storage_path: string;
  checksum: string;
  created_at: string;
}

// Create run request
export interface CreateRunRequest {
  agent_id?: string;
  agent_version?: string; // Optional specific version ID (uses latest if not provided)
  input: {
    task: string;
    repository?: string;
    [key: string]: unknown;
  };
  config?: Record<string, unknown>;
  budget?: Budget;
}

// Create run response
export interface CreateRunResponse {
  run_id: string;
}

// List runs response
export interface ListRunsResponse {
  runs: Run[];
  total?: number;
  offset?: number;
  limit?: number;
}

// List steps response
export interface ListStepsResponse {
  steps: Step[];
}
