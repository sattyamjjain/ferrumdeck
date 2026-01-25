/**
 * API functions for run operations.
 */

import { fetchAPI } from "./client";
import type { Run, Step, CreateRunRequest, CreateRunResponse } from "@/types/run";

// =============================================================================
// Types
// =============================================================================

/** Parameters for listing runs */
export interface RunsParams {
  limit?: number;
  offset?: number;
  cursor?: string;
  status?: string;
  agent_id?: string;
  project_id?: string;
  created_after?: string;
  created_before?: string;
}

/** Response from listing runs */
export interface RunsResponse {
  runs: Run[];
  total?: number;
  next_cursor?: string;
  has_more?: boolean;
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Build URL search params from an object, omitting undefined/null values.
 */
function buildQueryString(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      searchParams.set(key, String(value));
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

// =============================================================================
// API Functions
// =============================================================================

/**
 * Fetch a paginated list of runs.
 *
 * @example
 * const { runs, has_more } = await fetchRuns({ limit: 10, status: 'running' });
 */
export async function fetchRuns(params: RunsParams = {}): Promise<RunsResponse> {
  const query = buildQueryString({
    limit: params.limit,
    offset: params.offset,
    cursor: params.cursor,
    status: params.status,
    agent_id: params.agent_id,
    project_id: params.project_id,
    created_after: params.created_after,
    created_before: params.created_before,
  });

  return fetchAPI<RunsResponse>(`/v1/runs${query}`);
}

/**
 * Fetch a single run by ID.
 *
 * @example
 * const run = await fetchRun('run_01HGXK...');
 */
export async function fetchRun(runId: string): Promise<Run> {
  return fetchAPI<Run>(`/v1/runs/${runId}`);
}

/**
 * Fetch all steps for a run.
 *
 * @example
 * const steps = await fetchSteps('run_01HGXK...');
 */
export async function fetchSteps(runId: string): Promise<Step[]> {
  return fetchAPI<Step[]>(`/v1/runs/${runId}/steps`);
}

/**
 * Create a new run.
 *
 * @example
 * const { run_id } = await createRun({
 *   agent_version_id: 'agv_01HGXK...',
 *   input: { task: 'Review this PR' }
 * });
 */
export async function createRun(data: CreateRunRequest): Promise<CreateRunResponse> {
  return fetchAPI<CreateRunResponse>("/v1/runs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Cancel a running run.
 *
 * @example
 * const run = await cancelRun('run_01HGXK...');
 */
export async function cancelRun(runId: string): Promise<Run> {
  return fetchAPI<Run>(`/v1/runs/${runId}/cancel`, {
    method: "POST",
  });
}
