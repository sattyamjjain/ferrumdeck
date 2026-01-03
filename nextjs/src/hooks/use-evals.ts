"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchEvalSuites,
  fetchEvalSuite,
  fetchEvalRuns,
  fetchEvalRun,
  runEvalSuite,
  fetchRegressionReport,
  cancelEvalRun,
} from "@/lib/api/evals";
import type { EvalRunsParams, RunEvalSuiteRequest } from "@/types/eval";

// ============================================================================
// Eval Suites Hooks
// ============================================================================

export function useEvalSuites() {
  return useQuery({
    queryKey: ["evalSuites"],
    queryFn: fetchEvalSuites,
    refetchInterval: 30000, // Refresh every 30s
  });
}

export function useEvalSuite(suiteId: string) {
  return useQuery({
    queryKey: ["evalSuite", suiteId],
    queryFn: () => fetchEvalSuite(suiteId),
    enabled: !!suiteId,
  });
}

// ============================================================================
// Eval Runs Hooks
// ============================================================================

export function useEvalRuns(params: EvalRunsParams = {}) {
  return useQuery({
    queryKey: ["evalRuns", params],
    queryFn: () => fetchEvalRuns(params),
    refetchInterval: 5000, // Refresh every 5s for active runs
  });
}

export function useEvalRun(evalRunId: string) {
  return useQuery({
    queryKey: ["evalRun", evalRunId],
    queryFn: () => fetchEvalRun(evalRunId),
    enabled: !!evalRunId,
    refetchInterval: (query) => {
      // Poll more frequently for running evals
      const status = query.state.data?.status;
      if (status === "running" || status === "pending") {
        return 2000;
      }
      return false;
    },
  });
}

// ============================================================================
// Run Eval Suite Mutation
// ============================================================================

export function useRunEvalSuite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (request: RunEvalSuiteRequest) => runEvalSuite(request),
    onSuccess: () => {
      // Invalidate eval runs to show the new run
      queryClient.invalidateQueries({ queryKey: ["evalRuns"] });
      // Also refresh suites to update last_run_at
      queryClient.invalidateQueries({ queryKey: ["evalSuites"] });
    },
  });
}

// ============================================================================
// Cancel Eval Run Mutation
// ============================================================================

export function useCancelEvalRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (evalRunId: string) => cancelEvalRun(evalRunId),
    onSuccess: (_, evalRunId) => {
      queryClient.invalidateQueries({ queryKey: ["evalRun", evalRunId] });
      queryClient.invalidateQueries({ queryKey: ["evalRuns"] });
    },
  });
}

// ============================================================================
// Regression Report Hook
// ============================================================================

export function useRegressionReport(periodDays: number = 7) {
  return useQuery({
    queryKey: ["regressionReport", periodDays],
    queryFn: () => fetchRegressionReport(periodDays),
    refetchInterval: 60000, // Refresh every minute
  });
}
