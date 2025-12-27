// Tool risk level - matches Rust ToolRiskLevel enum
export type ToolRiskLevel = "read" | "write" | "destructive";

// Tool status - matches Rust ToolStatus enum
export type ToolStatus = "active" | "deprecated" | "disabled";

// Tool version model - matches Rust ToolVersion struct
export interface ToolVersion {
  id: string;
  tool_id: string;
  version: string;
  input_schema: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  changelog?: string;
  created_at: string;
}

// Tool model - matches Rust Tool struct
export interface Tool {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description?: string;
  mcp_server: string;
  status: ToolStatus;
  risk_level: ToolRiskLevel;
  created_at: string;
  updated_at: string;
}

// Tool with version for detailed views
export interface ToolWithVersion extends Tool {
  latest_version?: ToolVersion;
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

// List tools response
export interface ListToolsResponse {
  tools: Tool[];
  total?: number;
  offset?: number;
  limit?: number;
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
