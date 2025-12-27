"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  Workflow,
  WorkflowRun,
  WorkflowStepExecution,
  CreateWorkflowRequest,
  CreateWorkflowRunRequest,
  ListWorkflowsResponse,
  ListWorkflowRunsResponse,
  ListStepExecutionsResponse,
  WorkflowStepType,
  WorkflowRunStatus,
} from "@/types";
import { toast } from "sonner";

// Fetch workflows
async function fetchWorkflows(): Promise<ListWorkflowsResponse> {
  const res = await fetch("/api/v1/workflows");
  if (!res.ok) throw new Error("Failed to fetch workflows");
  return res.json();
}

// Fetch a single workflow
async function fetchWorkflow(workflowId: string): Promise<Workflow> {
  const res = await fetch(`/api/v1/workflows/${workflowId}`);
  if (!res.ok) throw new Error("Failed to fetch workflow");
  return res.json();
}

// Create a workflow
async function createWorkflow(data: CreateWorkflowRequest): Promise<Workflow> {
  const res = await fetch("/api/v1/workflows", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create workflow");
  return res.json();
}

// Fetch workflow runs
async function fetchWorkflowRuns(workflowId?: string): Promise<ListWorkflowRunsResponse> {
  const url = workflowId
    ? `/api/v1/workflows/${workflowId}/runs`
    : "/api/v1/workflow-runs";
  const res = await fetch(url);
  if (!res.ok) throw new Error("Failed to fetch workflow runs");
  return res.json();
}

// Fetch a single workflow run
async function fetchWorkflowRun(runId: string): Promise<WorkflowRun> {
  const res = await fetch(`/api/v1/workflow-runs/${runId}`);
  if (!res.ok) throw new Error("Failed to fetch workflow run");
  return res.json();
}

// Create a workflow run
async function createWorkflowRun(data: CreateWorkflowRunRequest): Promise<WorkflowRun> {
  const res = await fetch("/api/v1/workflow-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create workflow run");
  return res.json();
}

// Cancel a workflow run
async function cancelWorkflowRun(runId: string): Promise<void> {
  const res = await fetch(`/api/v1/workflow-runs/${runId}/cancel`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to cancel workflow run");
}

// Fetch step executions for a workflow run
async function fetchStepExecutions(runId: string): Promise<ListStepExecutionsResponse> {
  const res = await fetch(`/api/v1/workflow-runs/${runId}/steps`);
  if (!res.ok) throw new Error("Failed to fetch step executions");
  return res.json();
}

// Hooks
export function useWorkflows() {
  return useQuery({
    queryKey: ["workflows"],
    queryFn: fetchWorkflows,
    refetchInterval: 10000,
  });
}

export function useWorkflow(workflowId: string) {
  return useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => fetchWorkflow(workflowId),
    enabled: !!workflowId,
  });
}

export function useCreateWorkflow() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflows"] });
      toast.success("Workflow created");
    },
    onError: () => {
      toast.error("Failed to create workflow");
    },
  });
}

export function useWorkflowRuns(workflowId?: string) {
  return useQuery({
    queryKey: ["workflow-runs", workflowId],
    queryFn: () => fetchWorkflowRuns(workflowId),
    refetchInterval: 5000,
  });
}

export function useWorkflowRun(runId: string) {
  return useQuery({
    queryKey: ["workflow-run", runId],
    queryFn: () => fetchWorkflowRun(runId),
    enabled: !!runId,
    refetchInterval: 2000,
  });
}

export function useCreateWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createWorkflowRun,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
      toast.success("Workflow run started");
    },
    onError: () => {
      toast.error("Failed to start workflow run");
    },
  });
}

export function useCancelWorkflowRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: cancelWorkflowRun,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workflow-runs"] });
      toast.success("Workflow run cancelled");
    },
    onError: () => {
      toast.error("Failed to cancel workflow run");
    },
  });
}

export function useStepExecutions(runId: string) {
  return useQuery({
    queryKey: ["step-executions", runId],
    queryFn: () => fetchStepExecutions(runId),
    enabled: !!runId,
    refetchInterval: 2000,
  });
}

// Helper functions
export function getStepTypeInfo(type: WorkflowStepType) {
  switch (type) {
    case "llm":
      return { label: "LLM Call", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
    case "tool":
      return { label: "Tool", color: "bg-purple-500/10 text-purple-400 border-purple-500/20" };
    case "condition":
      return { label: "Condition", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    case "loop":
      return { label: "Loop", color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" };
    case "parallel":
      return { label: "Parallel", color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" };
    case "approval":
      return { label: "Approval", color: "bg-orange-500/10 text-orange-400 border-orange-500/20" };
    default:
      return { label: type, color: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  }
}

export function getRunStatusInfo(status: WorkflowRunStatus) {
  switch (status) {
    case "created":
      return { label: "Created", color: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    case "running":
      return { label: "Running", color: "bg-blue-500/10 text-blue-400 border-blue-500/20" };
    case "waiting_approval":
      return { label: "Waiting", color: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    case "completed":
      return { label: "Completed", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
    case "failed":
      return { label: "Failed", color: "bg-red-500/10 text-red-400 border-red-500/20" };
    case "cancelled":
      return { label: "Cancelled", color: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
    default:
      return { label: status, color: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
  }
}

// Export types
export type { Workflow, WorkflowRun, WorkflowStepExecution, WorkflowStepType, WorkflowRunStatus };
