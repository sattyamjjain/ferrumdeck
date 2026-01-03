"use client";

import Link from "next/link";
import { FlaskConical, Play, Eye, Clock, Target, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatTimeAgo, formatPercentage } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { EvalSuiteSummary, EvalGateStatus } from "@/types/eval";

interface SuiteCardProps {
  suite: EvalSuiteSummary;
  onRunSuite?: (suiteId: string) => void;
  isRunning?: boolean;
}

const gateStatusConfig: Record<EvalGateStatus, { label: string; className: string; icon: typeof CheckCircle2 }> = {
  passed: {
    label: "Passed",
    className: "bg-green-500/20 text-green-400 border-green-500/30",
    icon: CheckCircle2,
  },
  failed: {
    label: "Failed",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
    icon: XCircle,
  },
  skipped: {
    label: "Skipped",
    className: "bg-secondary text-secondary-foreground",
    icon: Target,
  },
};

export function SuiteCard({ suite, onRunSuite, isRunning }: SuiteCardProps) {
  const gateStatus = suite.last_run_status
    ? gateStatusConfig[suite.last_run_status]
    : null;
  const GateIcon = gateStatus?.icon;

  return (
    <Card className="hover:bg-card/80 transition-colors h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="p-2 rounded-lg bg-accent-purple/10 flex-shrink-0">
              <FlaskConical className="h-4 w-4 text-accent-purple" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base truncate">{suite.name}</CardTitle>
              {suite.description && (
                <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                  {suite.description}
                </p>
              )}
            </div>
          </div>
          {gateStatus && GateIcon && (
            <Badge
              variant="secondary"
              className={cn("text-xs flex-shrink-0 flex items-center gap-1", gateStatus.className)}
            >
              <GateIcon className="h-3 w-3" />
              {gateStatus.label}
            </Badge>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4 flex-1 flex flex-col">
        {/* Suite info */}
        <div className="space-y-2 flex-1">
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Target className="h-3 w-3" />
              {suite.task_count} tasks
            </span>
            <span className="flex items-center gap-1">
              Gate: {formatPercentage(suite.gate_threshold)}
            </span>
          </div>

          {/* Scorers */}
          {suite.scorer_names.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suite.scorer_names.slice(0, 3).map((scorer) => (
                <Badge
                  key={scorer}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                >
                  {scorer}
                </Badge>
              ))}
              {suite.scorer_names.length > 3 && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 text-muted-foreground"
                >
                  +{suite.scorer_names.length - 3}
                </Badge>
              )}
            </div>
          )}

          {/* Last run info */}
          {suite.last_run_at && suite.last_run_score !== undefined && (
            <div className="flex items-center gap-2 text-xs">
              <Clock className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">
                {formatTimeAgo(suite.last_run_at)}
              </span>
              <span className="text-muted-foreground">-</span>
              <span
                className={cn(
                  "font-medium",
                  suite.last_run_status === "passed"
                    ? "text-green-400"
                    : suite.last_run_status === "failed"
                    ? "text-red-400"
                    : "text-muted-foreground"
                )}
              >
                {formatPercentage(suite.last_run_score)}
              </span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          <Button
            size="sm"
            variant="default"
            className="flex-1 h-8"
            onClick={(e) => {
              e.preventDefault();
              onRunSuite?.(suite.id);
            }}
            disabled={isRunning}
          >
            <Play className="h-3 w-3 mr-1" />
            {isRunning ? "Running..." : "Run"}
          </Button>
          <Button size="sm" variant="outline" className="h-8" asChild>
            <Link href={`/evals/suites/${suite.id}`}>
              <Eye className="h-3 w-3 mr-1" />
              View
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function SuiteCardSkeleton() {
  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-lg bg-muted animate-pulse" />
            <div className="space-y-1">
              <div className="h-4 w-32 bg-muted rounded animate-pulse" />
              <div className="h-3 w-24 bg-muted rounded animate-pulse" />
            </div>
          </div>
          <div className="h-5 w-16 bg-muted rounded animate-pulse" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="h-3 w-20 bg-muted rounded animate-pulse" />
          <div className="flex gap-1">
            <div className="h-4 w-16 bg-muted rounded animate-pulse" />
            <div className="h-4 w-16 bg-muted rounded animate-pulse" />
          </div>
        </div>
        <div className="flex gap-2 pt-2 border-t border-border/50">
          <div className="h-8 flex-1 bg-muted rounded animate-pulse" />
          <div className="h-8 w-16 bg-muted rounded animate-pulse" />
        </div>
      </CardContent>
    </Card>
  );
}
