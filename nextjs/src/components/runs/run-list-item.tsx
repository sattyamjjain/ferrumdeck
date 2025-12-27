"use client";

import Link from "next/link";
import { Clock, DollarSign, Zap, ChevronRight, Bot, Hash } from "lucide-react";
import { RunStatusBadge } from "./run-status-badge";
import { formatTimeAgo, formatCost, formatTokens, truncateId, getTaskFromInput } from "@/lib/utils";
import type { Run } from "@/types/run";
import { cn } from "@/lib/utils";

interface RunListItemProps {
  run: Run;
  index?: number;
}

function getStatusAccentColor(status: string): string {
  switch (status) {
    case "running":
      return "border-l-yellow-500";
    case "waiting":
    case "pending_approval":
      return "border-l-purple-500";
    case "completed":
      return "border-l-green-500";
    case "failed":
    case "cancelled":
      return "border-l-red-500";
    default:
      return "border-l-border";
  }
}

function getStatusDotClass(status: string): string {
  switch (status) {
    case "running":
      return "status-dot-running";
    case "waiting":
    case "pending_approval":
      return "status-dot-waiting";
    case "completed":
      return "status-dot-completed";
    case "failed":
    case "cancelled":
      return "status-dot-failed";
    default:
      return "bg-muted-foreground";
  }
}

export function RunListItem({ run, index = 0 }: RunListItemProps) {
  const task = getTaskFromInput(run.input);
  const totalTokens = (run.input_tokens || 0) + (run.output_tokens || 0);

  return (
    <Link
      href={`/runs/${run.id}`}
      className={cn(
        "group block opacity-0 animate-fade-in",
        index <= 10 && `stagger-${Math.min(index + 1, 8)}`
      )}
      style={{ animationFillMode: "forwards" }}
    >
      <div
        className={cn(
          "relative flex items-stretch rounded-lg border border-border/60 bg-card/50 overflow-hidden",
          "transition-all duration-200 ease-out",
          "hover:border-border-hover hover:bg-card hover:shadow-lg hover:shadow-black/10",
          "border-l-[3px]",
          getStatusAccentColor(run.status)
        )}
      >
        {/* Main content */}
        <div className="flex-1 p-4 min-w-0">
          {/* Top row: ID, Status, Time */}
          <div className="flex items-center gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className={cn("status-dot", getStatusDotClass(run.status))} />
              <span className="font-mono text-xs text-muted-foreground tracking-tight">
                {truncateId(run.id)}
              </span>
            </div>
            <RunStatusBadge status={run.status} />
            <span className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
              <Clock className="h-3 w-3" />
              {formatTimeAgo(run.created_at)}
            </span>
          </div>

          {/* Task description */}
          <p className="text-sm text-foreground/90 line-clamp-2 mb-3 leading-relaxed">
            {task}
          </p>

          {/* Bottom row: Metrics */}
          <div className="flex items-center gap-4 text-xs">
            {run.agent_id && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Bot className="h-3 w-3" />
                <span className="font-mono">{truncateId(run.agent_id, 8)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Zap className="h-3 w-3" />
              <span>{formatTokens(totalTokens)} tokens</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <DollarSign className="h-3 w-3" />
              <span>{formatCost(run.cost_cents)}</span>
            </div>
            {run.tool_calls !== undefined && run.tool_calls > 0 && (
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Hash className="h-3 w-3" />
                <span>{run.tool_calls} tools</span>
              </div>
            )}
          </div>
        </div>

        {/* Arrow indicator */}
        <div className="flex items-center px-3 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors">
          <ChevronRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

// Skeleton for loading state
export function RunListItemSkeleton({ index = 0 }: { index?: number }) {
  return (
    <div
      className={cn(
        "relative flex items-stretch rounded-lg border border-border/40 bg-card/30 overflow-hidden opacity-0 animate-fade-in",
        index <= 8 && `stagger-${index + 1}`
      )}
      style={{ animationFillMode: "forwards" }}
    >
      <div className="flex-1 p-4">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-2 w-2 rounded-full skeleton-shimmer" />
          <div className="h-4 w-24 rounded skeleton-shimmer" />
          <div className="h-5 w-16 rounded-full skeleton-shimmer" />
          <div className="h-4 w-20 rounded skeleton-shimmer ml-auto" />
        </div>
        <div className="h-4 w-full rounded skeleton-shimmer mb-2" />
        <div className="h-4 w-3/4 rounded skeleton-shimmer mb-3" />
        <div className="flex items-center gap-4">
          <div className="h-3 w-16 rounded skeleton-shimmer" />
          <div className="h-3 w-20 rounded skeleton-shimmer" />
          <div className="h-3 w-14 rounded skeleton-shimmer" />
        </div>
      </div>
      <div className="flex items-center px-3">
        <div className="h-5 w-5 rounded skeleton-shimmer" />
      </div>
    </div>
  );
}
