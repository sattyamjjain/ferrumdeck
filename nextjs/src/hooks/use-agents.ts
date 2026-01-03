"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchAgents,
  fetchAgent,
  fetchAgentStats,
  fetchAgentVersions,
  fetchEvalGateStatus,
  createAgent,
  promoteVersion,
  rollbackVersion,
  updateAgentTools,
} from "@/lib/api/agents";
import type {
  AgentStatus,
  CreateAgentRequest,
  DeploymentEnvironment,
} from "@/types/agent";
import { toast } from "sonner";

export interface UseAgentsParams {
  status?: AgentStatus | "all";
  search?: string;
}

export function useAgents(params: UseAgentsParams = {}) {
  return useQuery({
    queryKey: ["agents", params],
    queryFn: () =>
      fetchAgents({
        limit: 100,
        status: params.status,
        search: params.search,
      }),
    refetchInterval: 10000,
    staleTime: 5000,
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => fetchAgent(agentId),
    enabled: !!agentId,
  });
}

export function useAgentStats(agentId: string) {
  return useQuery({
    queryKey: ["agent", agentId, "stats"],
    queryFn: () => fetchAgentStats(agentId),
    enabled: !!agentId,
    refetchInterval: 30000,
  });
}

export function useAgentVersions(agentId: string) {
  return useQuery({
    queryKey: ["agent", agentId, "versions"],
    queryFn: () => fetchAgentVersions(agentId),
    enabled: !!agentId,
  });
}

export function useEvalGateStatus(agentId: string, versionId: string) {
  return useQuery({
    queryKey: ["agent", agentId, "versions", versionId, "eval-gates"],
    queryFn: () => fetchEvalGateStatus(agentId, versionId),
    enabled: !!agentId && !!versionId,
  });
}

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateAgentRequest) => createAgent(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agents"] });
      toast.success("Agent created");
    },
    onError: () => {
      toast.error("Failed to create agent");
    },
  });
}

export function usePromoteVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      versionId,
      targetEnvironment,
    }: {
      agentId: string;
      versionId: string;
      targetEnvironment: DeploymentEnvironment;
    }) => promoteVersion(agentId, versionId, targetEnvironment),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agent", variables.agentId] });
      queryClient.invalidateQueries({
        queryKey: ["agent", variables.agentId, "versions"],
      });
      toast.success(`Version promoted to ${variables.targetEnvironment}`);
    },
    onError: () => {
      toast.error("Failed to promote version");
    },
  });
}

export function useRollbackVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      environment,
      targetVersionId,
    }: {
      agentId: string;
      environment: DeploymentEnvironment;
      targetVersionId: string;
    }) => rollbackVersion(agentId, environment, targetVersionId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agent", variables.agentId] });
      queryClient.invalidateQueries({
        queryKey: ["agent", variables.agentId, "versions"],
      });
      toast.success(`Rolled back ${variables.environment}`);
    },
    onError: () => {
      toast.error("Failed to rollback version");
    },
  });
}

export function useUpdateAgentTools() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      agentId,
      versionId,
      tools,
    }: {
      agentId: string;
      versionId: string;
      tools: {
        allowed_tools?: string[];
        approval_tools?: string[];
        denied_tools?: string[];
      };
    }) => updateAgentTools(agentId, versionId, tools),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["agent", variables.agentId] });
      queryClient.invalidateQueries({
        queryKey: ["agent", variables.agentId, "versions"],
      });
      toast.success("Tool permissions updated");
    },
    onError: () => {
      toast.error("Failed to update tool permissions");
    },
  });
}
