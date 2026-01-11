import { fetchAPI } from "./client";
import type {
  Threat,
  ThreatsResponse,
  ThreatsParams,
  ThreatSummary,
  AirlockConfig,
  AirlockConfigUpdate,
} from "@/types/security";

/**
 * Fetch threats with optional filtering
 */
export async function fetchThreats(
  params: ThreatsParams = {}
): Promise<ThreatsResponse> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.run_id) query.set("run_id", params.run_id);
  if (params.risk_level) query.set("risk_level", params.risk_level);
  if (params.violation_type) query.set("violation_type", params.violation_type);
  if (params.action) query.set("action", params.action);
  if (params.created_after) query.set("created_after", params.created_after);
  if (params.created_before) query.set("created_before", params.created_before);

  const queryString = query.toString();
  return fetchAPI<ThreatsResponse>(
    `/v1/security/threats${queryString ? `?${queryString}` : ""}`
  );
}

/**
 * Fetch a single threat by ID
 */
export async function fetchThreat(threatId: string): Promise<Threat> {
  return fetchAPI<Threat>(`/v1/security/threats/${threatId}`);
}

/**
 * Fetch threats for a specific run
 */
export async function fetchRunThreats(runId: string): Promise<Threat[]> {
  const response = await fetchThreats({ run_id: runId, limit: 100 });
  return response.threats;
}

/**
 * Fetch threat summary for a run
 */
export async function fetchRunThreatSummary(
  runId: string
): Promise<ThreatSummary> {
  return fetchAPI<ThreatSummary>(`/v1/runs/${runId}/threat-summary`);
}

/**
 * Fetch Airlock configuration
 */
export async function fetchAirlockConfig(): Promise<AirlockConfig> {
  return fetchAPI<AirlockConfig>("/v1/security/config");
}

/**
 * Update Airlock configuration
 */
export async function updateAirlockConfig(
  config: AirlockConfigUpdate
): Promise<AirlockConfig> {
  return fetchAPI<AirlockConfig>("/v1/security/config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

/**
 * Toggle Airlock mode (shadow <-> enforce)
 */
export async function toggleAirlockMode(
  currentMode: string
): Promise<AirlockConfig> {
  const newMode = currentMode === "shadow" ? "enforce" : "shadow";
  return fetchAPI<AirlockConfig>("/v1/security/config", {
    method: "PUT",
    body: JSON.stringify({ mode: newMode }),
  });
}
