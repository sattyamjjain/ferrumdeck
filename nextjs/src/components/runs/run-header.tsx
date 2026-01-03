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
  ChevronRight,
  ExternalLink,
  Activity,
  Timer,
  ArrowRight,
  MoreHorizontal,
  Cpu,
  GitBranch,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import type { Run } from "@/types/run";

interface RunHeaderProps {
  run: Run;
  stepCount?: number;
}

export function RunHeader({ run, stepCount = 0 }: RunHeaderProps) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [idCopied, setIdCopied] = useState(false);
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
      setIdCopied(true);
      toast.success("Run ID copied to clipboard");
      setTimeout(() => setIdCopied(false), 2000);
    }
  }, [run.id]);

  return (
    <TooltipProvider>
      <div className="space-y-6 animate-fade-in">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-sm">
          <Link
            href="/runs"
            className="flex items-center gap-1.5 text-foreground-muted hover:text-foreground transition-colors group"
          >
            <ArrowLeft className="h-3.5 w-3.5 group-hover:-translate-x-0.5 transition-transform" />
            <span>Runs</span>
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-foreground-dim" />
          <span className="font-mono text-foreground-secondary">
            {run.id}
          </span>
        </nav>

        {/* Main Header */}
        <div className="relative">
          {/* Ambient glow for active runs */}
          {isActive && (
            <div className="absolute -inset-4 bg-radial-glow opacity-50 pointer-events-none" />
          )}

          <div className="relative flex items-start justify-between gap-6">
            {/* Left: Run Identity */}
            <div className="flex-1 min-w-0 space-y-4">
              {/* Run ID and Status Row */}
              <div className="flex items-center gap-4 flex-wrap">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      onClick={handleCopyId}
                      className="group flex items-center gap-2 px-3 py-1.5 -ml-3 rounded-lg hover:bg-background-tertiary transition-colors"
                    >
                      <h1 className="text-2xl font-semibold font-mono tracking-tight text-foreground">
                        {run.id}
                      </h1>
                      {idCopied ? (
                        <Check className="h-4 w-4 text-accent-green" />
                      ) : (
                        <Copy className="h-4 w-4 text-foreground-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                      )}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    <span className="font-mono text-xs">Click to copy Run ID</span>
                  </TooltipContent>
                </Tooltip>

                <MissionStatusBadge status={run.status} isLive={isActive} />
              </div>

              {/* Context Row */}
              <div className="flex items-center gap-6 text-sm flex-wrap">
                {run.agent_id && (
                  <Link
                    href={`/agents/${run.agent_id}`}
                    className="group flex items-center gap-2 px-2.5 py-1 -ml-2.5 rounded-md hover:bg-background-tertiary transition-colors"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded-md bg-accent-purple/10 text-accent-purple">
                      <Cpu className="h-3.5 w-3.5" />
                    </div>
                    <span className="text-foreground-muted">Agent:</span>
                    <span className="font-mono text-foreground-secondary group-hover:text-foreground transition-colors">
                      {truncateId(run.agent_id, 16)}
                    </span>
                    <ExternalLink className="h-3 w-3 text-foreground-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </Link>
                )}

                {run.agent_version_id && (
                  <div className="flex items-center gap-2 text-foreground-muted">
                    <GitBranch className="h-3.5 w-3.5" />
                    <span>Version:</span>
                    <span className="font-mono text-foreground-secondary">
                      {truncateId(run.agent_version_id, 12)}
                    </span>
                  </div>
                )}

                {run.trace_id && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          copyToClipboard(run.trace_id!);
                          toast.success("Trace ID copied");
                        }}
                        className="flex items-center gap-2 text-foreground-muted hover:text-foreground-secondary transition-colors"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span className="font-mono text-xs">{truncateId(run.trace_id, 12)}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Copy Trace ID</TooltipContent>
                  </Tooltip>
                )}

                {run.status_reason && (
                  <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-accent-yellow/5 border border-accent-yellow/20 text-accent-yellow text-xs">
                    {run.status_reason}
                  </div>
                )}
              </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 shrink-0">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleCopyLink}
                    className="hover:border-accent-primary/50 hover:text-accent-primary transition-colors"
                  >
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
                  <Button variant="outline" size="sm" className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    <span className="hidden sm:inline">Replay</span>
                    <MoreHorizontal className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem className="gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Replay with same input
                  </DropdownMenuItem>
                  <DropdownMenuItem className="gap-2">
                    <ArrowRight className="h-4 w-4" />
                    Replay with modified input
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="gap-2"
                    onClick={() => {
                      const jaegerUrl = run.trace_id
                        ? `http://localhost:16686/trace/${run.trace_id}`
                        : `http://localhost:16686/search?service=ferrumdeck&tags=%7B%22run_id%22%3A%22${run.id}%22%7D`;
                      window.open(jaegerUrl, "_blank", "noopener,noreferrer");
                    }}
                  >
                    <ExternalLink className="h-4 w-4" />
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
                  className="gap-2"
                >
                  {cancelMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <XCircle className="h-4 w-4" />
                  )}
                  <span className="hidden sm:inline">Cancel</span>
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Metrics Dashboard */}
        <MetricsDashboard run={run} stepCount={stepCount} isActive={isActive} />

        {/* Budget Progress */}
        {run.budget && run.usage && (
          <BudgetProgress budget={run.budget} usage={run.usage} />
        )}
      </div>
    </TooltipProvider>
  );
}

// Premium Mission Control Status Badge
function MissionStatusBadge({
  status,
  isLive,
}: {
  status: Run["status"];
  isLive: boolean;
}) {
  return (
    <div className="relative flex items-center gap-3">
      {isLive && (
        <>
          {/* Outer pulse ring */}
          <div className="absolute -inset-1 rounded-full animate-ping opacity-20">
            <div className="w-full h-full rounded-full bg-accent-yellow" />
          </div>
        </>
      )}
      <RunStatusBadge status={status} size="lg" />

      {isLive && (
        <Badge
          variant="outline"
          className="gap-1.5 px-2.5 py-1 bg-accent-green/10 text-accent-green border-accent-green/30 animate-pulse"
        >
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-green opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-green" />
          </span>
          Live
        </Badge>
      )}
    </div>
  );
}

// Enhanced Metrics Dashboard
function MetricsDashboard({
  run,
  stepCount,
  isActive,
}: {
  run: Run;
  stepCount: number;
  isActive: boolean;
}) {
  const [elapsedTime, setElapsedTime] = useState<number>(0);

  // Update elapsed time for running runs
  useEffect(() => {
    if (isActive && run.started_at) {
      const updateElapsed = () => {
        setElapsedTime(Date.now() - new Date(run.started_at!).getTime());
      };
      updateElapsed();
      const interval = setInterval(updateElapsed, 1000);
      return () => clearInterval(interval);
    }
  }, [isActive, run.started_at]);

  const metrics = [
    {
      icon: Timer,
      label: "Duration",
      value: formatDurationBetween(run.started_at, run.completed_at) || (isActive && run.started_at ? formatMilliseconds(elapsedTime) : "—"),
      sublabel: run.started_at ? formatDateTime(run.started_at) : "Not started",
      color: "cyan" as const,
      isLive: !!(isActive && run.started_at),
    },
    {
      icon: Hash,
      label: "Steps",
      value: String(stepCount),
      sublabel: isActive ? "in progress" : "total",
      color: "purple" as const,
    },
    {
      icon: Zap,
      label: "Input",
      value: formatTokens(run.input_tokens || 0),
      sublabel: "tokens",
      color: "blue" as const,
    },
    {
      icon: Zap,
      label: "Output",
      value: formatTokens(run.output_tokens || 0),
      sublabel: "tokens",
      color: "green" as const,
    },
    {
      icon: DollarSign,
      label: "Cost",
      value: formatCost(run.cost_cents),
      sublabel: run.cost_cents > 100 ? "High usage" : undefined,
      color: run.cost_cents > 100 ? "yellow" as const : "default" as const,
      highlight: run.cost_cents > 100,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      {metrics.map((metric, index) => (
        <MetricCard
          key={metric.label}
          {...metric}
          index={index}
        />
      ))}
    </div>
  );
}

// Color variants for metric cards
const metricColorVariants = {
  cyan: {
    icon: "text-accent-primary bg-accent-primary/10",
    border: "hover:border-accent-primary/30",
    glow: "group-hover:shadow-[0_0_20px_rgba(0,212,255,0.1)]",
  },
  purple: {
    icon: "text-accent-purple bg-accent-purple/10",
    border: "hover:border-accent-purple/30",
    glow: "group-hover:shadow-[0_0_20px_rgba(168,85,247,0.1)]",
  },
  blue: {
    icon: "text-accent-blue bg-accent-blue/10",
    border: "hover:border-accent-blue/30",
    glow: "group-hover:shadow-[0_0_20px_rgba(59,130,246,0.1)]",
  },
  green: {
    icon: "text-accent-green bg-accent-green/10",
    border: "hover:border-accent-green/30",
    glow: "group-hover:shadow-[0_0_20px_rgba(0,255,136,0.1)]",
  },
  yellow: {
    icon: "text-accent-yellow bg-accent-yellow/10",
    border: "hover:border-accent-yellow/30",
    glow: "group-hover:shadow-[0_0_20px_rgba(255,184,0,0.1)]",
  },
  default: {
    icon: "text-foreground-muted bg-background-tertiary",
    border: "hover:border-border-hover",
    glow: "",
  },
};

// Enhanced Metric Card
interface MetricCardProps {
  icon: typeof Clock;
  label: string;
  value: string;
  sublabel?: string;
  color?: keyof typeof metricColorVariants;
  highlight?: boolean;
  isLive?: boolean;
  index: number;
}

function MetricCard({
  icon: Icon,
  label,
  value,
  sublabel,
  color = "default",
  highlight,
  isLive,
  index,
}: MetricCardProps) {
  const colorVariant = metricColorVariants[color];

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl p-4 border transition-all duration-300",
        "bg-gradient-to-br from-background-secondary to-background",
        colorVariant.border,
        colorVariant.glow,
        highlight && "border-accent-yellow/30 bg-accent-yellow/5",
        isLive && "border-accent-primary/30"
      )}
      style={{ animationDelay: `${index * 50}ms` }}
    >
      {/* Top accent line */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-px opacity-0 group-hover:opacity-100 transition-opacity",
          color !== "default" && `bg-gradient-to-r from-transparent via-${color === "cyan" ? "accent-primary" : `accent-${color}`} to-transparent`
        )}
      />

      {/* Content */}
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded-md", colorVariant.icon)}>
              <Icon className="h-3.5 w-3.5" />
            </div>
            <span className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
              {label}
            </span>
          </div>
          <div className="space-y-0.5">
            <p className={cn(
              "text-xl font-bold tabular-nums tracking-tight",
              isLive && "text-accent-primary"
            )}>
              {value}
            </p>
            {sublabel && (
              <p className="text-xs text-foreground-muted">{sublabel}</p>
            )}
          </div>
        </div>

        {isLive && (
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-accent-primary/10">
            <Loader2 className="h-4 w-4 text-accent-primary animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}

// Budget Progress Component
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
    color: string;
  }> = [
    {
      label: "Tokens",
      used: usage.input_tokens + usage.output_tokens,
      max: budget.max_total_tokens,
      format: formatTokens,
      color: "accent-primary",
    },
    {
      label: "Tool Calls",
      used: usage.tool_calls,
      max: budget.max_tool_calls,
      format: (n: number) => String(n),
      color: "accent-purple",
    },
    {
      label: "Cost",
      used: usage.cost_cents,
      max: budget.max_cost_cents,
      format: formatCost,
      color: "accent-green",
    },
  ].filter((item) => item.max !== undefined);

  if (items.length === 0) return null;

  return (
    <div className="rounded-xl border border-accent-yellow/20 bg-accent-yellow/5 p-4 space-y-4">
      <div className="flex items-center gap-2 text-xs font-medium text-accent-yellow uppercase tracking-wider">
        <Activity className="h-3.5 w-3.5" />
        Budget Usage
      </div>
      <div className="grid grid-cols-3 gap-6">
        {items.map((item) => {
          const percentage = item.max
            ? Math.min((item.used / item.max) * 100, 100)
            : 0;
          const isWarning = percentage > 80;
          const isCritical = percentage > 95;

          return (
            <div key={item.label} className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-foreground-muted">{item.label}</span>
                <span className="font-mono font-medium">
                  {item.format(item.used)} / {item.format(item.max!)}
                </span>
              </div>
              <div className="relative h-2 bg-background-tertiary rounded-full overflow-hidden">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                    isCritical
                      ? "bg-accent-red"
                      : isWarning
                      ? "bg-accent-yellow"
                      : "bg-accent-green"
                  )}
                  style={{ width: `${percentage}%` }}
                />
                {/* Glow effect */}
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 rounded-full blur-sm opacity-50",
                    isCritical
                      ? "bg-accent-red"
                      : isWarning
                      ? "bg-accent-yellow"
                      : "bg-accent-green"
                  )}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <div className="text-right text-xs font-mono text-foreground-muted">
                {percentage.toFixed(1)}%
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Helper function to format milliseconds
function formatMilliseconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
