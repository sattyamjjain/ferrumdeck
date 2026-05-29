import { fetchAPI } from "./client";
import type { AgentFiringRateResponse } from "@/types/metrics";

export interface FiringRateParams {
  windowHours?: number;
  threshold?: number;
}

/**
 * Fetch the tool-call firing-rate trend for one agent.
 *
 * Hits the BFF route at
 * `/api/v1/registry/agents/:agentId/tool-call-firing-rate`. The wire shape is
 * the canonical `AgentFiringRateResponse`; the gateway upstream is wired
 * lazily — see the route handler for the fall-through-to-mock semantics.
 */
export async function fetchAgentFiringRate(
  agentId: string,
  params: FiringRateParams = {}
): Promise<AgentFiringRateResponse> {
  const search = new URLSearchParams();
  if (params.windowHours !== undefined) {
    search.set("window_hours", String(params.windowHours));
  }
  if (params.threshold !== undefined) {
    search.set("threshold", String(params.threshold));
  }
  const qs = search.toString();
  const path = `/v1/registry/agents/${agentId}/tool-call-firing-rate${
    qs ? `?${qs}` : ""
  }`;
  return fetchAPI<AgentFiringRateResponse>(path);
}
