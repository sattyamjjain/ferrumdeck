// Agent status types - matches Rust AgentStatus enum
export type AgentStatus = "draft" | "active" | "deprecated" | "archived";

// Environment for version deployment
export type DeploymentEnvironment = "development" | "staging" | "production";

// Agent version budget constraints
export interface AgentBudget {
  max_input_tokens?: number;
  max_output_tokens?: number;
  max_total_tokens?: number;
  max_tool_calls?: number;
  max_wall_time_secs?: number;
  max_cost_cents?: number;
}

// Tool configuration for an agent
export interface ToolConfig {
  tool_id: string;
  tool_name: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}

// Tool permission level for an agent
export type ToolPermission = "allowed" | "approval_required" | "denied";

// Allowed tool with details
export interface AgentToolPermission {
  tool_name: string;
  permission: ToolPermission;
  risk_level?: "low" | "medium" | "high" | "critical";
}

// Deployment info for a version
export interface VersionDeployment {
  environment: DeploymentEnvironment;
  version_id: string;
  version: string;
  deployed_at: string;
  deployed_by?: string;
}

// Agent version model - matches Rust AgentVersion struct
export interface AgentVersion {
  id: string;
  agent_id: string;
  version: string;
  model: string;
  system_prompt: string;
  model_params?: Record<string, unknown>;
  // Tool permissions
  allowed_tools: string[];
  approval_tools?: string[];
  denied_tools?: string[];
  tool_configs?: Record<string, ToolConfig>;
  // Budget constraints
  budget?: AgentBudget;
  max_tokens?: number; // Alias for backward compatibility
  // Metadata
  changelog?: string;
  created_at: string;
  created_by?: string;
  // Deployment status
  deployed_environments?: DeploymentEnvironment[];
}

// Eval gate status for promotion
export interface EvalGateStatus {
  passed: boolean;
  suite_name: string;
  score: number;
  required_score: number;
  run_id?: string;
  completed_at?: string;
}

// Agent model - matches Rust Agent struct
export interface Agent {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description?: string;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
  latest_version?: AgentVersion;
  // Extended info for detail views
  deployments?: VersionDeployment[];
  versions?: AgentVersion[];
}

// Agent with version count for list views
export interface AgentWithVersionCount extends Agent {
  version_count: number;
}

// Agent stats for dashboard
export interface AgentStats {
  runs_24h: number;
  success_rate: number;
  avg_cost_cents: number;
  last_run_at?: string;
}

// Create agent request
export interface CreateAgentRequest {
  name: string;
  slug: string;
  description?: string;
  status?: AgentStatus;
}

// Create agent response
export interface CreateAgentResponse {
  id: string;
}

// Create agent version request
export interface CreateAgentVersionRequest {
  version: string;
  model: string;
  system_prompt: string;
  allowed_tools?: string[];
  approval_tools?: string[];
  denied_tools?: string[];
  model_params?: Record<string, unknown>;
  budget?: AgentBudget;
  changelog?: string;
}

// List agents response
export interface ListAgentsResponse {
  agents: Agent[];
  total?: number;
  offset?: number;
  limit?: number;
}

// Promote version request
export interface PromoteVersionRequest {
  version_id: string;
  target_environment: DeploymentEnvironment;
}

// Promote version response
export interface PromoteVersionResponse {
  success: boolean;
  deployment: VersionDeployment;
}

// List agent versions response
export interface ListAgentVersionsResponse {
  versions: AgentVersion[];
  total?: number;
}
