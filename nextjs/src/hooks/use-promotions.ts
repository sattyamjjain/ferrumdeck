"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchAgentPromotions } from "@/lib/api/promotions";
import { POLLING_INTERVALS, STALE_TIMES } from "@/lib/config/query-config";

/**
 * Champion-challenger promotion history for one agent. Reuses the existing
 * TanStack Query infrastructure — same cadence as the other agent-scoped
 * panels, no new state store.
 */
export function useAgentPromotions(agentId: string) {
  return useQuery({
    queryKey: ["agentPromotions", agentId],
    queryFn: () => fetchAgentPromotions(agentId),
    enabled: !!agentId,
    refetchInterval: POLLING_INTERVALS.BACKGROUND,
    staleTime: STALE_TIMES.MEDIUM,
  });
}
