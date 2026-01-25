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
    <div className="p-6 space-y-6">
      {/* ARIA live region for screen reader announcements */}
      <LiveRegion message={statusAnnouncement} politeness="polite" />

      {/* Page header with gradient mesh background */}
      <div className="relative reveal-up" style={{ animationDelay: '0ms' }}>
        <div className="absolute inset-0 bg-gradient-mesh-subtle rounded-2xl -z-10" />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/8 via-transparent to-transparent rounded-2xl -z-10" />
        <div className="flex items-center justify-between py-4 px-1">
          <div className="flex items-center gap-4">
            {/* Enhanced icon with glow */}
            <div className="relative group">
              <div className="absolute inset-0 rounded-2xl bg-primary/20 blur-xl opacity-50 group-hover:opacity-80 transition-opacity" />
              <div className="relative p-3 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 backdrop-blur-sm">
                <LayoutDashboard className="h-6 w-6 text-primary drop-shadow-[0_0_4px_rgba(0,212,255,0.5)]" />
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight font-display bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                Overview
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
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
              className="gap-2 magnetic-hover bg-background-secondary/50 backdrop-blur-sm border-border/50 hover:border-primary/30 hover:bg-background-secondary"
            >
              <RefreshCw
                className={cn(
                  "h-4 w-4 transition-transform",
                  isFetching && "animate-spin"
                )}
              />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {/* Row 1: KPI Stats with staggered reveal */}
      <div className="reveal-up" style={{ animationDelay: '100ms' }}>
        {isLoading ? (
          <StatsGridSkeleton />
        ) : (
          <StatsGrid runs={runs} approvals={approvals} />
        )}
      </div>

      {/* Row 2: Charts with staggered reveal */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="reveal-up" style={{ animationDelay: '200ms' }}>
          <RunVolumeChart runs={runs} isLoading={isLoading} />
        </div>
        <div className="reveal-up" style={{ animationDelay: '250ms' }}>
          <StatusDistributionChart runs={runs} isLoading={isLoading} />
        </div>
      </div>

      {/* Row 3: Recent Runs & Pending Approvals */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="reveal-up" style={{ animationDelay: '300ms' }}>
          <RecentRuns runs={runs} isLoading={isLoading} limit={8} />
        </div>
        <div className="reveal-up" style={{ animationDelay: '350ms' }}>
          <PendingApprovals approvals={approvals} isLoading={isLoading} limit={5} />
        </div>
      </div>

      {/* Row 4: Activity Feed */}
      <div className="reveal-up" style={{ animationDelay: '400ms' }}>
        <ActivityFeed runs={runs} approvals={approvals} isLoading={isLoading} limit={15} />
      </div>
    </div>
  );
}
