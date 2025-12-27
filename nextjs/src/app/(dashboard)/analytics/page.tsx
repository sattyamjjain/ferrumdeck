"use client";

import { useMemo } from "react";
import { BarChart3, Activity, DollarSign, Zap, CheckCircle, TrendingUp } from "lucide-react";
import { useRuns } from "@/hooks/use-runs";
import { KpiCard } from "@/components/charts/kpi-card";
import { RunVolumeChart } from "@/components/charts/run-volume-chart";
import { StatusDistributionChart } from "@/components/charts/status-distribution-chart";
import { CostChart } from "@/components/charts/cost-chart";
import { LoadingPage } from "@/components/shared/loading-spinner";
import { formatCost, formatTokens } from "@/lib/utils";

export default function AnalyticsPage() {
  const { data, isLoading } = useRuns({ limit: 500 });
  const runs = data?.runs || [];

  const stats = useMemo(() => {
    const totalRuns = runs.length;
    const completedRuns = runs.filter((r) => r.status === "completed").length;
    const successRate = totalRuns > 0 ? Math.round((completedRuns / totalRuns) * 100) : 0;
    const totalCost = runs.reduce((sum, r) => sum + (r.cost_cents || 0), 0);
    const totalTokens = runs.reduce(
      (sum, r) => sum + (r.input_tokens || 0) + (r.output_tokens || 0),
      0
    );
    const activeRuns = runs.filter(r => r.status === "running" || r.status === "waiting_approval").length;

    return { totalRuns, completedRuns, successRate, totalCost, totalTokens, activeRuns };
  }, [runs]);

  if (isLoading) {
    return <LoadingPage />;
  }

  return (
    <div className="p-6 space-y-6 animate-fade-in">
      {/* Page header with gradient accent */}
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-r from-accent-green/5 via-transparent to-transparent rounded-xl -z-10" />
        <div className="flex items-center gap-3 pb-2">
          <div className="p-2.5 rounded-xl bg-accent-green/10 border border-accent-green/20">
            <BarChart3 className="h-5 w-5 text-accent-green" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Usage metrics and performance insights
            </p>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          title="Total Runs"
          value={String(stats.totalRuns)}
          icon={Activity}
          subtitle="All time"
        />
        <KpiCard
          title="Success Rate"
          value={`${stats.successRate}%`}
          icon={CheckCircle}
          trend={stats.successRate >= 80 ? { value: stats.successRate - 75, isPositive: true } : undefined}
        />
        <KpiCard
          title="Total Cost"
          value={formatCost(stats.totalCost)}
          icon={DollarSign}
          subtitle="All time"
        />
        <KpiCard
          title="Total Tokens"
          value={formatTokens(stats.totalTokens)}
          icon={Zap}
          subtitle="All time"
        />
      </div>

      {/* Activity indicator */}
      {stats.activeRuns > 0 && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-accent-yellow/10 border border-accent-yellow/20">
          <div className="status-dot status-dot-running" />
          <span className="text-sm font-medium text-accent-yellow">
            {stats.activeRuns} run{stats.activeRuns > 1 ? 's' : ''} currently active
          </span>
        </div>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <RunVolumeChart runs={runs} />
        <StatusDistributionChart runs={runs} />
      </div>

      <CostChart runs={runs} />
    </div>
  );
}
