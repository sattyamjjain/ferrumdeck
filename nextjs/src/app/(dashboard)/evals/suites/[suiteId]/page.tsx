"use client";

import { use } from "react";
import Link from "next/link";
import {
  FlaskConical,
  ArrowLeft,
  Play,
  Clock,
  Target,
  Settings,
  CheckCircle2,
  XCircle,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { useEvalSuite, useEvalRuns, useRunEvalSuite } from "@/hooks/use-evals";
import {
  formatTimeAgo,
  formatPercentage,
  formatDuration,
  cn,
} from "@/lib/utils";
import { toast } from "sonner";
import type { EvalGateStatus, EvalRunStatus } from "@/types/eval";

interface SuiteDetailPageProps {
  params: Promise<{ suiteId: string }>;
}

const runStatusConfig: Record<
  EvalRunStatus,
  { label: string; className: string }
> = {
  pending: { label: "Pending", className: "bg-secondary text-secondary-foreground" },
  running: { label: "Running", className: "bg-accent-yellow/20 text-accent-yellow" },
  completed: { label: "Completed", className: "bg-green-500/20 text-green-400" },
  failed: { label: "Failed", className: "bg-red-500/20 text-red-400" },
  cancelled: { label: "Cancelled", className: "bg-secondary text-secondary-foreground" },
};

const gateStatusConfig: Record<
  EvalGateStatus,
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
  skipped: {
    label: "Skipped",
    className: "text-muted-foreground",
    icon: Minus,
  },
};

export default function SuiteDetailPage({ params }: SuiteDetailPageProps) {
  const { suiteId } = use(params);

  const { data: suite, isLoading: suiteLoading } = useEvalSuite(suiteId);
  const { data: runsData, isLoading: runsLoading } = useEvalRuns({
    suite_id: suiteId,
    limit: 20,
  });
  const runEvalSuiteMutation = useRunEvalSuite();

  const runs = runsData?.runs || [];

  const handleRunSuite = async () => {
    try {
      const result = await runEvalSuiteMutation.mutateAsync({
        suite_id: suiteId,
        compare_to_baseline: true,
      });
      toast.success("Evaluation started", {
        description: `Eval run ${result.eval_run_id} has been queued.`,
      });
    } catch (error) {
      toast.error("Failed to start evaluation", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    }
  };

  if (suiteLoading) {
    return <SuiteDetailSkeleton />;
  }

  if (!suite) {
    return (
      <div className="p-6">
        <EmptyState
          icon={FlaskConical}
          title="Suite not found"
          description="The evaluation suite you're looking for doesn't exist."
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
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
              <h1 className="text-2xl font-semibold tracking-tight">
                {suite.name}
              </h1>
              {suite.description && (
                <p className="text-sm text-muted-foreground">
                  {suite.description}
                </p>
              )}
            </div>
          </div>

          <Button onClick={handleRunSuite} disabled={runEvalSuiteMutation.isPending}>
            <Play className="h-4 w-4 mr-2" />
            {runEvalSuiteMutation.isPending ? "Running..." : "Run Suite"}
          </Button>
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <Target className="h-4 w-4" />
            {suite.tasks.length} tasks
          </span>
          <span className="flex items-center gap-1">
            Gate: {formatPercentage(suite.gate_threshold)}
          </span>
          {suite.last_run_at && (
            <span className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              Last run {formatTimeAgo(suite.last_run_at)}
            </span>
          )}
          {suite.last_run_status && (
            <Badge
              variant="secondary"
              className={cn(
                "text-xs",
                suite.last_run_status === "passed"
                  ? "bg-green-500/20 text-green-400"
                  : suite.last_run_status === "failed"
                  ? "bg-red-500/20 text-red-400"
                  : ""
              )}
            >
              {suite.last_run_status === "passed" ? "Passed" : "Failed"}
              {suite.last_run_score !== undefined &&
                ` (${formatPercentage(suite.last_run_score)})`}
            </Badge>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <Tabs defaultValue="tasks">
          <TabsList>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="scorers">Scorers</TabsTrigger>
            <TabsTrigger value="history">Run History</TabsTrigger>
          </TabsList>

          {/* Tasks Tab */}
          <TabsContent value="tasks" className="mt-6">
            <Card>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead className="text-right">Timeout</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suite.tasks.map((task, index) => (
                    <TableRow key={task.id}>
                      <TableCell className="text-muted-foreground">
                        {index + 1}
                      </TableCell>
                      <TableCell className="font-medium">{task.name}</TableCell>
                      <TableCell className="text-muted-foreground max-w-md truncate">
                        {task.description || "-"}
                      </TableCell>
                      <TableCell>
                        {task.tags && task.tags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {task.tags.map((tag) => (
                              <Badge
                                key={tag}
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {task.timeout_ms
                          ? formatDuration(task.timeout_ms)
                          : "Default"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          </TabsContent>

          {/* Scorers Tab */}
          <TabsContent value="scorers" className="mt-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {suite.scorers.map((scorer) => (
                <Card key={scorer.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-medium">
                        {scorer.name}
                      </CardTitle>
                      <Badge variant="outline" className="text-xs">
                        {scorer.type}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Weight</span>
                        <span className="font-medium">{scorer.weight}x</span>
                      </div>
                      {scorer.threshold !== undefined && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Threshold
                          </span>
                          <span className="font-medium">
                            {formatPercentage(scorer.threshold)}
                          </span>
                        </div>
                      )}
                      {scorer.config &&
                        Object.keys(scorer.config).length > 0 && (
                          <div className="pt-2 border-t border-border/50">
                            <div className="text-xs text-muted-foreground mb-1">
                              Configuration
                            </div>
                            <pre className="text-[10px] font-mono text-muted-foreground bg-muted/50 p-2 rounded overflow-x-auto">
                              {JSON.stringify(scorer.config, null, 2)}
                            </pre>
                          </div>
                        )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          {/* Run History Tab */}
          <TabsContent value="history" className="mt-6">
            {runsLoading ? (
              <Card>
                <CardContent className="p-6">
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-12 bg-muted/50 rounded animate-pulse"
                      />
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : runs.length === 0 ? (
              <EmptyState
                icon={Clock}
                title="No run history"
                description="Run this suite to see results here."
                variant="card"
                action={
                  <Button onClick={handleRunSuite}>
                    <Play className="h-4 w-4 mr-2" />
                    Run Suite
                  </Button>
                }
              />
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Run ID</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Gate</TableHead>
                      <TableHead className="text-right">Score</TableHead>
                      <TableHead className="text-right">
                        Tasks (P/F/E)
                      </TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                      <TableHead className="text-right">When</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => {
                      const statusConfig = runStatusConfig[run.status];
                      const gateConfig = run.gate_status
                        ? gateStatusConfig[run.gate_status]
                        : null;
                      const GateIcon = gateConfig?.icon;

                      return (
                        <TableRow
                          key={run.id}
                          className="cursor-pointer hover:bg-muted/50"
                        >
                          <TableCell>
                            <Link
                              href={`/evals/runs/${run.id}`}
                              className="font-mono text-xs hover:underline"
                            >
                              {run.id.slice(0, 12)}...
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">
                              {run.agent_version}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="secondary"
                              className={cn("text-xs", statusConfig.className)}
                            >
                              {statusConfig.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {gateConfig && GateIcon && (
                              <div className="flex items-center gap-1.5">
                                <GateIcon
                                  className={cn("h-4 w-4", gateConfig.className)}
                                />
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <span
                              className={cn(
                                "font-medium",
                                run.score >= run.gate_threshold
                                  ? "text-green-400"
                                  : "text-red-400"
                              )}
                            >
                              {formatPercentage(run.score)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs">
                            <span className="text-green-400">
                              {run.passed_tasks}
                            </span>
                            /
                            <span className="text-red-400">
                              {run.failed_tasks}
                            </span>
                            /
                            <span className="text-yellow-400">
                              {run.error_tasks}
                            </span>
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatDuration(run.total_duration_ms)}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {formatTimeAgo(run.created_at)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function SuiteDetailSkeleton() {
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
        <Skeleton className="h-10 w-28" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    </div>
  );
}
