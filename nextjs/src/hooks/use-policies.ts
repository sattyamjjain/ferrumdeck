"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchPolicies,
  fetchPolicy,
  createPolicy,
  updatePolicy,
  deletePolicy,
  duplicatePolicy,
  fetchBudgets,
  fetchBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  simulatePolicy,
  type PoliciesParams,
  type BudgetsParams,
} from "@/lib/api/policies";
import type {
  CreatePolicyRequest,
  UpdatePolicyRequest,
  CreateBudgetRequest,
  UpdateBudgetRequest,
  SimulatePolicyRequest,
} from "@/types/policy";
import { toast } from "sonner";

// Policy hooks
export function usePolicies(params: PoliciesParams = {}) {
  return useQuery({
    queryKey: ["policies", params],
    queryFn: () => fetchPolicies(params),
    refetchInterval: 10000,
  });
}

export function usePolicy(policyId: string) {
  return useQuery({
    queryKey: ["policy", policyId],
    queryFn: () => fetchPolicy(policyId),
    enabled: !!policyId,
  });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreatePolicyRequest) => createPolicy(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Policy created");
    },
    onError: () => {
      toast.error("Failed to create policy");
    },
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ policyId, data }: { policyId: string; data: UpdatePolicyRequest }) =>
      updatePolicy(policyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Policy updated");
    },
    onError: () => {
      toast.error("Failed to update policy");
    },
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (policyId: string) => deletePolicy(policyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Policy deleted");
    },
    onError: () => {
      toast.error("Failed to delete policy");
    },
  });
}

export function useDuplicatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (policyId: string) => duplicatePolicy(policyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policies"] });
      toast.success("Policy duplicated");
    },
    onError: () => {
      toast.error("Failed to duplicate policy");
    },
  });
}

// Budget hooks
export function useBudgets(params: BudgetsParams = {}) {
  return useQuery({
    queryKey: ["budgets", params],
    queryFn: () => fetchBudgets(params),
    refetchInterval: 5000, // More frequent updates for usage tracking
  });
}

export function useBudget(budgetId: string) {
  return useQuery({
    queryKey: ["budget", budgetId],
    queryFn: () => fetchBudget(budgetId),
    enabled: !!budgetId,
    refetchInterval: 5000,
  });
}

export function useCreateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateBudgetRequest) => createBudget(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget created");
    },
    onError: () => {
      toast.error("Failed to create budget");
    },
  });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ budgetId, data }: { budgetId: string; data: UpdateBudgetRequest }) =>
      updateBudget(budgetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget updated");
    },
    onError: () => {
      toast.error("Failed to update budget");
    },
  });
}

export function useDeleteBudget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (budgetId: string) => deleteBudget(budgetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      toast.success("Budget deleted");
    },
    onError: () => {
      toast.error("Failed to delete budget");
    },
  });
}

// Policy simulation hook
export function useSimulatePolicy() {
  return useMutation({
    mutationFn: (data: SimulatePolicyRequest) => simulatePolicy(data),
    onError: () => {
      toast.error("Failed to simulate policy");
    },
  });
}
