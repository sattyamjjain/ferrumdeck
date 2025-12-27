// API key status
export type ApiKeyStatus = "active" | "revoked" | "expired";

// API key scope permissions
export type ApiKeyScope =
  | "runs:read"
  | "runs:write"
  | "agents:read"
  | "agents:write"
  | "tools:read"
  | "tools:write"
  | "approvals:read"
  | "approvals:write"
  | "workflows:read"
  | "workflows:write"
  | "audit:read"
  | "admin";

// API key model - matches Rust ApiKey struct
export interface ApiKey {
  id: string;
  project_id: string;
  name: string;
  key_prefix: string; // First 8 chars for identification
  key_hash?: string; // Never exposed, only for internal use
  scopes: ApiKeyScope[];
  status: ApiKeyStatus;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
  created_by?: string;
  revoked_at?: string;
  revoked_by?: string;
}

// API key info (safe to display, without hash)
export interface ApiKeyInfo {
  id: string;
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  status: ApiKeyStatus;
  created_at: string;
  expires_at?: string;
  last_used_at?: string;
  usage_count?: number;
}

// Create API key request
export interface CreateApiKeyRequest {
  name: string;
  scopes: ApiKeyScope[];
  expires_in_days?: number;
}

// Create API key response (only time full key is returned)
export interface CreateApiKeyResponse {
  id: string;
  key: string; // Full key, only returned on creation
  name: string;
  key_prefix: string;
  scopes: ApiKeyScope[];
  expires_at?: string;
}

// Revoke API key request
export interface RevokeApiKeyRequest {
  reason?: string;
}

// List API keys response
export interface ListApiKeysResponse {
  keys: ApiKeyInfo[];
  total?: number;
}

// Tenant quota model
export interface TenantQuota {
  tenant_id: string;
  max_runs_per_day: number;
  max_tokens_per_day: number;
  max_cost_cents_per_day: number;
  max_concurrent_runs: number;
  max_agents: number;
  max_tools: number;
  max_api_keys: number;
}

// Current usage model
export interface TenantUsage {
  tenant_id: string;
  period: "day" | "month";
  runs_count: number;
  tokens_used: number;
  cost_cents: number;
  concurrent_runs: number;
  agents_count: number;
  tools_count: number;
  api_keys_count: number;
  updated_at: string;
}

// Usage summary for dashboard
export interface UsageSummary {
  quota: TenantQuota;
  current: TenantUsage;
  // Calculated percentages
  runs_percentage: number;
  tokens_percentage: number;
  cost_percentage: number;
}
