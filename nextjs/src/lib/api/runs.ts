import { fetchAPI } from "./client";
import type { Run, Step, CreateRunRequest, CreateRunResponse } from "@/types/run";

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

export interface RunsResponse {
  runs: Run[];
  total?: number;
  next_cursor?: string;
  has_more?: boolean;
}

export async function fetchRuns(params: RunsParams = {}): Promise<RunsResponse> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.status) query.set("status", params.status);
  if (params.agent_id) query.set("agent_id", params.agent_id);
  if (params.project_id) query.set("project_id", params.project_id);
  if (params.created_after) query.set("created_after", params.created_after);
  if (params.created_before) query.set("created_before", params.created_before);

  const queryString = query.toString();
  return fetchAPI<RunsResponse>(`/v1/runs${queryString ? `?${queryString}` : ""}`);
}

export async function fetchRun(runId: string): Promise<Run> {
  return fetchAPI<Run>(`/v1/runs/${runId}`);
}

export async function fetchSteps(runId: string): Promise<Step[]> {
  return fetchAPI<Step[]>(`/v1/runs/${runId}/steps`);
}

export async function createRun(data: CreateRunRequest): Promise<CreateRunResponse> {
  return fetchAPI<CreateRunResponse>("/v1/runs", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function cancelRun(runId: string): Promise<Run> {
  return fetchAPI<Run>(`/v1/runs/${runId}/cancel`, {
    method: "POST",
  });
}
