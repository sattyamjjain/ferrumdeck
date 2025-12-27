"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchAPI } from "@/lib/api/client";
import type { Tool, CreateToolRequest } from "@/types/tool";
import { toast } from "sonner";

async function fetchTools(): Promise<Tool[]> {
  return fetchAPI<Tool[]>("/v1/registry/tools");
}

async function fetchTool(toolId: string): Promise<Tool> {
  return fetchAPI<Tool>(`/v1/registry/tools/${toolId}`);
}

async function createTool(data: CreateToolRequest): Promise<Tool> {
  return fetchAPI<Tool>("/v1/registry/tools", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function useTools() {
  return useQuery({
    queryKey: ["tools"],
    queryFn: fetchTools,
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
