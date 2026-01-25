"use client";

import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  DollarSign,
  Play,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AnimatedCounter, CostCounter, PercentageCounter } from "@/components/shared/animated-counter";
import type { Run } from "@/types/run";
import type { ApprovalRequest } from "@/types/approval";

interface StatsGridProps {
  runs: Run[];
  approvals: ApprovalRequest[];
  isLoading?: boolean;
}

type AccentColor = "cyan" | "green" | "yellow" | "red" | "purple" | "orange";

interface TrendData {
  value: number;
  isPositive: boolean;
}

interface AccentStyle {
  iconBg: string;
  iconColor: string;
  glow: string;
  border: string;
  gradient: string;
}

interface StatCardProps {
  title: string;
  value: number;
  icon: LucideIcon;
  href: string;
  accentColor: AccentColor;
  trend?: TrendData;
  isLoading?: boolean;
  isPulsing?: boolean;
  isCost?: boolean;
}

const accentStyles: Record<AccentColor, AccentStyle> = {
  cyan: {
    iconBg: "bg-accent-primary/10",
    iconColor: "text-accent-primary",
    glow: "rgba(0, 212, 255, 0.15)",
    border: "rgba(0, 212, 255, 0.2)",
    gradient: "from-accent-primary/20 via-transparent to-transparent",
  },
  green: {
    iconBg: "bg-accent-green/10",
    iconColor: "text-accent-green",
    glow: "rgba(0, 255, 136, 0.15)",
    border: "rgba(0, 255, 136, 0.2)",
    gradient: "from-accent-green/20 via-transparent to-transparent",
  },
  yellow: {
    iconBg: "bg-accent-yellow/10",
    iconColor: "text-accent-yellow",
    glow: "rgba(255, 184, 0, 0.15)",
    border: "rgba(255, 184, 0, 0.2)",
    gradient: "from-accent-yellow/20 via-transparent to-transparent",
  },
  red: {
    iconBg: "bg-accent-red/10",
    iconColor: "text-accent-red",
    glow: "rgba(255, 61, 61, 0.15)",
    border: "rgba(255, 61, 61, 0.2)",
    gradient: "from-accent-red/20 via-transparent to-transparent",
  },
  purple: {
    iconBg: "bg-accent-purple/10",
    iconColor: "text-accent-purple",
    glow: "rgba(168, 85, 247, 0.15)",
    border: "rgba(168, 85, 247, 0.2)",
    gradient: "from-accent-purple/20 via-transparent to-transparent",
  },
  orange: {
    iconBg: "bg-accent-orange/10",
    iconColor: "text-accent-orange",
    glow: "rgba(255, 107, 44, 0.15)",
    border: "rgba(255, 107, 44, 0.2)",
    gradient: "from-accent-orange/20 via-transparent to-transparent",
  },
};

function StatCard({
  title,
  value,
  icon: Icon,
  href,
  accentColor,
  trend,
  isLoading,
  isPulsing,
  isCost,
}: StatCardProps) {
  const styles = accentStyles[accentColor];

  if (isLoading) {
    return (
      <div className="relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background-secondary to-background p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-3 flex-1">
            <Skeleton className="h-4 w-24 skeleton-shimmer" />
            <Skeleton className="h-10 w-20 skeleton-shimmer" />
            <Skeleton className="h-3 w-16 skeleton-shimmer" />
          </div>
          <Skeleton className="h-12 w-12 rounded-xl skeleton-shimmer" />
        </div>
      </div>
    );
  }

  return (
    <Link href={href} className="block group">
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border bg-gradient-to-br from-background-secondary to-background p-5",
          "transition-all duration-300 ease-out",
          "hover:translate-y-[-2px] hover:shadow-xl",
          "border-border/50 hover:border-border"
        )}
        style={{
          boxShadow: `0 4px 24px -4px ${styles.glow}`,
        }}
      >
        {/* Top accent line */}
        <div
          className={cn(
            "absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300",
            `bg-gradient-to-r ${styles.gradient}`
          )}
          style={{
            background: `linear-gradient(90deg, transparent, ${styles.border}, transparent)`,
          }}
        />

        {/* Background glow on hover */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{
            background: `radial-gradient(ellipse at top right, ${styles.glow} 0%, transparent 60%)`,
          }}
        />

        <div className="relative flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-foreground-muted">
              {title}
            </p>
            <div className="flex items-baseline gap-2 mt-2">
              <p className="text-3xl font-bold tracking-tight text-foreground font-display">
                {isCost ? (
                  <CostCounter value={value} duration={600} />
                ) : (
                  <AnimatedCounter value={value} duration={600} />
                )}
              </p>
              {isPulsing && (
                <Activity className={cn("h-4 w-4 animate-pulse", styles.iconColor)} />
              )}
            </div>
            {trend && (
              <div
                className={cn(
                  "flex items-center gap-1.5 text-xs mt-3 font-medium",
                  trend.isPositive ? "text-accent-green" : "text-accent-red"
                )}
              >
                {trend.isPositive ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : (
                  <TrendingDown className="h-3.5 w-3.5" />
                )}
                <PercentageCounter
                  value={Math.abs(trend.value)}
                  duration={400}
                  decimals={0}
                />
                <span className="ml-0.5">vs yesterday</span>
              </div>
            )}
          </div>
          <div
            className={cn(
              "flex items-center justify-center h-12 w-12 rounded-xl",
              "transition-all duration-300 group-hover:scale-110 group-hover:rotate-3",
              styles.iconBg
            )}
          >
            <Icon className={cn("h-6 w-6", styles.iconColor)} />
          </div>
        </div>
      </div>
    </Link>
  );
}

// Time constants
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const TWO_DAYS_MS = 48 * 60 * 60 * 1000;

// Status categories
const ACTIVE_STATUSES = ["running", "waiting_approval"] as const;
const FAILED_STATUSES = ["failed", "timeout", "budget_killed"] as const;

/** Calculate percentage change between two values */
function calculateTrendPercent(current: number, previous: number): number {
  if (previous > 0) {
    return Math.round(((current - previous) / previous) * 100);
  }
  return current > 0 ? 100 : 0;
}

/** Convert trend value to TrendData or undefined if no change */
function toTrendData(trendPercent: number): TrendData | undefined {
  if (trendPercent === 0) return undefined;
  return {
    value: Math.abs(trendPercent),
    isPositive: trendPercent < 0, // For failures/costs, negative change is "positive"
  };
}

export function StatsGrid({ runs, approvals, isLoading }: StatsGridProps) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - ONE_DAY_MS);
  const twoDaysAgo = new Date(now.getTime() - TWO_DAYS_MS);

  // Active runs
  const activeRuns = runs.filter((r) =>
    ACTIVE_STATUSES.includes(r.status as typeof ACTIVE_STATUSES[number])
  ).length;

  // Pending approvals
  const pendingApprovals = approvals.filter((a) => a.status === "pending").length;

  // Helper to check if run is in a time range
  const isInRange = (run: Run, start: Date, end?: Date) => {
    const createdAt = new Date(run.created_at);
    return createdAt >= start && (!end || createdAt < end);
  };

  // Helper to check if run has failed status
  const isFailed = (run: Run) =>
    FAILED_STATUSES.includes(run.status as typeof FAILED_STATUSES[number]);

  // Failed runs (24h periods)
  const failedLast24h = runs.filter((r) => isInRange(r, yesterday) && isFailed(r)).length;
  const failedPrevious24h = runs.filter(
    (r) => isInRange(r, twoDaysAgo, yesterday) && isFailed(r)
  ).length;

  // Cost (24h periods)
  const costLast24h = runs
    .filter((r) => isInRange(r, yesterday))
    .reduce((sum, r) => sum + (r.cost_cents || 0), 0);

  const costPrevious24h = runs
    .filter((r) => isInRange(r, twoDaysAgo, yesterday))
    .reduce((sum, r) => sum + (r.cost_cents || 0), 0);

  // Calculate trends
  const failedTrend = calculateTrendPercent(failedLast24h, failedPrevious24h);
  const costTrend = calculateTrendPercent(costLast24h, costPrevious24h);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 stagger-reveal">
      <StatCard
        title="Active Runs"
        value={activeRuns}
        icon={Play}
        href="/runs?status=running"
        accentColor="yellow"
        isLoading={isLoading}
        isPulsing={activeRuns > 0}
      />
      <StatCard
        title="Pending Approvals"
        value={pendingApprovals}
        icon={CheckCircle}
        href="/approvals"
        accentColor="purple"
        isLoading={isLoading}
        isPulsing={pendingApprovals > 0}
      />
      <StatCard
        title="Failed (24h)"
        value={failedLast24h}
        icon={AlertTriangle}
        href="/runs?status=failed"
        trend={toTrendData(failedTrend)}
        accentColor="red"
        isLoading={isLoading}
      />
      <StatCard
        title="Cost (24h)"
        value={costLast24h}
        isCost
        icon={DollarSign}
        href="/analytics"
        trend={toTrendData(costTrend)}
        accentColor="green"
        isLoading={isLoading}
      />
    </div>
  );
}

export function StatsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-background-secondary to-background p-5"
        >
          <div className="flex items-start justify-between">
            <div className="space-y-3 flex-1">
              <Skeleton className="h-4 w-24 skeleton-shimmer" />
              <Skeleton className="h-10 w-20 skeleton-shimmer" />
              <Skeleton className="h-3 w-16 skeleton-shimmer" />
            </div>
            <Skeleton className="h-12 w-12 rounded-xl skeleton-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}
