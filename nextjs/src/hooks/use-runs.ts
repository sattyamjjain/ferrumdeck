"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchRuns, fetchRun, fetchSteps, type RunsParams } from "@/lib/api/runs";

export function useRuns(params: RunsParams = {}) {
  return useQuery({
    queryKey: ["runs", params],
    queryFn: () => fetchRuns(params),
    refetchInterval: 2000,
  });
}

export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun(runId),
    refetchInterval: 2000,
    enabled: !!runId,
  });
}

export function useSteps(runId: string) {
  return useQuery({
    queryKey: ["steps", runId],
    queryFn: () => fetchSteps(runId),
    refetchInterval: 2000,
    enabled: !!runId,
  });
}
