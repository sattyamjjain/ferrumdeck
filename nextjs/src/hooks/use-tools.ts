"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAPI } from "@/lib/api/client";
import type {
  Tool,
  ToolDetail,
  ToolVersion,
  ToolCallRecord,
  ToolUsageStats,
  CreateToolRequest,
  CreateToolVersionRequest,
  UpdateToolPolicyRequest,
  ListToolsParams,
  ListToolsResponse,
} from "@/types/tool";
import { toast } from "sonner";

// Build query string from params
function buildQueryString(params: ListToolsParams): string {
  const searchParams = new URLSearchParams();
  if (params.search) searchParams.set("search", params.search);
  if (params.risk_level) searchParams.set("risk_level", params.risk_level);
  if (params.mcp_server) searchParams.set("mcp_server", params.mcp_server);
  if (params.status) searchParams.set("status", params.status);
  if (params.health_status) searchParams.set("health_status", params.health_status);
  if (params.offset !== undefined) searchParams.set("offset", String(params.offset));
  if (params.limit !== undefined) searchParams.set("limit", String(params.limit));
  const qs = searchParams.toString();
  return qs ? `?${qs}` : "";
}

async function fetchTools(params?: ListToolsParams): Promise<Tool[]> {
  const queryString = params ? buildQueryString(params) : "";
  const response = await fetchAPI<ListToolsResponse | Tool[]>(`/v1/registry/tools${queryString}`);
  // Handle both paginated and array responses
  if (Array.isArray(response)) {
    return response;
  }
  return response.tools;
}

async function fetchTool(toolId: string): Promise<ToolDetail> {
  return fetchAPI<ToolDetail>(`/v1/registry/tools/${toolId}`);
}

async function fetchToolVersions(toolId: string): Promise<ToolVersion[]> {
  return fetchAPI<ToolVersion[]>(`/v1/registry/tools/${toolId}/versions`);
}

async function fetchToolVersion(toolId: string, versionId: string): Promise<ToolVersion> {
  return fetchAPI<ToolVersion>(`/v1/registry/tools/${toolId}/versions/${versionId}`);
}

async function fetchToolUsageStats(toolId: string): Promise<ToolUsageStats> {
  return fetchAPI<ToolUsageStats>(`/v1/registry/tools/${toolId}/usage`);
}

async function fetchToolCalls(toolId: string, limit: number = 50): Promise<ToolCallRecord[]> {
  return fetchAPI<ToolCallRecord[]>(`/v1/registry/tools/${toolId}/calls?limit=${limit}`);
}

async function fetchMcpServers(): Promise<string[]> {
  return fetchAPI<string[]>("/v1/registry/mcp-servers");
}

async function createTool(data: CreateToolRequest): Promise<Tool> {
  return fetchAPI<Tool>("/v1/registry/tools", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function createToolVersion(toolId: string, data: CreateToolVersionRequest): Promise<ToolVersion> {
  return fetchAPI<ToolVersion>(`/v1/registry/tools/${toolId}/versions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

async function updateToolPolicy(toolId: string, data: UpdateToolPolicyRequest): Promise<void> {
  return fetchAPI<void>(`/v1/registry/tools/${toolId}/policy`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

async function deleteTool(toolId: string): Promise<void> {
  return fetchAPI<void>(`/v1/registry/tools/${toolId}`, {
    method: "DELETE",
  });
}

// Hooks

export function useTools(params?: ListToolsParams) {
  return useQuery({
    queryKey: ["tools", params],
    queryFn: () => fetchTools(params),
    refetchInterval: 10000,
  });
}

export function useTool(toolId: string) {
  return useQuery({
    queryKey: ["tool", toolId],
    queryFn: () => fetchTool(toolId),
    enabled: !!toolId,
  });
}

export function useToolVersions(toolId: string) {
  return useQuery({
    queryKey: ["tool-versions", toolId],
    queryFn: () => fetchToolVersions(toolId),
    enabled: !!toolId,
  });
}

export function useToolVersion(toolId: string, versionId: string) {
  return useQuery({
    queryKey: ["tool-version", toolId, versionId],
    queryFn: () => fetchToolVersion(toolId, versionId),
    enabled: !!toolId && !!versionId,
  });
}

export function useToolUsageStats(toolId: string) {
  return useQuery({
    queryKey: ["tool-usage", toolId],
    queryFn: () => fetchToolUsageStats(toolId),
    enabled: !!toolId,
    refetchInterval: 30000,
  });
}

export function useToolCalls(toolId: string, limit: number = 50) {
  return useQuery({
    queryKey: ["tool-calls", toolId, limit],
    queryFn: () => fetchToolCalls(toolId, limit),
    enabled: !!toolId,
    refetchInterval: 10000,
  });
}

export function useMcpServers() {
  return useQuery({
    queryKey: ["mcp-servers"],
    queryFn: fetchMcpServers,
    staleTime: 60000,
  });
}

export function useCreateTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateToolRequest) => createTool(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      toast.success("Tool created");
    },
    onError: () => {
      toast.error("Failed to create tool");
    },
  });
}

export function useCreateToolVersion(toolId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateToolVersionRequest) => createToolVersion(toolId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tool", toolId] });
      queryClient.invalidateQueries({ queryKey: ["tool-versions", toolId] });
      toast.success("Version created");
    },
    onError: () => {
      toast.error("Failed to create version");
    },
  });
}

export function useUpdateToolPolicy(toolId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateToolPolicyRequest) => updateToolPolicy(toolId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tool", toolId] });
      toast.success("Policy updated");
    },
    onError: () => {
      toast.error("Failed to update policy");
    },
  });
}

export function useDeleteTool() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (toolId: string) => deleteTool(toolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tools"] });
      toast.success("Tool deleted");
    },
    onError: () => {
      toast.error("Failed to delete tool");
    },
  });
}
