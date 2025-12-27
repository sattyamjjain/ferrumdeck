"use client";

import { useState, useMemo } from "react";
import { Shield } from "lucide-react";
import { useApprovals } from "@/hooks/use-approvals";
import { ApprovalCard } from "./approval-card";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ApprovalStatus } from "@/types/approval";

const statusFilters: { label: string; value: ApprovalStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
];

export function ApprovalList() {
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus | "all">("pending");
  const { data, isLoading, error } = useApprovals();

  const filteredApprovals = useMemo(() => {
    if (!data) return [];

    return data.filter((approval) => {
      if (statusFilter === "all") return true;
      return approval.status === statusFilter;
    });
  }, [data, statusFilter]);

  const pendingCount = useMemo(() => {
    return data?.filter((a) => a.status === "pending").length || 0;
  }, [data]);

  if (isLoading) {
    return <LoadingPage />;
  }

  if (error) {
    return (
      <EmptyState
        icon={Shield}
        title="Failed to load approvals"
        description="Unable to connect to the server. Please check your connection."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {statusFilters.map((filter) => (
            <Button
              key={filter.value}
              variant="ghost"
              size="sm"
              onClick={() => setStatusFilter(filter.value)}
              className={cn(
                "text-xs",
                statusFilter === filter.value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              {filter.label}
              {filter.value === "pending" && pendingCount > 0 && (
                <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-purple-500/20 text-purple-400">
                  {pendingCount}
                </span>
              )}
            </Button>
          ))}
        </div>
      </div>

      {filteredApprovals.length === 0 ? (
        <EmptyState
          icon={Shield}
          title={statusFilter === "pending" ? "No pending approvals" : "No approvals found"}
          description={
            statusFilter === "pending"
              ? "All approval requests have been handled"
              : "No approvals match your current filter"
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredApprovals.map((approval) => (
            <ApprovalCard key={approval.id} approval={approval} />
          ))}
        </div>
      )}
    </div>
  );
}
