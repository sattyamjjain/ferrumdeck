"use client";

import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  Coins,
  Hash,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Eye,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RegressionDiff } from "./regression-diff";
import {
  formatPercentage,
  formatCost,
  formatDuration,
  formatTokens,
  cn,
} from "@/lib/utils";
import type {
  EvalRun,
  EvalTaskResult,
  TaskResultStatus,
  ScorerBreakdown,
  RegressionSummary,
} from "@/types/eval";

interface EvalRunResultsProps {
  evalRun: EvalRun;
}

const taskStatusConfig: Record<
  TaskResultStatus,
  { label: string; className: string; icon: typeof CheckCircle2 }
> = {
  passed: {
    label: "Passed",
    className: "text-green-400",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "text-red-400",
    icon: XCircle,
  },
  error: {
    label: "Error",
    className: "text-yellow-400",
    icon: AlertCircle,
  },
  skipped: {
    label: "Skipped",
    className: "text-muted-foreground",
    icon: Minus,
  },
};

export function EvalRunResults({ evalRun }: EvalRunResultsProps) {
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Total Score"
          value={formatPercentage(evalRun.score)}
          trend={
            evalRun.regression_summary
              ? evalRun.score > (evalRun.baseline_score || 0)
                ? "up"
                : evalRun.score < (evalRun.baseline_score || 0)
                ? "down"
                : "neutral"
              : undefined
          }
          trendValue={
            evalRun.regression_summary
              ? formatPercentage(
                  Math.abs(evalRun.score - (evalRun.baseline_score || 0))
                )
              : undefined
          }
          className={
            evalRun.gate_status === "passed"
              ? "border-green-500/30"
              : evalRun.gate_status === "failed"
              ? "border-red-500/30"
              : ""
          }
        />
        <StatCard
          label="Tasks Passed"
          value={`${evalRun.passed_tasks}/${evalRun.total_tasks}`}
          subValue={formatPercentage(evalRun.passed_tasks / evalRun.total_tasks)}
        />
        <StatCard
          label="Total Cost"
          value={formatCost(evalRun.total_cost_cents)}
          trend={
            evalRun.regression_summary?.cost_delta_cents
              ? evalRun.regression_summary.cost_delta_cents > 0
                ? "up"
                : "down"
              : undefined
          }
          trendValue={
            evalRun.regression_summary?.cost_delta_cents
              ? formatCost(Math.abs(evalRun.regression_summary.cost_delta_cents))
              : undefined
          }
        />
        <StatCard
          label="Duration"
          value={formatDuration(evalRun.total_duration_ms)}
        />
      </div>

      {/* Regression Summary */}
      {evalRun.regression_summary && (
        <RegressionSummaryCard summary={evalRun.regression_summary} />
      )}

      {/* Scorer Breakdown */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">
            Scorer Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scorer</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Weight</TableHead>
                <TableHead className="text-right">Avg Score</TableHead>
                <TableHead className="text-right">Passed</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evalRun.scorer_breakdown.map((scorer) => (
                <ScorerBreakdownRow key={scorer.scorer_id} scorer={scorer} />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Task Results */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Task Results</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Task</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {evalRun.task_results.map((task) => (
                <TaskResultRow
                  key={task.task_id}
                  task={task}
                  isExpanded={expandedTask === task.task_id}
                  onToggle={() =>
                    setExpandedTask(
                      expandedTask === task.task_id ? null : task.task_id
                    )
                  }
                  showDiff={showDiff === task.task_id}
                  onToggleDiff={() =>
                    setShowDiff(showDiff === task.task_id ? null : task.task_id)
                  }
                />
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string;
  subValue?: string;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  className?: string;
}

function StatCard({
  label,
  value,
  subValue,
  trend,
  trendValue,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground mb-1">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold">{value}</span>
          {subValue && (
            <span className="text-sm text-muted-foreground">{subValue}</span>
          )}
        </div>
        {trend && trendValue && (
          <div
            className={cn(
              "flex items-center gap-1 text-xs mt-1",
              trend === "up" && "text-green-400",
              trend === "down" && "text-red-400",
              trend === "neutral" && "text-muted-foreground"
            )}
          >
            {trend === "up" ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : trend === "down" ? (
              <ArrowDownRight className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            {trendValue} vs baseline
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface RegressionSummaryCardProps {
  summary: RegressionSummary;
}

function RegressionSummaryCard({ summary }: RegressionSummaryCardProps) {
  return (
    <Card
      className={cn(
        "border-l-4",
        summary.regressed_tasks > 0 ? "border-l-red-500" : "border-l-green-500"
      )}
    >
      <CardContent className="p-4">
        <div className="flex flex-wrap gap-6">
          <div className="flex items-center gap-2">
            <div
              className={cn(
                "p-1.5 rounded-full",
                summary.regressed_tasks > 0
                  ? "bg-red-500/20"
                  : "bg-muted"
              )}
            >
              <ArrowDownRight
                className={cn(
                  "h-4 w-4",
                  summary.regressed_tasks > 0
                    ? "text-red-400"
                    : "text-muted-foreground"
                )}
              />
            </div>
            <div>
              <div className="text-sm font-medium">{summary.regressed_tasks}</div>
              <div className="text-xs text-muted-foreground">Regressed</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              className={cn(
                "p-1.5 rounded-full",
                summary.improved_tasks > 0
                  ? "bg-green-500/20"
                  : "bg-muted"
              )}
            >
              <ArrowUpRight
                className={cn(
                  "h-4 w-4",
                  summary.improved_tasks > 0
                    ? "text-green-400"
                    : "text-muted-foreground"
                )}
              />
            </div>
            <div>
              <div className="text-sm font-medium">{summary.improved_tasks}</div>
              <div className="text-xs text-muted-foreground">Improved</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-full bg-muted">
              <Minus className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <div className="text-sm font-medium">{summary.unchanged_tasks}</div>
              <div className="text-xs text-muted-foreground">Unchanged</div>
            </div>
          </div>

          {summary.new_tasks > 0 && (
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-full bg-accent-blue/20">
                <Hash className="h-4 w-4 text-accent-blue" />
              </div>
              <div>
                <div className="text-sm font-medium">{summary.new_tasks}</div>
                <div className="text-xs text-muted-foreground">New</div>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <div>
              <div
                className={cn(
                  "text-sm font-medium",
                  summary.score_delta > 0
                    ? "text-green-400"
                    : summary.score_delta < 0
                    ? "text-red-400"
                    : "text-muted-foreground"
                )}
              >
                {summary.score_delta > 0 ? "+" : ""}
                {formatPercentage(summary.score_delta)}
              </div>
              <div className="text-xs text-muted-foreground">Score Delta</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div>
              <div
                className={cn(
                  "text-sm font-medium",
                  summary.cost_delta_cents > 0
                    ? "text-red-400"
                    : summary.cost_delta_cents < 0
                    ? "text-green-400"
                    : "text-muted-foreground"
                )}
              >
                {summary.cost_delta_cents > 0 ? "+" : ""}
                {formatCost(summary.cost_delta_cents)}
              </div>
              <div className="text-xs text-muted-foreground">Cost Delta</div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface ScorerBreakdownRowProps {
  scorer: ScorerBreakdown;
}

function ScorerBreakdownRow({ scorer }: ScorerBreakdownRowProps) {
  return (
    <TableRow>
      <TableCell className="font-medium">{scorer.scorer_name}</TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs">
          {scorer.scorer_type}
        </Badge>
      </TableCell>
      <TableCell className="text-right">{scorer.weight}x</TableCell>
      <TableCell className="text-right">
        <span
          className={cn(
            "font-medium",
            scorer.avg_score >= 0.8
              ? "text-green-400"
              : scorer.avg_score >= 0.5
              ? "text-yellow-400"
              : "text-red-400"
          )}
        >
          {formatPercentage(scorer.avg_score)}
        </span>
      </TableCell>
      <TableCell className="text-right text-green-400">
        {scorer.tasks_passed}
      </TableCell>
      <TableCell className="text-right text-red-400">
        {scorer.tasks_failed}
      </TableCell>
    </TableRow>
  );
}

interface TaskResultRowProps {
  task: EvalTaskResult;
  isExpanded: boolean;
  onToggle: () => void;
  showDiff: boolean;
  onToggleDiff: () => void;
}

function TaskResultRow({
  task,
  isExpanded,
  onToggle,
  showDiff,
  onToggleDiff,
}: TaskResultRowProps) {
  const statusConfig = taskStatusConfig[task.status];
  const StatusIcon = statusConfig.icon;

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onToggle}>
        <TableCell>
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </TableCell>
        <TableCell className="font-medium">{task.task_name}</TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <StatusIcon className={cn("h-4 w-4", statusConfig.className)} />
            <span className={statusConfig.className}>{statusConfig.label}</span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <span
            className={cn(
              "font-medium",
              task.score >= 0.8
                ? "text-green-400"
                : task.score >= 0.5
                ? "text-yellow-400"
                : "text-red-400"
            )}
          >
            {formatPercentage(task.score)}
          </span>
        </TableCell>
        <TableCell className="text-right text-muted-foreground">
          {formatDuration(task.duration_ms)}
        </TableCell>
        <TableCell className="text-right text-muted-foreground">
          {formatCost(task.cost_cents)}
        </TableCell>
        <TableCell className="text-right">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2"
            onClick={(e) => {
              e.stopPropagation();
              onToggleDiff();
            }}
          >
            <Eye className="h-3 w-3 mr-1" />
            Diff
          </Button>
        </TableCell>
      </TableRow>

      {/* Expanded scorer results */}
      {isExpanded && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={7} className="p-4">
            <div className="space-y-4">
              {/* Scorer results */}
              <div className="space-y-2">
                <div className="text-sm font-medium">Scorer Results</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {task.scorer_results.map((result) => (
                    <div
                      key={result.scorer_id}
                      className={cn(
                        "p-2 rounded-lg border",
                        result.passed
                          ? "bg-green-500/10 border-green-500/30"
                          : "bg-red-500/10 border-red-500/30"
                      )}
                    >
                      <div className="text-xs text-muted-foreground">
                        {result.scorer_name}
                      </div>
                      <div
                        className={cn(
                          "text-sm font-medium",
                          result.passed ? "text-green-400" : "text-red-400"
                        )}
                      >
                        {formatPercentage(result.score)}
                      </div>
                      {result.details && (
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {result.details}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Error message */}
              {task.error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                  <div className="text-sm font-medium text-red-400 mb-1">
                    Error
                  </div>
                  <div className="text-xs text-red-300 font-mono">
                    {task.error}
                  </div>
                </div>
              )}

              {/* Token usage */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" />
                  {formatTokens(task.tokens_used)} tokens
                </span>
                <span className="flex items-center gap-1">
                  <Coins className="h-3 w-3" />
                  {formatCost(task.cost_cents)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDuration(task.duration_ms)}
                </span>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}

      {/* Diff modal */}
      {showDiff && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={7} className="p-4">
            <RegressionDiff
              expected={task.expected_output || ""}
              actual={task.actual_output || ""}
              expectedToolCalls={task.expected_tool_calls}
              actualToolCalls={task.tool_calls}
              scorerResults={task.scorer_results}
              onClose={onToggleDiff}
            />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

export function EvalRunResultsSkeleton() {
  return (
    <div className="space-y-6">
      {/* Stats skeleton */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <div className="h-3 w-20 bg-muted rounded animate-pulse mb-2" />
              <div className="h-8 w-16 bg-muted rounded animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Table skeleton */}
      <Card>
        <CardHeader className="pb-2">
          <div className="h-5 w-32 bg-muted rounded animate-pulse" />
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-muted/50 rounded animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
