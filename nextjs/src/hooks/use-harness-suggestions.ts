"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  fetchHarnessSuggestions,
  resolveHarnessSuggestion,
} from "@/lib/api/harness-suggestions";
import { POLLING_INTERVALS, STALE_TIMES } from "@/lib/config/query-config";
import { getErrorMessage } from "@/lib/type-guards";

/**
 * Eval-driven harness/policy suggestions for one agent. Reuses the existing
 * TanStack Query cadence — same as the other agent-scoped panels, no new state
 * store. Disabled when no agent id is available (e.g. a legacy/stub eval run),
 * so the panel renders nothing.
 */
export function useHarnessSuggestions(agentId: string | undefined) {
  return useQuery({
    queryKey: ["harnessSuggestions", agentId],
    queryFn: () => fetchHarnessSuggestions(agentId as string),
    enabled: !!agentId,
    refetchInterval: POLLING_INTERVALS.BACKGROUND,
    staleTime: STALE_TIMES.MEDIUM,
  });
}

/**
 * Approve or reject a proposed harness suggestion. On success the agent's
 * suggestion list is invalidated so the folded status refreshes. Records the
 * decision only — applying the change is a separate, explicit step.
 */
export function useResolveHarnessSuggestion(agentId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      suggestionId,
      approve,
      note,
    }: {
      suggestionId: string;
      approve: boolean;
      note?: string;
    }) => resolveHarnessSuggestion(suggestionId, approve, note),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["harnessSuggestions", agentId],
      });
      toast.success(
        variables.approve
          ? "Suggestion approved (recorded — not auto-applied)"
          : "Suggestion rejected"
      );
    },
    onError: (error) => {
      toast.error(getErrorMessage(error) || "Failed to resolve suggestion");
    },
  });
}
