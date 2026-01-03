"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  XCircle,
  Loader2,
  Clock,
  DollarSign,
  Zap,
  Hash,
  Copy,
  Check,
  RefreshCw,
  ChevronDown,
  ExternalLink,
  Activity,
  Timer,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RunStatusBadge } from "./run-status-badge";
import {
  formatCost,
  formatTokens,
  truncateId,
  formatDurationBetween,
  formatDateTime,
  isRunActive,
  copyToClipboard,
} from "@/lib/utils";
import { cancelRun } from "@/lib/api/runs";
import { toast } from "sonner";
import type { Run } from "@/types/run";

interface RunHeaderProps {
  run: Run;
  stepCount?: number;
}

export function RunHeader({ run, stepCount = 0 }: RunHeaderProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const isActive = isRunActive(run.status);

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(run.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["run", run.id] });
      queryClient.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Run cancelled");
    },
    onError: () => {
      toast.error("Failed to cancel run");
    },
  });

  const canCancel = ["created", "queued", "running", "waiting_approval"].includes(
    run.status
  );

  const handleCopyLink = useCallback(async () => {
    const url = `${window.location.origin}/runs/${run.id}`;
    const success = await copyToClipboard(url);
    if (success) {
      setCopied(true);
      toast.success("Link copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    }
  }, [run.id]);

  const handleCopyId = useCallback(async () => {
    const success = await copyToClipboard(run.id);
    if (success) {
      toast.success("Run ID copied to clipboard");
    }
  }, [run.id]);

  return (
    <TooltipProvider>
      <div className="space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Link
            href="/runs"
            className="hover:text-foreground transition-colors"
          >
            Runs
          </Link>
          <ChevronDown className="h-3 w-3 rotate-[-90deg]" />
          <span className="font-mono text-foreground">{truncateId(run.id)}</span>
        </div>

        {/* Header row */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link href="/runs">
              <Button variant="ghost" size="icon" className="shrink-0">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>

            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleCopyId}
                      className="text-xl font-semibold font-mono hover:text-muted-foreground transition-colors"
                    >
                      {truncateId(run.id)}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Click to copy full ID</TooltipContent>
                </Tooltip>

                <LargeStatusBadge status={run.status} isLive={isActive} />

                {isActive && (
                  <Badge
                    variant="outline"
                    className="animate-pulse bg-accent-green/10 text-accent-green border-accent-green/30"
                  >
                    <Activity className="h-3 w-3 mr-1" />
                    Live
                  </Badge>
                )}
              </div>

              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {run.agent_id && (
                  <Link
                    href={`/agents/${run.agent_id}`}
                    className="flex items-center gap-1 hover:text-foreground transition-colors"
                  >
                    <span>Agent:</span>
                    <span className="font-mono">{truncateId(run.agent_id, 8)}</span>
                    <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
                {run.agent_version_id && (
                  <span className="font-mono text-xs">
                    v{truncateId(run.agent_version_id, 6)}
                  </span>
                )}
                {run.status_reason && (
                  <span className="text-muted-foreground">
                    {run.status_reason}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" onClick={handleCopyLink}>
                  {copied ? (
                    <Check className="h-4 w-4 text-accent-green" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy link</TooltipContent>
            </Tooltip>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <RefreshCw className="h-4 w-4 mr-1" />
                  Replay
                  <ChevronDown className="h-3 w-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Replay with same input
                </DropdownMenuItem>
                <DropdownMenuItem>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Replay with modified input
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  View in Jaeger
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {canCancel && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <XCircle className="h-4 w-4 mr-1" />
                )}
                Cancel Run
              </Button>
            )}
          </div>
        </div>

        {/* Metrics cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <MetricCard
            icon={Timer}
            label="Duration"
            value={formatDurationBetween(run.started_at, run.completed_at)}
            sublabel={run.started_at ? formatDateTime(run.started_at) : undefined}
          />
          <MetricCard
            icon={Hash}
            label="Steps"
            value={String(stepCount)}
            sublabel={isActive ? "in progress" : "completed"}
          />
          <MetricCard
            icon={Zap}
            label="Input Tokens"
            value={formatTokens(run.input_tokens || 0)}
          />
          <MetricCard
            icon={Zap}
            label="Output Tokens"
            value={formatTokens(run.output_tokens || 0)}
          />
          <MetricCard
            icon={DollarSign}
            label="Cost"
            value={formatCost(run.cost_cents)}
            highlight={run.cost_cents > 100}
          />
        </div>

        {/* Budget warning if applicable */}
        {run.budget && run.usage && (
          <BudgetProgress budget={run.budget} usage={run.usage} />
        )}
      </div>
    </TooltipProvider>
  );
}

// Large animated status badge
function LargeStatusBadge({
  status,
  isLive,
}: {
  status: Run["status"];
  isLive: boolean;
}) {
  return (
    <div className="relative">
      {isLive && (
        <div className="absolute inset-0 animate-ping opacity-30">
          <RunStatusBadge status={status} showIcon={false} />
        </div>
      )}
      <RunStatusBadge status={status} />
    </div>
  );
}

// Metric card component
interface MetricCardProps {
  icon: typeof Clock;
  label: string;
  value: string;
  sublabel?: string;
  highlight?: boolean;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sublabel,
  highlight,
}: MetricCardProps) {
  return (
    <Card
      className={
        highlight
          ? "border-accent-yellow/30 bg-accent-yellow/5"
          : "bg-background-secondary/50"
      }
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-2 text-muted-foreground mb-1">
          <Icon className="h-3.5 w-3.5" />
          <span className="text-xs">{label}</span>
        </div>
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        {sublabel && (
          <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

// Budget progress component
function BudgetProgress({
  budget,
  usage,
}: {
  budget: Run["budget"];
  usage: NonNullable<Run["usage"]>;
}) {
  if (!budget) return null;

  const items: Array<{
    label: string;
    used: number;
    max: number | undefined;
    format: (n: number) => string;
  }> = [
    {
      label: "Tokens",
      used: usage.input_tokens + usage.output_tokens,
      max: budget.max_total_tokens,
      format: formatTokens,
    },
    {
      label: "Tool Calls",
      used: usage.tool_calls,
      max: budget.max_tool_calls,
      format: (n: number) => String(n),
    },
    {
      label: "Cost",
      used: usage.cost_cents,
      max: budget.max_cost_cents,
      format: formatCost,
    },
  ].filter((item) => item.max !== undefined);

  if (items.length === 0) return null;

  return (
    <Card className="border-accent-yellow/20 bg-accent-yellow/5">
      <CardContent className="p-3">
        <div className="text-xs text-muted-foreground mb-2 font-medium">
          Budget Usage
        </div>
        <div className="grid grid-cols-3 gap-4">
          {items.map((item) => {
            const percentage = item.max
              ? Math.min((item.used / item.max) * 100, 100)
              : 0;
            const isWarning = percentage > 80;
            const isCritical = percentage > 95;

            return (
              <div key={item.label} className="space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="font-mono">
                    {item.format(item.used)} / {item.format(item.max!)}
                  </span>
                </div>
                <div className="h-1.5 bg-background-tertiary rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      isCritical
                        ? "bg-accent-red"
                        : isWarning
                        ? "bg-accent-yellow"
                        : "bg-accent-green"
                    }`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
