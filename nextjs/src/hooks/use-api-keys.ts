"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  ApiKeyInfo,
  CreateApiKeyRequest,
  CreateApiKeyResponse,
  ListApiKeysResponse,
  ApiKeyScope,
  ApiKeyStatus,
} from "@/types";

// Fetch all API keys
async function fetchApiKeys(): Promise<ListApiKeysResponse> {
  const res = await fetch("/api/v1/api-keys");

  if (!res.ok) {
    throw new Error("Failed to fetch API keys");
  }

  return res.json();
}

// Create a new API key
async function createApiKey(
  request: CreateApiKeyRequest
): Promise<CreateApiKeyResponse> {
  const res = await fetch("/api/v1/api-keys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || "Failed to create API key");
  }

  return res.json();
}

// Revoke an API key
async function revokeApiKey(keyId: string, reason?: string): Promise<void> {
  const res = await fetch(`/api/v1/api-keys/${keyId}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });

  if (!res.ok && res.status !== 204) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || "Failed to revoke API key");
  }
}

// Hook to fetch API keys
export function useApiKeys() {
  return useQuery({
    queryKey: ["api-keys"],
    queryFn: fetchApiKeys,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

// Hook to create a new API key
export function useCreateApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createApiKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

// Hook to revoke an API key
export function useRevokeApiKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ keyId, reason }: { keyId: string; reason?: string }) =>
      revokeApiKey(keyId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
}

// Helper to get status display info
export function getStatusInfo(status: ApiKeyStatus): {
  label: string;
  color: string;
} {
  switch (status) {
    case "active":
      return { label: "Active", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
    case "revoked":
      return { label: "Revoked", color: "bg-red-500/10 text-red-400 border-red-500/20" };
    case "expired":
      return { label: "Expired", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    default:
      return { label: status, color: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  }
}

// Helper to get scope display info
export function getScopeInfo(scope: ApiKeyScope): {
  label: string;
  description: string;
  category: string;
} {
  const scopeMap: Record<ApiKeyScope, { label: string; description: string; category: string }> = {
    "runs:read": { label: "Read Runs", description: "View run history and details", category: "Runs" },
    "runs:write": { label: "Write Runs", description: "Create and manage runs", category: "Runs" },
    "agents:read": { label: "Read Agents", description: "View agent configurations", category: "Agents" },
    "agents:write": { label: "Write Agents", description: "Create and update agents", category: "Agents" },
    "tools:read": { label: "Read Tools", description: "View tool definitions", category: "Tools" },
    "tools:write": { label: "Write Tools", description: "Create and update tools", category: "Tools" },
    "approvals:read": { label: "Read Approvals", description: "View approval requests", category: "Approvals" },
    "approvals:write": { label: "Write Approvals", description: "Approve or reject requests", category: "Approvals" },
    "workflows:read": { label: "Read Workflows", description: "View workflow definitions", category: "Workflows" },
    "workflows:write": { label: "Write Workflows", description: "Create and update workflows", category: "Workflows" },
    "audit:read": { label: "Read Audit", description: "View audit logs", category: "Audit" },
    admin: { label: "Admin", description: "Full administrative access", category: "Admin" },
  };

  return scopeMap[scope] || { label: scope, description: "", category: "Other" };
}

// All available scopes
export const ALL_SCOPES: ApiKeyScope[] = [
  "runs:read",
  "runs:write",
  "agents:read",
  "agents:write",
  "tools:read",
  "tools:write",
  "approvals:read",
  "approvals:write",
  "workflows:read",
  "workflows:write",
  "audit:read",
  "admin",
];

// Scope presets for common use cases
export const SCOPE_PRESETS = {
  readOnly: ["runs:read", "agents:read", "tools:read", "approvals:read", "workflows:read", "audit:read"] as ApiKeyScope[],
  runExecutor: ["runs:read", "runs:write", "agents:read", "tools:read"] as ApiKeyScope[],
  fullAccess: ALL_SCOPES,
};

// Export types for convenience
export type { ApiKeyInfo, CreateApiKeyRequest, CreateApiKeyResponse, ApiKeyScope, ApiKeyStatus };
