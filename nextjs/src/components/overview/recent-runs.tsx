"use client";

import Link from "next/link";
import { DollarSign, Zap, ChevronRight, Bot, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RunStatusBadge } from "@/components/runs/run-status-badge";
import { formatTimeAgo, formatCost, formatTokens, truncateId, getTaskFromInput, cn } from "@/lib/utils";
import type { Run } from "@/types/run";

interface RecentRunsProps {
  runs: Run[];
  isLoading?: boolean;
  limit?: number;
}

export function RecentRuns({ runs, isLoading, limit = 8 }: RecentRunsProps) {
  const recentRuns = runs.slice(0, limit);

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <div className="p-1.5 rounded-md bg-accent-blue/10">
            <Zap className="h-4 w-4 text-accent-blue" />
          </div>
          Recent Runs
        </CardTitle>
        <Button variant="ghost" size="sm" asChild className="text-xs">
          <Link href="/runs" className="flex items-center gap-1">
            View All
            <ArrowRight className="h-3 w-3" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <RecentRunSkeleton key={i} />
            ))}
          </div>
        ) : recentRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <Zap className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No runs yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Start an agent run to see activity here
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentRuns.map((run, index) => (
              <RecentRunItem key={run.id} run={run} index={index} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RecentRunItemProps {
  run: Run;
  index: number;
}

function RecentRunItem({ run, index }: RecentRunItemProps) {
  const task = getTaskFromInput(run.input);
  const totalTokens = (run.input_tokens || 0) + (run.output_tokens || 0);

  return (
    <Link
      href={`/runs/${run.id}`}
      className={cn(
        "group block opacity-0 animate-fade-in",
        index <= 8 && `stagger-${Math.min(index + 1, 8)}`
      )}
      style={{ animationFillMode: "forwards" }}
    >
      <div className="flex items-center gap-3 p-3 rounded-lg border border-border/50 bg-card/30 hover:border-border-hover hover:bg-card/60 transition-all duration-200">
        {/* Status indicator */}
        <div className="flex-shrink-0">
          <RunStatusBadge status={run.status} size="sm" showIcon={false} />
        </div>

        {/* Run info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-xs text-muted-foreground">
              {truncateId(run.id, 10)}
            </span>
            <span className="text-xs text-muted-foreground/60">
              {formatTimeAgo(run.created_at)}
            </span>
          </div>
          <p className="text-sm text-foreground/80 truncate">{task}</p>
        </div>

        {/* Metrics */}
        <div className="hidden sm:flex items-center gap-3 text-xs text-muted-foreground flex-shrink-0">
          {run.agent_id && (
            <div className="flex items-center gap-1">
              <Bot className="h-3 w-3" />
              <span className="font-mono">{truncateId(run.agent_id, 6)}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Zap className="h-3 w-3" />
            <span>{formatTokens(totalTokens)}</span>
          </div>
          <div className="flex items-center gap-1">
            <DollarSign className="h-3 w-3" />
            <span>{formatCost(run.cost_cents)}</span>
          </div>
        </div>

        {/* Arrow */}
        <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
      </div>
    </Link>
  );
}

function RecentRunSkeleton() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border/30 bg-card/20">
      <Skeleton className="h-5 w-16 rounded-full" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-full" />
      </div>
      <Skeleton className="h-4 w-4" />
    </div>
  );
}
