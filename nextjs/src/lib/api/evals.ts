import { fetchAPI, fetchAPINoContent } from "./client";
import type {
  EvalSuite,
  EvalRun,
  ListEvalSuitesResponse,
  ListEvalRunsResponse,
  EvalRunsParams,
  RunEvalSuiteRequest,
  RunEvalSuiteResponse,
  RegressionReport,
} from "@/types/eval";

// ============================================================================
// Eval Suites
// ============================================================================

export async function fetchEvalSuites(): Promise<ListEvalSuitesResponse> {
  return fetchAPI<ListEvalSuitesResponse>("/v1/evals/suites");
}

export async function fetchEvalSuite(suiteId: string): Promise<EvalSuite> {
  return fetchAPI<EvalSuite>(`/v1/evals/suites/${suiteId}`);
}

// ============================================================================
// Eval Runs
// ============================================================================

export async function fetchEvalRuns(
  params: EvalRunsParams = {}
): Promise<ListEvalRunsResponse> {
  const searchParams = new URLSearchParams();

  if (params.suite_id) searchParams.set("suite_id", params.suite_id);
  if (params.agent_version_id)
    searchParams.set("agent_version_id", params.agent_version_id);
  if (params.status) searchParams.set("status", params.status);
  if (params.gate_status) searchParams.set("gate_status", params.gate_status);
  if (params.limit) searchParams.set("limit", String(params.limit));
  if (params.offset) searchParams.set("offset", String(params.offset));

  const queryString = searchParams.toString();
  const endpoint = queryString ? `/v1/evals/runs?${queryString}` : "/v1/evals/runs";

  return fetchAPI<ListEvalRunsResponse>(endpoint);
}

export async function fetchEvalRun(evalRunId: string): Promise<EvalRun> {
  return fetchAPI<EvalRun>(`/v1/evals/runs/${evalRunId}`);
}

// ============================================================================
// Run Eval Suite
// ============================================================================

export async function runEvalSuite(
  request: RunEvalSuiteRequest
): Promise<RunEvalSuiteResponse> {
  return fetchAPI<RunEvalSuiteResponse>("/v1/evals/runs", {
    method: "POST",
    body: JSON.stringify(request),
  });
}

// ============================================================================
// Regression Report
// ============================================================================

export async function fetchRegressionReport(
  periodDays: number = 7
): Promise<RegressionReport> {
  return fetchAPI<RegressionReport>(
    `/v1/evals/regression-report?period_days=${periodDays}`
  );
}

// ============================================================================
// Cancel Eval Run
// ============================================================================

export async function cancelEvalRun(evalRunId: string): Promise<void> {
  return fetchAPINoContent(`/v1/evals/runs/${evalRunId}/cancel`, {
    method: "POST",
  });
}
