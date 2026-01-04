"use client";

import { useMemo } from "react";
import { LayoutDashboard, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { StatsGrid, StatsGridSkeleton } from "@/components/overview/stats-grid";
import { RunVolumeChart } from "@/components/overview/run-volume-chart";
import { StatusDistributionChart } from "@/components/overview/status-distribution-chart";
import { RecentRuns } from "@/components/overview/recent-runs";
import { PendingApprovals } from "@/components/overview/pending-approvals";
import { ActivityFeed } from "@/components/overview/activity-feed";
import { ConnectionStatus } from "@/components/layout/connection-status";
import { LiveRegion } from "@/components/accessibility/live-region";
import { fetchRuns } from "@/lib/api/runs";
import { fetchApprovals } from "@/lib/api/approvals";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OverviewContent() {
  // Fetch runs with 5s refresh for stats, data is prefetched on server
  const {
    data: runsData,
    isLoading: runsLoading,
    refetch: refetchRuns,
    isFetching: runsFetching,
  } = useQuery({
    queryKey: ["runs", { limit: 100 }],
    queryFn: () => fetchRuns({ limit: 100 }),
    refetchInterval: 5000,
  });

  // Fetch approvals with 5s refresh, data is prefetched on server
  const {
    data: approvalsData,
    isLoading: approvalsLoading,
    refetch: refetchApprovals,
    isFetching: approvalsFetching,
  } = useQuery({
    queryKey: ["approvals"],
    queryFn: () => fetchApprovals({ limit: 50 }),
    refetchInterval: 5000,
  });

  const runs = runsData?.runs || [];
  const approvals = useMemo(() => approvalsData || [], [approvalsData]);
  const isLoading = runsLoading || approvalsLoading;
  const isFetching = runsFetching || approvalsFetching;

  // Generate accessibility announcement for current state
  const statusAnnouncement = useMemo(() => {
    if (isLoading) return "";
    const runCount = runs.length;
    const approvalCount = approvals.length;
    const pending = approvals.filter(a => a.status === "pending").length;

    if (runCount === 0 && approvalCount === 0) {
      return "No runs or approvals available.";
    }

    const parts: string[] = [];
    if (runCount > 0) parts.push(`${runCount} runs loaded`);
    if (pending > 0) parts.push(`${pending} pending approvals`);

    return parts.join(", ") + ".";
  }, [runs.length, approvals, isLoading]);

  const handleRefresh = () => {
    refetchRuns();
    refetchApprovals();
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* ARIA live region for screen reader announcements */}
      <LiveRegion message={statusAnnouncement} politeness="polite" />

      {/* Page header */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
              <LayoutDashboard className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
              <p className="text-sm text-muted-foreground">
                Monitor your AgentOps control plane at a glance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <ConnectionStatus />
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isFetching}
              className="gap-2"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4",
                  isFetching && "animate-spin"
                )}
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Row 1: KPI Stats */}
      {isLoading ? (
        <StatsGridSkeleton />
      ) : (
        <StatsGrid runs={runs} approvals={approvals} />
      )}

      {/* Row 2: Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RunVolumeChart runs={runs} isLoading={isLoading} />
        <StatusDistributionChart runs={runs} isLoading={isLoading} />
      </div>

      {/* Row 3: Recent Runs & Pending Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RecentRuns runs={runs} isLoading={isLoading} limit={8} />
        <PendingApprovals approvals={approvals} isLoading={isLoading} limit={5} />
      </div>

      {/* Row 4: Activity Feed */}
      <ActivityFeed runs={runs} approvals={approvals} isLoading={isLoading} limit={15} />
    </div>
  );
}
