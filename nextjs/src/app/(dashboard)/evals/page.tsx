"use client";

import { useState } from "react";
import { useIsMounted } from "@/hooks/use-is-mounted";
import Link from "next/link";
import {
  FlaskConical,
  Play,
  Clock,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  AlertCircle,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SuiteCard, SuiteCardSkeleton } from "@/components/evals/suite-card";
import { EmptyState } from "@/components/shared/empty-state";
import {
  useEvalSuites,
  useEvalRuns,
  useRunEvalSuite,
  useRegressionReport,
} from "@/hooks/use-evals";
import {
  formatTimeAgo,
  formatPercentage,
  formatDuration,
  formatCost,
  cn,
} from "@/lib/utils";
import { toast } from "sonner";
import type { EvalRunStatus, EvalGateStatus, RegressionStatus } from "@/types/eval";

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

export default function EvalsPage() {
  // Hydration fix - ensure client-only rendering for Radix components
  const mounted = useIsMounted();

  const [selectedTab, setSelectedTab] = useState("suites");
  const [runSuiteDialogOpen, setRunSuiteDialogOpen] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>("");
  const [runningSuiteId, setRunningSuiteId] = useState<string | null>(null);

  const { data: suitesData, isLoading: suitesLoading } = useEvalSuites();
  const { data: runsData, isLoading: runsLoading } = useEvalRuns({ limit: 20 });
  const { data: regressionData, isLoading: regressionLoading } = useRegressionReport();
  const runEvalSuiteMutation = useRunEvalSuite();

  const suites = suitesData?.suites || [];
  const runs = runsData?.runs || [];

  const handleRunSuite = async (suiteId: string) => {
    setRunningSuiteId(suiteId);
    try {
      const result = await runEvalSuiteMutation.mutateAsync({
        suite_id: suiteId,
        compare_to_baseline: true,
      });
      toast.success("Evaluation started", {
        description: `Eval run ${result.eval_run_id} has been queued.`,
      });
      setSelectedTab("runs");
    } catch (error) {
      toast.error("Failed to start evaluation", {
        description: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      setRunningSuiteId(null);
      setRunSuiteDialogOpen(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4">
        <div className="relative">
          <div className="absolute inset-0 bg-gradient-to-r from-accent-purple/5 via-transparent to-transparent rounded-xl -z-10" />
          <div className="flex items-center justify-between pb-2">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-accent-purple/10 border border-accent-purple/20">
                <FlaskConical className="h-5 w-5 text-accent-purple" />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight">
                  Evaluations
                </h1>
                <p className="text-sm text-muted-foreground">
                  Test agent performance with automated evaluation suites
                </p>
              </div>
            </div>

            {mounted && (
              <Dialog open={runSuiteDialogOpen} onOpenChange={setRunSuiteDialogOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Play className="h-4 w-4 mr-2" />
                    Run Suite
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Run Evaluation Suite</DialogTitle>
                    <DialogDescription>
                      Select a suite to run. Results will be compared against the
                      baseline version.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="py-4">
                    <Select
                      value={selectedSuiteId}
                      onValueChange={setSelectedSuiteId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select a suite..." />
                      </SelectTrigger>
                      <SelectContent>
                        {suites.map((suite) => (
                          <SelectItem key={suite.id} value={suite.id}>
                            {suite.name} ({suite.task_count} tasks)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setRunSuiteDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => handleRunSuite(selectedSuiteId)}
                      disabled={!selectedSuiteId || runEvalSuiteMutation.isPending}
                    >
                      {runEvalSuiteMutation.isPending ? "Starting..." : "Run Suite"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-h-0 px-6 pb-6">
        <Tabs value={selectedTab} onValueChange={setSelectedTab}>
          <TabsList>
            <TabsTrigger value="suites">Suites</TabsTrigger>
            <TabsTrigger value="runs">Recent Runs</TabsTrigger>
            <TabsTrigger value="regression">Regression Report</TabsTrigger>
          </TabsList>

          {/* Suites Tab */}
          <TabsContent value="suites" className="mt-6">
            {suitesLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <SuiteCardSkeleton key={i} />
                ))}
              </div>
            ) : suites.length === 0 ? (
              <EmptyState
                icon={FlaskConical}
                title="No evaluation suites"
                description="Create your first evaluation suite to start testing agent performance."
                variant="card"
              />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {suites.map((suite) => (
                  <SuiteCard
                    key={suite.id}
                    suite={suite}
                    onRunSuite={handleRunSuite}
                    isRunning={runningSuiteId === suite.id}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Recent Runs Tab */}
          <TabsContent value="runs" className="mt-6">
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
                title="No evaluation runs"
                description="Run an evaluation suite to see results here."
                variant="card"
              />
            ) : (
              <Card>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Suite</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Gate</TableHead>
                      <TableHead className="text-right">Score</TableHead>
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
                              className="font-medium hover:underline"
                            >
                              {run.suite_name}
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
                                <span className={gateConfig.className}>
                                  {gateConfig.label}
                                </span>
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
                            <span className="text-muted-foreground text-xs ml-1">
                              / {formatPercentage(run.gate_threshold)}
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

          {/* Regression Report Tab */}
          <TabsContent value="regression" className="mt-6">
            {regressionLoading ? (
              <div className="space-y-4">
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
              </div>
            ) : !regressionData ? (
              <EmptyState
                icon={AlertCircle}
                title="No regression data"
                description="Run evaluations to generate regression reports."
                variant="card"
              />
            ) : (
              <div className="space-y-6">
                {/* Summary Stats */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground mb-1">
                        Suites Analyzed
                      </div>
                      <div className="text-2xl font-semibold">
                        {regressionData.suites_analyzed}
                      </div>
                    </CardContent>
                  </Card>
                  <Card
                    className={cn(
                      regressionData.total_regressions > 0 && "border-red-500/30"
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground mb-1">
                        Total Regressions
                      </div>
                      <div
                        className={cn(
                          "text-2xl font-semibold flex items-center gap-2",
                          regressionData.total_regressions > 0 && "text-red-400"
                        )}
                      >
                        {regressionData.total_regressions}
                        {regressionData.total_regressions > 0 && (
                          <ArrowDownRight className="h-5 w-5" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  <Card
                    className={cn(
                      regressionData.total_improvements > 0 &&
                        "border-green-500/30"
                    )}
                  >
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground mb-1">
                        Total Improvements
                      </div>
                      <div
                        className={cn(
                          "text-2xl font-semibold flex items-center gap-2",
                          regressionData.total_improvements > 0 &&
                            "text-green-400"
                        )}
                      >
                        {regressionData.total_improvements}
                        {regressionData.total_improvements > 0 && (
                          <ArrowUpRight className="h-5 w-5" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4">
                      <div className="text-xs text-muted-foreground mb-1">
                        Cost Delta
                      </div>
                      <div
                        className={cn(
                          "text-2xl font-semibold",
                          regressionData.overall_cost_delta_cents > 0
                            ? "text-red-400"
                            : regressionData.overall_cost_delta_cents < 0
                            ? "text-green-400"
                            : ""
                        )}
                      >
                        {regressionData.overall_cost_delta_cents > 0 ? "+" : ""}
                        {formatCost(regressionData.overall_cost_delta_cents)}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Regressions by Suite */}
                {regressionData.regressions_by_suite.length > 0 ? (
                  <div className="space-y-4">
                    {regressionData.regressions_by_suite.map((suite) => (
                      <Card key={suite.suite_id}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base font-medium">
                              {suite.suite_name}
                            </CardTitle>
                            <div className="flex items-center gap-4 text-sm">
                              <div>
                                <span className="text-muted-foreground">
                                  {suite.baseline_version}
                                </span>
                                <span className="mx-2 text-muted-foreground">
                                  to
                                </span>
                                <span className="text-muted-foreground">
                                  {suite.current_version}
                                </span>
                              </div>
                              <div
                                className={cn(
                                  "font-medium",
                                  suite.score_delta > 0
                                    ? "text-green-400"
                                    : suite.score_delta < 0
                                    ? "text-red-400"
                                    : "text-muted-foreground"
                                )}
                              >
                                {suite.score_delta > 0 ? "+" : ""}
                                {formatPercentage(suite.score_delta)}
                              </div>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {suite.regressed_tasks.length > 0 && (
                            <div className="mb-4">
                              <div className="text-sm font-medium text-red-400 mb-2">
                                Regressed Tasks ({suite.regressed_tasks.length})
                              </div>
                              <div className="space-y-2">
                                {suite.regressed_tasks.map((task) => (
                                  <RegressionTaskRow
                                    key={task.task_id}
                                    task={task}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {suite.improved_tasks.length > 0 && (
                            <div>
                              <div className="text-sm font-medium text-green-400 mb-2">
                                Improved Tasks ({suite.improved_tasks.length})
                              </div>
                              <div className="space-y-2">
                                {suite.improved_tasks.map((task) => (
                                  <RegressionTaskRow
                                    key={task.task_id}
                                    task={task}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No regressions detected"
                    description="All suites are performing at or above baseline."
                    variant="card"
                  />
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

interface RegressionTaskRowProps {
  task: {
    task_id: string;
    task_name: string;
    status: RegressionStatus;
    baseline_score: number;
    current_score: number;
    score_delta: number;
    baseline_cost_cents: number;
    current_cost_cents: number;
    cost_delta_cents: number;
  };
}

function RegressionTaskRow({ task }: RegressionTaskRowProps) {
  const isRegression = task.status === "regressed";

  return (
    <div
      className={cn(
        "flex items-center justify-between p-2 rounded-lg border",
        isRegression
          ? "bg-red-500/10 border-red-500/30"
          : "bg-green-500/10 border-green-500/30"
      )}
    >
      <div className="flex items-center gap-2">
        {isRegression ? (
          <ArrowDownRight className="h-4 w-4 text-red-400" />
        ) : (
          <ArrowUpRight className="h-4 w-4 text-green-400" />
        )}
        <span className="text-sm font-medium">{task.task_name}</span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">
            {formatPercentage(task.baseline_score)}
          </span>
          <span className="mx-1 text-muted-foreground">to</span>
          <span
            className={cn(
              "font-medium",
              isRegression ? "text-red-400" : "text-green-400"
            )}
          >
            {formatPercentage(task.current_score)}
          </span>
        </div>
        <div
          className={cn(
            "font-medium",
            isRegression ? "text-red-400" : "text-green-400"
          )}
        >
          {task.score_delta > 0 ? "+" : ""}
          {formatPercentage(task.score_delta)}
        </div>
      </div>
    </div>
  );
}
