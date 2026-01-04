"use client";

import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { fetchRuns, fetchRun, fetchSteps, type RunsParams, type RunsResponse } from "@/lib/api/runs";
import { isRunActive, isRunTerminal, isRunsResponse } from "@/lib/type-guards";
import { POLLING_INTERVALS, STALE_TIMES } from "@/lib/config/query-config";
import type { Run } from "@/types/run";

export function useRuns(params: RunsParams = {}) {
  return useQuery({
    queryKey: ["runs", params],
    queryFn: () => fetchRuns(params),
    refetchInterval: (query) => {
      // Poll faster if there are active runs, slower otherwise
      const data = query.state.data;
      const hasActiveRuns = isRunsResponse(data)
        ? data.runs?.some((r) => isRunActive(r.status))
        : false;
      return hasActiveRuns ? POLLING_INTERVALS.ACTIVE : POLLING_INTERVALS.MEDIUM;
    },
    staleTime: STALE_TIMES.SHORT,
  });
}

// Infinite query for cursor-based pagination
export function useRunsInfinite(params: Omit<RunsParams, "cursor" | "offset"> = {}) {
  return useInfiniteQuery({
    queryKey: ["runs-infinite", params],
    queryFn: ({ pageParam }) =>
      fetchRuns({ ...params, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.next_cursor : undefined,
    refetchInterval: POLLING_INTERVALS.ACTIVE,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun(runId),
    refetchInterval: (query) => {
      // Only poll frequently if run is still active
      const run = query.state.data;
      if (!run) return POLLING_INTERVALS.ACTIVE;
      return isRunActive(run.status) ? POLLING_INTERVALS.ACTIVE : POLLING_INTERVALS.BACKGROUND;
    },
    enabled: !!runId,
  });
}

export function useSteps(runId: string, runStatus?: string) {
  return useQuery({
    queryKey: ["steps", runId],
    queryFn: () => fetchSteps(runId),
    // Adaptive polling: stop for terminal states, otherwise poll actively
    refetchInterval: runStatus && isRunTerminal(runStatus) ? false : POLLING_INTERVALS.ACTIVE,
    enabled: !!runId,
  });
}

// Hook that combines run and steps with smart polling
export function useRunWithSteps(runId: string) {
  const runQuery = useRun(runId);
  // Pass run status to enable adaptive polling for steps
  const stepsQuery = useSteps(runId, runQuery.data?.status);

  const isActive = runQuery.data ? isRunActive(runQuery.data.status) : false;
  const isTerminal = runQuery.data ? isRunTerminal(runQuery.data.status) : false;

  return {
    run: runQuery.data,
    steps: stepsQuery.data,
    isLoading: runQuery.isLoading || stepsQuery.isLoading,
    isError: runQuery.isError || stepsQuery.isError,
    error: runQuery.error || stepsQuery.error,
    isActive,
    isTerminal,
    refetch: async () => {
      await Promise.all([runQuery.refetch(), stepsQuery.refetch()]);
    },
  };
}
