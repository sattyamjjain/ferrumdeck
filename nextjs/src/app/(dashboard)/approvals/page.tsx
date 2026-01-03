"use client";

import { Shield, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ApprovalList } from "@/components/approvals/approval-list";
import { Button } from "@/components/ui/button";
import { useApprovals } from "@/hooks/use-approvals";

export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const { isFetching } = useApprovals();

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-purple/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3 pb-2">
            <div className="p-2.5 rounded-xl bg-accent-purple/10 border border-accent-purple/20">
              <Shield className="h-5 w-5 text-accent-purple" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                Approval Queue
              </h1>
              <p className="text-sm text-muted-foreground">
                Review and approve sensitive agent actions requiring manual authorization
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="flex-shrink-0"
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      <ApprovalList />
    </div>
  );
}
