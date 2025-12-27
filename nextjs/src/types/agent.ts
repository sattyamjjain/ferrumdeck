// Agent status types - matches Rust AgentStatus enum
export type AgentStatus = "draft" | "active" | "deprecated" | "archived";

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
}

// Agent with version count for list views
export interface AgentWithVersionCount extends Agent {
  version_count: number;
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
