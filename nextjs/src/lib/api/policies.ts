import { fetchAPI } from "./client";
import type {
  Policy,
  Budget,
  SimulatePolicyRequest,
  SimulatePolicyResponse,
  CreatePolicyRequest,
  UpdatePolicyRequest,
  CreateBudgetRequest,
  UpdateBudgetRequest,
} from "@/types/policy";

export interface PoliciesParams {
  limit?: number;
  offset?: number;
  status?: string;
}

export interface BudgetsParams {
  limit?: number;
  offset?: number;
  status?: string;
  budget_type?: string;
}

// Policy API functions
export async function fetchPolicies(params: PoliciesParams = {}): Promise<Policy[]> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.status) query.set("status", params.status);

  const queryString = query.toString();
  return fetchAPI<Policy[]>(`/v1/policies${queryString ? `?${queryString}` : ""}`);
}

export async function fetchPolicy(policyId: string): Promise<Policy> {
  return fetchAPI<Policy>(`/v1/policies/${policyId}`);
}

export async function createPolicy(data: CreatePolicyRequest): Promise<Policy> {
  return fetchAPI<Policy>("/v1/policies", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updatePolicy(policyId: string, data: UpdatePolicyRequest): Promise<Policy> {
  return fetchAPI<Policy>(`/v1/policies/${policyId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deletePolicy(policyId: string): Promise<void> {
  await fetchAPI(`/v1/policies/${policyId}`, {
    method: "DELETE",
  });
}

export async function duplicatePolicy(policyId: string): Promise<Policy> {
  return fetchAPI<Policy>(`/v1/policies/${policyId}/duplicate`, {
    method: "POST",
  });
}

// Budget API functions
export async function fetchBudgets(params: BudgetsParams = {}): Promise<Budget[]> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  if (params.status) query.set("status", params.status);
  if (params.budget_type) query.set("budget_type", params.budget_type);

  const queryString = query.toString();
  return fetchAPI<Budget[]>(`/v1/budgets${queryString ? `?${queryString}` : ""}`);
}

export async function fetchBudget(budgetId: string): Promise<Budget> {
  return fetchAPI<Budget>(`/v1/budgets/${budgetId}`);
}

export async function createBudget(data: CreateBudgetRequest): Promise<Budget> {
  return fetchAPI<Budget>("/v1/budgets", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateBudget(budgetId: string, data: UpdateBudgetRequest): Promise<Budget> {
  return fetchAPI<Budget>(`/v1/budgets/${budgetId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteBudget(budgetId: string): Promise<void> {
  await fetchAPI(`/v1/budgets/${budgetId}`, {
    method: "DELETE",
  });
}

// Policy simulation
export async function simulatePolicy(data: SimulatePolicyRequest): Promise<SimulatePolicyResponse> {
  return fetchAPI<SimulatePolicyResponse>("/v1/policies/simulate", {
    method: "POST",
    body: JSON.stringify(data),
  });
}
