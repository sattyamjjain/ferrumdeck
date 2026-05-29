"use client";

import { useQuery } from "@tanstack/react-query";
import {
  fetchAgentFiringRate,
  type FiringRateParams,
} from "@/lib/api/metrics";
import { POLLING_INTERVALS, STALE_TIMES } from "@/lib/config/query-config";

/**
 * Tool-call firing-rate trend for one agent. Reuses the existing TanStack
 * Query infrastructure — same polling cadence as the other agent-scoped
 * panels, no new state store.
 */
export function useToolCallFiringRate(
  agentId: string,
  params: FiringRateParams = {}
) {
  return useQuery({
    queryKey: ["agentFiringRate", agentId, params],
    queryFn: () => fetchAgentFiringRate(agentId, params),
    enabled: !!agentId,
    refetchInterval: POLLING_INTERVALS.BACKGROUND,
    staleTime: STALE_TIMES.MEDIUM,
  });
}
