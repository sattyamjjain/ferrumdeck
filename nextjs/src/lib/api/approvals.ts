import { fetchAPI } from "./client";
import type { ApprovalRequest, ResolveApprovalRequest } from "@/types/approval";

export interface ApprovalsParams {
  limit?: number;
}

export async function fetchApprovals(params: ApprovalsParams = {}): Promise<ApprovalRequest[]> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));

  const queryString = query.toString();
  return fetchAPI<ApprovalRequest[]>(`/v1/approvals${queryString ? `?${queryString}` : ""}`);
}

export async function resolveApproval(
  approvalId: string,
  data: ResolveApprovalRequest
): Promise<ApprovalRequest> {
  return fetchAPI<ApprovalRequest>(`/v1/approvals/${approvalId}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function approveRequest(approvalId: string, note?: string): Promise<ApprovalRequest> {
  return resolveApproval(approvalId, { approved: true, note });
}

export async function rejectRequest(approvalId: string, note?: string): Promise<ApprovalRequest> {
  return resolveApproval(approvalId, { approved: false, note });
}
