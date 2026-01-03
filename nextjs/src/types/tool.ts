// Tool risk level - matches security classification
export type ToolRiskLevel = "low" | "medium" | "high" | "critical";

// Tool health status - matches operational status
export type ToolHealthStatus = "ok" | "slow" | "error" | "unknown";

// Tool operational status - matches Rust ToolStatus enum
export type ToolStatus = "active" | "deprecated" | "disabled";

// Default policy for tool usage
export type ToolDefaultPolicy = "allowed" | "denied" | "approval_required";

// Tool version model - matches Rust ToolVersion struct
export interface ToolVersion {
  id: string;
  tool_id: string;
  version: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  changelog?: string;
  created_at: string;
  created_by?: string;
}

// Tool usage statistics
export interface ToolUsageStats {
  total_calls: number;
  calls_last_24h: number;
  calls_last_7d: number;
  avg_latency_ms: number;
  error_rate: number;
  top_agents: ToolAgentUsage[];
  calls_by_day: ToolCallsByDay[];
}

export interface ToolAgentUsage {
  agent_id: string;
  agent_name: string;
  call_count: number;
  last_called: string;
}

export interface ToolCallsByDay {
  date: string;
  count: number;
  success_count: number;
  error_count: number;
}

// Tool call record (detailed call history)
export interface ToolCallRecord {
  id: string;
  tool_id: string;
  run_id: string;
  step_id: string;
  agent_id: string;
  agent_name: string;
  arguments: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  latency_ms: number;
  called_at: string;
}

// Tool policy configuration
export interface ToolPolicy {
  default_policy: ToolDefaultPolicy;
  budget_limit_cents?: number;
  rate_limit_per_minute?: number;
  requires_justification: boolean;
  allowed_scopes?: string[];
}

// Tool agent override
export interface ToolAgentOverride {
  agent_id: string;
  agent_name: string;
  policy: ToolDefaultPolicy;
  budget_limit_cents?: number;
  created_at: string;
  updated_at: string;
}

// Tool model - matches Rust Tool struct with extended fields
export interface Tool {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description?: string;
  mcp_server: string;
  status: ToolStatus;
  risk_level: ToolRiskLevel;
  health_status: ToolHealthStatus;
  schema_version?: string;
  used_by_count: number;
  last_called?: string;
  created_at: string;
  updated_at: string;
}

// Tool with version for detailed views
export interface ToolWithVersion extends Tool {
  latest_version?: ToolVersion;
}

// Tool detail with all related data
export interface ToolDetail extends Tool {
  latest_version?: ToolVersion;
  versions?: ToolVersion[];
  policy?: ToolPolicy;
  agent_overrides?: ToolAgentOverride[];
  usage_stats?: ToolUsageStats;
  agents?: ToolAgentReference[];
}

// Reference to an agent using this tool
export interface ToolAgentReference {
  id: string;
  name: string;
  slug: string;
  status: string;
}

// Create tool request
export interface CreateToolRequest {
  name: string;
  slug: string;
  description?: string;
  mcp_server: string;
  risk_level: ToolRiskLevel;
  status?: ToolStatus;
}

// Create tool response
export interface CreateToolResponse {
  id: string;
}

// Create tool version request
export interface CreateToolVersionRequest {
  version: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  changelog?: string;
}

// Update tool policy request
export interface UpdateToolPolicyRequest {
  default_policy?: ToolDefaultPolicy;
  budget_limit_cents?: number;
  rate_limit_per_minute?: number;
  requires_justification?: boolean;
  allowed_scopes?: string[];
}

// List tools query params
export interface ListToolsParams {
  search?: string;
  risk_level?: ToolRiskLevel;
  mcp_server?: string;
  status?: ToolStatus;
  health_status?: ToolHealthStatus;
  offset?: number;
  limit?: number;
}

// List tools response
export interface ListToolsResponse {
  tools: Tool[];
  total: number;
  offset: number;
  limit: number;
}

// Tool call check request (policy validation)
export interface CheckToolPolicyRequest {
  tool_name: string;
  arguments: Record<string, unknown>;
}

// Tool call check response
export interface CheckToolPolicyResponse {
  allowed: boolean;
  requires_approval: boolean;
  reason?: string;
  policy_decision_id?: string;
}

// Schema diff result
export interface SchemaDiff {
  added: string[];
  removed: string[];
  modified: string[];
  unchanged: string[];
}
