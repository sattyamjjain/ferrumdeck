"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Shield } from "lucide-react";
import { useApprovals } from "@/hooks/use-approvals";
import { ApprovalCard } from "./approval-card";
import { ApprovalDrawer } from "./approval-drawer";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { EmptyState } from "@/components/shared/empty-state";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ApprovalRequest } from "@/types/approval";

type TabValue = "pending" | "resolved_today" | "all";

function isResolvedToday(approval: ApprovalRequest): boolean {
  if (!approval.resolved_at) return false;
  const resolvedDate = new Date(approval.resolved_at);
  const today = new Date();
  return (
    resolvedDate.getDate() === today.getDate() &&
    resolvedDate.getMonth() === today.getMonth() &&
    resolvedDate.getFullYear() === today.getFullYear()
  );
}

export function ApprovalList() {
  const [activeTab, setActiveTab] = useState<TabValue>("pending");
  const [selectedApproval, setSelectedApproval] = useState<ApprovalRequest | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const previousPendingIdsRef = useRef<Set<string>>(new Set());

  const { data, isLoading, error } = useApprovals();

  // Track new approvals for animation
  const [newApprovalIds, setNewApprovalIds] = useState<Set<string>>(new Set());

  // Filter approvals based on active tab
  const filteredApprovals = useMemo(() => {
    if (!data) return [];

    switch (activeTab) {
      case "pending":
        return data.filter((approval) => approval.status === "pending");
      case "resolved_today":
        return data.filter(
          (approval) =>
            approval.status !== "pending" && isResolvedToday(approval)
        );
      case "all":
        return data;
      default:
        return data;
    }
  }, [data, activeTab]);

  // Count pending approvals
  const pendingCount = useMemo(() => {
    return data?.filter((a) => a.status === "pending").length || 0;
  }, [data]);

  // Count resolved today
  const resolvedTodayCount = useMemo(() => {
    return (
      data?.filter(
        (a) => a.status !== "pending" && isResolvedToday(a)
      ).length || 0
    );
  }, [data]);

  // Detect new approvals for animation
  useEffect(() => {
    if (!data) return;

    const currentPendingIds = new Set(
      data.filter((a) => a.status === "pending").map((a) => a.id)
    );

    // Find new IDs that were not in the previous set
    const newIds = new Set<string>();
    currentPendingIds.forEach((id) => {
      if (!previousPendingIdsRef.current.has(id)) {
        newIds.add(id);
      }
    });

    if (newIds.size > 0) {
      setNewApprovalIds(newIds);
      // Clear animation after it completes
      const timer = setTimeout(() => {
        setNewApprovalIds(new Set());
      }, 500);
      return () => clearTimeout(timer);
    }

    previousPendingIdsRef.current = currentPendingIds;
  }, [data]);

  // Handle view details click
  const handleViewDetails = useCallback((approval: ApprovalRequest) => {
    setSelectedApproval(approval);
    setDrawerOpen(true);
  }, []);

  // Handle drawer close
  const handleDrawerClose = useCallback((open: boolean) => {
    setDrawerOpen(open);
    if (!open) {
      // Delay clearing selected approval for exit animation
      setTimeout(() => setSelectedApproval(null), 200);
    }
  }, []);

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
    <>
      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as TabValue)}
        className="space-y-4"
      >
        <TabsList className="bg-background-secondary border border-border">
          <TabsTrigger value="pending" className="gap-2">
            Pending
            {pendingCount > 0 && (
              <span
                className={cn(
                  "px-1.5 py-0.5 text-xs rounded-full",
                  "bg-accent-purple/20 text-accent-purple"
                )}
              >
                {pendingCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="resolved_today" className="gap-2">
            Resolved Today
            {resolvedTodayCount > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-muted text-muted-foreground">
                {resolvedTodayCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>

        <TabsContent value="pending">
          {filteredApprovals.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No pending approvals"
              description="All approval requests have been handled. New requests will appear here."
            />
          ) : (
            <div className="space-y-3">
              {filteredApprovals.map((approval) => (
                <div
                  key={approval.id}
                  className={cn(
                    newApprovalIds.has(approval.id) &&
                      "animate-in slide-in-from-top-2 duration-300"
                  )}
                >
                  <ApprovalCard
                    approval={approval}
                    onViewDetails={handleViewDetails}
                  />
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="resolved_today">
          {filteredApprovals.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No approvals resolved today"
              description="Approvals resolved today will appear here."
            />
          ) : (
            <div className="space-y-3">
              {filteredApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="all">
          {filteredApprovals.length === 0 ? (
            <EmptyState
              icon={Shield}
              title="No approvals found"
              description="Approval requests will appear here when agents request sensitive actions."
            />
          ) : (
            <div className="space-y-3">
              {filteredApprovals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  onViewDetails={handleViewDetails}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ApprovalDrawer
        approval={selectedApproval}
        open={drawerOpen}
        onOpenChange={handleDrawerClose}
      />
    </>
  );
}
