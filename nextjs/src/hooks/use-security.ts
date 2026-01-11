"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchThreats,
  fetchThreat,
  fetchRunThreats,
  fetchRunThreatSummary,
  fetchAirlockConfig,
  updateAirlockConfig,
  toggleAirlockMode,
} from "@/lib/api/security";
import type { ThreatsParams, AirlockConfigUpdate } from "@/types/security";
import { POLLING_INTERVALS, STALE_TIMES } from "@/lib/config/query-config";

/**
 * Hook to fetch threats with optional filtering
 */
export function useThreats(params: ThreatsParams = {}) {
  return useQuery({
    queryKey: ["threats", params],
    queryFn: () => fetchThreats(params),
    staleTime: STALE_TIMES.SHORT,
    refetchInterval: POLLING_INTERVALS.MEDIUM,
  });
}

/**
 * Hook to fetch a single threat by ID
 */
export function useThreat(threatId: string) {
  return useQuery({
    queryKey: ["threat", threatId],
    queryFn: () => fetchThreat(threatId),
    enabled: !!threatId,
    staleTime: STALE_TIMES.LONG,
  });
}

/**
 * Hook to fetch threats for a specific run
 */
export function useRunThreats(runId: string) {
  return useQuery({
    queryKey: ["run-threats", runId],
    queryFn: () => fetchRunThreats(runId),
    enabled: !!runId,
    staleTime: STALE_TIMES.SHORT,
    refetchInterval: POLLING_INTERVALS.MEDIUM,
  });
}

/**
 * Hook to fetch threat summary for a run
 */
export function useRunThreatSummary(runId: string) {
  return useQuery({
    queryKey: ["run-threat-summary", runId],
    queryFn: () => fetchRunThreatSummary(runId),
    enabled: !!runId,
    staleTime: STALE_TIMES.SHORT,
    refetchInterval: POLLING_INTERVALS.MEDIUM,
  });
}

/**
 * Hook to fetch Airlock configuration
 */
export function useAirlockConfig() {
  return useQuery({
    queryKey: ["airlock-config"],
    queryFn: fetchAirlockConfig,
    staleTime: STALE_TIMES.LONG,
  });
}

/**
 * Hook to update Airlock configuration
 */
export function useUpdateAirlockConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (config: AirlockConfigUpdate) => updateAirlockConfig(config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["airlock-config"] });
    },
  });
}

/**
 * Hook to toggle Airlock mode
 */
export function useToggleAirlockMode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: toggleAirlockMode,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["airlock-config"] });
    },
  });
}
