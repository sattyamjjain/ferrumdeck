"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApprovals, approveRequest, rejectRequest } from "@/lib/api/approvals";
import { POLLING_INTERVALS } from "@/lib/config/query-config";
import { getErrorMessage } from "@/lib/type-guards";
import { toast } from "sonner";

export function useApprovals() {
  return useQuery({
    queryKey: ["approvals"],
    queryFn: () => fetchApprovals({ limit: 50 }),
    refetchInterval: POLLING_INTERVALS.MEDIUM,
  });
}

export function useApproveAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ approvalId, note }: { approvalId: string; note?: string }) =>
      approveRequest(approvalId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Approval granted");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error) || "Failed to approve request");
    },
  });
}

export function useRejectAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ approvalId, note }: { approvalId: string; note?: string }) =>
      rejectRequest(approvalId, note),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Request rejected");
    },
    onError: (error) => {
      toast.error(getErrorMessage(error) || "Failed to reject request");
    },
  });
}
