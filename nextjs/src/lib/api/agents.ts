import { fetchAPI } from "./client";
import type {
  Agent,
  AgentStats,
  AgentStatus,
  AgentVersion,
  CreateAgentRequest,
  CreateAgentVersionRequest,
  DeploymentEnvironment,
  EvalGateStatus,
  PromoteVersionResponse,
} from "@/types/agent";

export interface AgentsParams {
  limit?: number;
  offset?: number;
  project_id?: string;
  status?: AgentStatus | "all";
  search?: string;
}

export async function fetchAgents(params: AgentsParams = {}): Promise<Agent[]> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.project_id) query.set("project_id", params.project_id);
  if (params.status && params.status !== "all") query.set("status", params.status);
  if (params.search) query.set("search", params.search);

  const queryString = query.toString();
  return fetchAPI<Agent[]>(`/v1/registry/agents${queryString ? `?${queryString}` : ""}`);
}

export async function fetchAgent(agentId: string): Promise<Agent> {
  return fetchAPI<Agent>(`/v1/registry/agents/${agentId}`);
}

export async function fetchAgentStats(agentId: string): Promise<AgentStats> {
  return fetchAPI<AgentStats>(`/v1/registry/agents/${agentId}/stats`);
}

export async function fetchAgentVersions(agentId: string): Promise<AgentVersion[]> {
  return fetchAPI<AgentVersion[]>(`/v1/registry/agents/${agentId}/versions`);
}

export async function fetchAgentVersion(agentId: string, versionId: string): Promise<AgentVersion> {
  return fetchAPI<AgentVersion>(`/v1/registry/agents/${agentId}/versions/${versionId}`);
}

export async function createAgent(data: CreateAgentRequest): Promise<Agent> {
  return fetchAPI<Agent>("/v1/registry/agents", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createAgentVersion(
  agentId: string,
  data: CreateAgentVersionRequest
): Promise<AgentVersion> {
  return fetchAPI<AgentVersion>(`/v1/registry/agents/${agentId}/versions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function promoteVersion(
  agentId: string,
  versionId: string,
  targetEnvironment: DeploymentEnvironment
): Promise<PromoteVersionResponse> {
  return fetchAPI<PromoteVersionResponse>(
    `/v1/registry/agents/${agentId}/versions/${versionId}/promote`,
    {
      method: "POST",
      body: JSON.stringify({ target_environment: targetEnvironment }),
    }
  );
}

export async function rollbackVersion(
  agentId: string,
  environment: DeploymentEnvironment,
  targetVersionId: string
): Promise<PromoteVersionResponse> {
  return fetchAPI<PromoteVersionResponse>(
    `/v1/registry/agents/${agentId}/rollback`,
    {
      method: "POST",
      body: JSON.stringify({ environment, target_version_id: targetVersionId }),
    }
  );
}

export async function fetchEvalGateStatus(
  agentId: string,
  versionId: string
): Promise<EvalGateStatus[]> {
  return fetchAPI<EvalGateStatus[]>(
    `/v1/registry/agents/${agentId}/versions/${versionId}/eval-gates`
  );
}

export async function updateAgentTools(
  agentId: string,
  versionId: string,
  tools: {
    allowed_tools?: string[];
    approval_tools?: string[];
    denied_tools?: string[];
  }
): Promise<AgentVersion> {
  return fetchAPI<AgentVersion>(
    `/v1/registry/agents/${agentId}/versions/${versionId}/tools`,
    {
      method: "PATCH",
      body: JSON.stringify(tools),
    }
  );
}
