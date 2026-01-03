"use client";

import { use } from "react";
import Link from "next/link";
import {
  FlaskConical,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  Tag,
  Target,
  XOctagon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import {
  EvalRunResults,
  EvalRunResultsSkeleton,
} from "@/components/evals/eval-run-results";
import { useEvalRun, useCancelEvalRun } from "@/hooks/use-evals";
import {
  formatTimeAgo,
  formatPercentage,
  formatDuration,
  formatCost,
  formatDateTime,
  cn,
} from "@/lib/utils";
import { toast } from "sonner";
import type { EvalRunStatus, EvalGateStatus } from "@/types/eval";

interface EvalRunDetailPageProps {
  params: Promise<{ evalRunId: string }>;
}

const runStatusConfig: Record<
  EvalRunStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  pending: {
    label: "Pending",
    className: "bg-secondary text-secondary-foreground",
    icon: Clock,
  },
  running: {
    label: "Running",
    className: "bg-accent-yellow/20 text-accent-yellow",
    icon: Loader2,
  },
  completed: {
    label: "Completed",
    className: "bg-green-500/20 text-green-400",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/20 text-red-400",
    icon: XCircle,
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-secondary text-secondary-foreground",
    icon: XOctagon,
  },
};

const gateStatusConfig: Record<
  EvalGateStatus,
  { label: string; className: string; bgClassName: string; icon: typeof CheckCircle2 }
> = {
  passed: {
    label: "Gate Passed",
    className: "text-green-400",
    bgClassName: "bg-green-500/10 border-green-500/30",
    icon: CheckCircle2,
  },
  failed: {
    label: "Gate Failed",
    className: "text-red-400",
    bgClassName: "bg-red-500/10 border-red-500/30",
    icon: XCircle,
  },
  skipped: {
    label: "Gate Skipped",
    className: "text-muted-foreground",
    bgClassName: "bg-muted border-border",
    icon: Target,
  },
};

export default function EvalRunDetailPage({ params }: EvalRunDetailPageProps) {
  const { evalRunId } = use(params);

  const { data: evalRun, isLoading } = useEvalRun(evalRunId);
  const cancelMutation = useCancelEvalRun();

  const handleCancel = async () => {
    try {
      await cancelMutation.mutateAsync(evalRunId);
      toast.success("Evaluation cancelled");
    } catch (error) {
      toast.error("Failed to cancel evaluation", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  if (isLoading) {
    return <EvalRunDetailSkeleton />;
  }

  if (!evalRun) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FlaskConical}
          title="Evaluation run not found"
          description="The evaluation run you're looking for doesn't exist."
          variant="card"
          action={
            <Button asChild variant="outline">
              <Link href="/evals">Back to Evals</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const statusConfig = runStatusConfig[evalRun.status];
  const StatusIcon = statusConfig.icon;
  const gateConfig = evalRun.gate_status
    ? gateStatusConfig[evalRun.gate_status]
    : null;
  const GateIcon = gateConfig?.icon;

  const isRunning = evalRun.status === "running" || evalRun.status === "pending";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-border/50">
        <div className="flex items-center gap-2 mb-4">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/evals">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-accent-purple/10 border border-accent-purple/20">
              <FlaskConical className="h-5 w-5 text-accent-purple" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {evalRun.suite_name}
                </h1>
                <Badge
                  variant="secondary"
                  className={cn("text-xs flex items-center gap-1", statusConfig.className)}
                >
                  <StatusIcon
                    className={cn(
                      "h-3 w-3",
                      evalRun.status === "running" && "animate-spin"
                    )}
                  />
                  {statusConfig.label}
                </Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Tag className="h-3 w-3" />
                  {evalRun.agent_version}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatTimeAgo(evalRun.created_at)}
                </span>
                <span className="font-mono text-xs">
                  {evalRun.id}
                </span>
              </div>
            </div>
          </div>

          {isRunning && (
            <Button
              variant="outline"
              onClick={handleCancel}
              disabled={cancelMutation.isPending}
            >
              <XOctagon className="h-4 w-4 mr-2" />
              Cancel
            </Button>
          )}
        </div>

        {/* Gate status banner */}
        {gateConfig && GateIcon && (
          <div
            className={cn(
              "mt-4 p-4 rounded-lg border flex items-center justify-between",
              gateConfig.bgClassName
            )}
          >
            <div className="flex items-center gap-3">
              <GateIcon className={cn("h-6 w-6", gateConfig.className)} />
              <div>
                <div className={cn("font-medium", gateConfig.className)}>
                  {gateConfig.label}
                </div>
                <div className="text-sm text-muted-foreground">
                  Score: {formatPercentage(evalRun.score)} (threshold:{" "}
                  {formatPercentage(evalRun.gate_threshold)})
                </div>
              </div>
            </div>
            {evalRun.baseline_score !== undefined && (
              <div className="text-right">
                <div className="text-sm text-muted-foreground">
                  Baseline Score
                </div>
                <div className="font-medium">
                  {formatPercentage(evalRun.baseline_score)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Quick stats */}
        <div className="flex items-center gap-6 mt-4 text-sm">
          <div>
            <span className="text-muted-foreground">Tasks: </span>
            <span className="font-medium">
              <span className="text-green-400">{evalRun.passed_tasks}</span>
              {" / "}
              <span className="text-red-400">{evalRun.failed_tasks}</span>
              {" / "}
              <span className="text-yellow-400">{evalRun.error_tasks}</span>
              <span className="text-muted-foreground ml-1">
                (of {evalRun.total_tasks})
              </span>
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Duration: </span>
            <span className="font-medium">
              {formatDuration(evalRun.total_duration_ms)}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground">Cost: </span>
            <span className="font-medium">
              {formatCost(evalRun.total_cost_cents)}
            </span>
          </div>
          {evalRun.started_at && (
            <div>
              <span className="text-muted-foreground">Started: </span>
              <span className="font-medium">
                {formatDateTime(evalRun.started_at)}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6">
        {isRunning ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="h-12 w-12 text-accent-purple animate-spin mb-4" />
            <h3 className="text-lg font-medium mb-2">Evaluation in Progress</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              The evaluation is currently running. Results will appear here
              automatically when tasks complete.
            </p>
            {evalRun.task_results.length > 0 && (
              <div className="mt-6 text-sm text-muted-foreground">
                {evalRun.task_results.length} of {evalRun.total_tasks} tasks
                completed
              </div>
            )}
          </div>
        ) : (
          <EvalRunResults evalRun={evalRun} />
        )}
      </div>
    </div>
  );
}

function EvalRunDetailSkeleton() {
  return (
    <div className="p-6">
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-8 w-20" />
      </div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Skeleton className="h-12 w-12 rounded-xl" />
          <div>
            <Skeleton className="h-7 w-48 mb-1" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
      </div>
      <Skeleton className="h-20 w-full mb-6" />
      <EvalRunResultsSkeleton />
    </div>
  );
}
