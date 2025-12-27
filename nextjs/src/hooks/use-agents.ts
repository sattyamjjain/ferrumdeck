"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAgents, fetchAgent, createAgent } from "@/lib/api/agents";
import type { CreateAgentRequest } from "@/types/agent";
import { toast } from "sonner";

export function useAgents() {
  return useQuery({
    queryKey: ["agents"],
    queryFn: () => fetchAgents({ limit: 100 }),
    refetchInterval: 10000,
  });
}

export function useAgent(agentId: string) {
  return useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => fetchAgent(agentId),
    enabled: !!agentId,
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
