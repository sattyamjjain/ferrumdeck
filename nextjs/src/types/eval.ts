// Eval gate status - whether an eval run passed or failed the gate
export type EvalGateStatus = "passed" | "failed" | "skipped";

// Eval run status - current state of an evaluation run
export type EvalRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// Scorer type - types of scoring functions available
export type ScorerType =
  | "exact_match"
  | "contains"
  | "regex"
  | "llm_judge"
  | "semantic_similarity"
  | "tool_sequence"
  | "custom";

// Task result status - whether a task passed, failed, or had an error
export type TaskResultStatus = "passed" | "failed" | "error" | "skipped";

// Regression status - whether a task regressed, improved, or stayed the same
export type RegressionStatus = "regressed" | "improved" | "unchanged" | "new" | "removed";

// Scorer configuration
export interface ScorerConfig {
  id: string;
  name: string;
  type: ScorerType;
  weight: number;
  threshold?: number;
  config?: Record<string, unknown>;
}

// Scorer result for a single task
export interface ScorerResult {
  scorer_id: string;
  scorer_name: string;
  score: number;
  passed: boolean;
  details?: string;
  metadata?: Record<string, unknown>;
}

// Eval task definition within a suite
export interface EvalTask {
  id: string;
  name: string;
  description?: string;
  input: Record<string, unknown>;
  expected_output?: string;
  expected_tool_calls?: string[];
  tags?: string[];
  timeout_ms?: number;
}

// Eval task result from a run
export interface EvalTaskResult {
  task_id: string;
  task_name: string;
  status: TaskResultStatus;
  actual_output?: string;
  expected_output?: string;
  tool_calls?: string[];
  expected_tool_calls?: string[];
  score: number;
  scorer_results: ScorerResult[];
  duration_ms: number;
  cost_cents: number;
  tokens_used: number;
  error?: string;
  diff?: TaskDiff;
}

// Difference between expected and actual output
export interface TaskDiff {
  type: "text" | "tool_calls" | "structured";
  additions: string[];
  deletions: string[];
  changes: DiffChange[];
}

// Individual change in a diff
export interface DiffChange {
  path?: string;
  expected: string;
  actual: string;
  score_impact: number;
}

// Eval suite definition
export interface EvalSuite {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  agent_id?: string;
  agent_slug?: string;
  tasks: EvalTask[];
  scorers: ScorerConfig[];
  gate_threshold: number;
  baseline_version_id?: string;
  created_at: string;
  updated_at: string;
  created_by?: string;
  last_run_at?: string;
  last_run_status?: EvalGateStatus;
  last_run_score?: number;
}

// Eval suite summary for list views
export interface EvalSuiteSummary {
  id: string;
  name: string;
  description?: string;
  task_count: number;
  scorer_names: string[];
  gate_threshold: number;
  last_run_at?: string;
  last_run_status?: EvalGateStatus;
  last_run_score?: number;
}

// Benchmark-audit (ABA, arXiv:2605.26079)
// ============================================================================
// The eval plane (fd-evals) produces a `BenchAuditReport` describing how
// trustworthy a suite's task metadata + grader config is. The Rust policy
// plane consults `bench_trust_score` + flagged tasks before allowing a
// benchmark delta to gate a routing/model-swap decision.

// One of the four ABA-style hygiene classes audited per task.
export type BenchHygieneClass =
  | "ambiguous_spec"
  | "env_conflict"
  | "brittle_grading"
  | "suspect_truth";

// Severity assigned to a single hygiene hit.
export type BenchFlagSeverity = "low" | "medium" | "high";

// One hygiene hit against a single task in the suite.
export interface BenchTaskFlag {
  task_id: string;
  hygiene_class: BenchHygieneClass;
  severity: BenchFlagSeverity;
  evidence: string;
}

// Full per-suite audit report. `bench_trust_score` is in [0, 1]; the Rust
// policy plane denies a benchmark-gated routing decision when this value is
// below the configured `min_trust_score` OR when the cited delta sits inside
// the flagged-task margin.
export interface BenchAuditReport {
  suite_id: string;
  suite_path: string | null;
  bench_trust_score: number;
  flagged_task_ids: string[];
  flagged_task_ratio: number;
  task_flags: BenchTaskFlag[];
  hygiene_class_scores: Record<BenchHygieneClass, number>;
  total_tasks: number;
  audited_at: string;
  anchor: string;
}

// Eval run - a single execution of an eval suite
export interface EvalRun {
  id: string;
  suite_id: string;
  suite_name: string;
  agent_version_id: string;
  agent_version: string;
  status: EvalRunStatus;
  gate_status?: EvalGateStatus;
  score: number;
  gate_threshold: number;
  task_results: EvalTaskResult[];
  scorer_breakdown: ScorerBreakdown[];
  // Comparison to baseline
  baseline_run_id?: string;
  baseline_score?: number;
  regression_summary?: RegressionSummary;
  // Metrics
  total_tasks: number;
  passed_tasks: number;
  failed_tasks: number;
  error_tasks: number;
  total_cost_cents: number;
  total_tokens: number;
  total_duration_ms: number;
  // Timestamps
  created_at: string;
  started_at?: string;
  completed_at?: string;
  created_by?: string;
  // Optional benchmark-audit pre-flight (ABA, arXiv:2605.26079). When present,
  // the policy plane gates external-benchmark-cited routing changes on this.
  bench_audit?: BenchAuditReport;
}

// Breakdown of scores by scorer
export interface ScorerBreakdown {
  scorer_id: string;
  scorer_name: string;
  scorer_type: ScorerType;
  weight: number;
  avg_score: number;
  tasks_passed: number;
  tasks_failed: number;
}

// Summary of regressions in a run
export interface RegressionSummary {
  regressed_tasks: number;
  improved_tasks: number;
  unchanged_tasks: number;
  new_tasks: number;
  removed_tasks: number;
  score_delta: number;
  cost_delta_cents: number;
}

// Task regression detail
export interface TaskRegression {
  task_id: string;
  task_name: string;
  status: RegressionStatus;
  baseline_score: number;
  current_score: number;
  score_delta: number;
  baseline_cost_cents: number;
  current_cost_cents: number;
  cost_delta_cents: number;
}

// Aggregated regression report across suites
export interface RegressionReport {
  generated_at: string;
  period_start: string;
  period_end: string;
  suites_analyzed: number;
  total_regressions: number;
  total_improvements: number;
  regressions_by_suite: SuiteRegressionSummary[];
  overall_cost_delta_cents: number;
}

// Regression summary for a single suite
export interface SuiteRegressionSummary {
  suite_id: string;
  suite_name: string;
  baseline_version: string;
  current_version: string;
  baseline_score: number;
  current_score: number;
  score_delta: number;
  regressed_tasks: TaskRegression[];
  improved_tasks: TaskRegression[];
}

// Request to run an eval suite
export interface RunEvalSuiteRequest {
  suite_id: string;
  agent_version_id?: string;
  compare_to_baseline?: boolean;
  subset_task_ids?: string[];
}

// Response from running an eval suite
export interface RunEvalSuiteResponse {
  eval_run_id: string;
}

// List eval suites response
export interface ListEvalSuitesResponse {
  suites: EvalSuiteSummary[];
  total?: number;
  offset?: number;
  limit?: number;
}

// List eval runs response
export interface ListEvalRunsResponse {
  runs: EvalRun[];
  total?: number;
  offset?: number;
  limit?: number;
}

// Query params for listing eval runs
export interface EvalRunsParams {
  suite_id?: string;
  agent_version_id?: string;
  status?: EvalRunStatus;
  gate_status?: EvalGateStatus;
  limit?: number;
  offset?: number;
}
