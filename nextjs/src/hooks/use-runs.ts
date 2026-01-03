"use client";

import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { fetchRuns, fetchRun, fetchSteps, type RunsParams, type RunsResponse } from "@/lib/api/runs";
import { isRunActive, isRunTerminal } from "@/lib/utils";
import type { Run } from "@/types/run";

// Active polling interval (2 seconds)
const ACTIVE_POLL_INTERVAL = 2000;
// Inactive polling interval (30 seconds - just for occasional refresh)
const INACTIVE_POLL_INTERVAL = 30000;

export function useRuns(params: RunsParams = {}) {
  return useQuery({
    queryKey: ["runs", params],
    queryFn: () => fetchRuns(params),
    refetchInterval: (query) => {
      // Poll faster (2s) if there are active runs, slower (5s) otherwise
      const data = query.state.data as RunsResponse | undefined;
      const hasActiveRuns = data?.runs?.some((r) => isRunActive(r.status));
      return hasActiveRuns ? ACTIVE_POLL_INTERVAL : 5000;
    },
    staleTime: 1000,
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
    refetchInterval: ACTIVE_POLL_INTERVAL,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun(runId),
    refetchInterval: (query) => {
      // Only poll frequently if run is still active
      const run = query.state.data as Run | undefined;
      if (!run) return ACTIVE_POLL_INTERVAL;
      return isRunActive(run.status) ? ACTIVE_POLL_INTERVAL : INACTIVE_POLL_INTERVAL;
    },
    enabled: !!runId,
  });
}

export function useSteps(runId: string) {
  return useQuery({
    queryKey: ["steps", runId],
    queryFn: () => fetchSteps(runId),
    // Steps are fetched alongside run, so inherit same polling logic
    // But we need the run data to determine polling - use 2s as safe default
    refetchInterval: ACTIVE_POLL_INTERVAL,
    enabled: !!runId,
  });
}

// Hook that combines run and steps with smart polling
export function useRunWithSteps(runId: string) {
  const runQuery = useRun(runId);
  const stepsQuery = useSteps(runId);

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
