"use client";

import { useState, useMemo, useEffect } from "react";
import {
  Brain,
  Wrench,
  Database,
  User,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Zap,
  AlertCircle,
} from "lucide-react";
import { cn, formatDuration } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/shared/json-viewer";
import type { Step, StepType, StepStatus } from "@/types/run";

// Mission Control step type configuration
const stepTypeConfig: Record<
  StepType,
  {
    icon: typeof Brain;
    label: string;
    gradient: string;
    color: string;
    bgColor: string;
    borderColor: string;
    glowColor: string;
  }
> = {
  llm: {
    icon: Brain,
    label: "LLM",
    gradient: "from-purple-500 to-violet-600",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    glowColor: "shadow-purple-500/20",
  },
  tool: {
    icon: Wrench,
    label: "Tool",
    gradient: "from-blue-500 to-cyan-500",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    glowColor: "shadow-blue-500/20",
  },
  retrieval: {
    icon: Database,
    label: "Retrieval",
    gradient: "from-cyan-500 to-teal-500",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    glowColor: "shadow-cyan-500/20",
  },
  human: {
    icon: User,
    label: "Human",
    gradient: "from-orange-500 to-amber-500",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    glowColor: "shadow-orange-500/20",
  },
  approval: {
    icon: Shield,
    label: "Approval",
    gradient: "from-yellow-500 to-amber-500",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/30",
    glowColor: "shadow-yellow-500/20",
  },
};

// Mission Control status configuration
const stepStatusConfig: Record<
  StepStatus,
  {
    icon: typeof CheckCircle;
    label: string;
    color: string;
    bgColor: string;
    borderColor: string;
    pulseColor?: string;
  }
> = {
  pending: {
    icon: Clock,
    label: "Pending",
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
  },
  running: {
    icon: Loader2,
    label: "Running",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/10",
    borderColor: "border-yellow-500/50",
    pulseColor: "shadow-yellow-500/40",
  },
  waiting_approval: {
    icon: Shield,
    label: "Awaiting Approval",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/50",
    pulseColor: "shadow-amber-500/40",
  },
  completed: {
    icon: CheckCircle,
    label: "Completed",
    color: "text-green-400",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
  },
  skipped: {
    icon: Clock,
    label: "Skipped",
    color: "text-slate-400",
    bgColor: "bg-slate-500/10",
    borderColor: "border-slate-500/30",
  },
};

interface StepTimelineProps {
  steps: Step[];
}

export function StepTimeline({ steps }: StepTimelineProps) {
  const sortedSteps = useMemo(() => {
    return [...steps].sort((a, b) => {
      if (a.step_number && b.step_number) return a.step_number - b.step_number;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });
  }, [steps]);

  // Calculate stats
  const stats = useMemo(() => {
    const completed = steps.filter((s) => s.status === "completed").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const running = steps.filter((s) => s.status === "running").length;
    const totalTokens = steps.reduce(
      (acc, s) => acc + (s.input_tokens || 0) + (s.output_tokens || 0),
      0
    );
    return { completed, failed, running, total: steps.length, totalTokens };
  }, [steps]);

  return (
    <div className="space-y-6">
      {/* Stats Header */}
      <div className="flex items-center gap-6 px-2">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gradient-to-r from-green-400 to-emerald-500" />
          <span className="text-sm text-muted-foreground">
            {stats.completed} completed
          </span>
        </div>
        {stats.running > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-sm text-muted-foreground">
              {stats.running} running
            </span>
          </div>
        )}
        {stats.failed > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <span className="text-sm text-muted-foreground">
              {stats.failed} failed
            </span>
          </div>
        )}
        {stats.totalTokens > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
            <span className="text-sm text-muted-foreground font-mono">
              {stats.totalTokens.toLocaleString()} tokens
            </span>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div className="relative pl-8">
        {/* Gradient timeline line */}
        <div className="absolute left-6 top-0 bottom-0 w-px">
          <div className="absolute inset-0 bg-gradient-to-b from-purple-500/50 via-blue-500/30 to-cyan-500/50" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-background/50 to-transparent" />
        </div>

        <div className="space-y-4">
          {sortedSteps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              stepIndex={index}
              isFirst={index === 0}
              isLast={index === sortedSteps.length - 1}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface StepCardProps {
  step: Step;
  stepIndex: number;
  isFirst: boolean;
  isLast: boolean;
}

function StepCard({ step, stepIndex, isFirst, isLast }: StepCardProps) {
  const [isExpanded, setIsExpanded] = useState(
    step.status === "failed" || step.status === "running"
  );
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const typeConfig = stepTypeConfig[step.step_type] || stepTypeConfig.tool;
  const statusConfig = stepStatusConfig[step.status] || stepStatusConfig.pending;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  // Live duration for running steps
  useEffect(() => {
    if (step.status === "running" && step.started_at) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step.status, step.started_at]);

  const duration =
    step.started_at && step.completed_at
      ? new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()
      : step.started_at
      ? currentTime - new Date(step.started_at).getTime()
      : 0;

  const hasContent = step.input || step.output || step.error;

  return (
    <div
      className={cn(
        "relative",
        "animate-fade-in",
        isFirst && "pt-0",
        isLast && "pb-0"
      )}
      style={{ animationDelay: `${stepIndex * 50}ms` }}
    >
      {/* Timeline node */}
      <div
        className={cn(
          "absolute -left-2 w-8 h-8 rounded-full flex items-center justify-center",
          "border-2 transition-all duration-300",
          statusConfig.borderColor,
          statusConfig.bgColor,
          step.status === "running" && "animate-pulse shadow-lg",
          step.status === "running" && statusConfig.pulseColor
        )}
      >
        <div className={cn("w-6 h-6 rounded-full bg-gradient-to-br flex items-center justify-center", typeConfig.gradient)}>
          <TypeIcon className="h-3.5 w-3.5 text-white" />
        </div>
      </div>

      {/* Card */}
      <div className="pl-10">
        <Card
          className={cn(
            "overflow-hidden transition-all duration-300 cursor-pointer group",
            "border hover:shadow-lg",
            step.status === "completed" && "border-green-500/20 hover:border-green-500/40",
            step.status === "failed" && "border-red-500/30 hover:border-red-500/50",
            step.status === "running" && "border-yellow-500/30 hover:border-yellow-500/50",
            step.status === "waiting_approval" && "border-amber-500/30 hover:border-amber-500/50"
          )}
          onClick={() => hasContent && setIsExpanded(!isExpanded)}
        >
          {/* Header */}
          <CardHeader className="py-3 px-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* Expand/collapse indicator */}
                {hasContent && (
                  <button className="p-0.5 rounded hover:bg-background-tertiary transition-colors">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                )}

                {/* Step info */}
                <div className="flex items-center gap-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span className={typeConfig.color}>
                      {step.tool_name || step.model || typeConfig.label}
                    </span>
                    {step.step_number && (
                      <Badge
                        variant="outline"
                        className="text-[10px] font-mono px-1.5 py-0 h-4"
                      >
                        #{step.step_number}
                      </Badge>
                    )}
                  </CardTitle>
                </div>

                {/* Metrics pills */}
                <div className="flex items-center gap-2 ml-2">
                  {duration > 0 && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background-tertiary text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span className="font-mono">{formatDuration(duration)}</span>
                    </div>
                  )}
                  {(step.input_tokens || step.output_tokens) && (
                    <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-background-tertiary text-xs text-muted-foreground">
                      <Sparkles className="h-3 w-3 text-purple-400" />
                      <span className="font-mono">
                        {(step.input_tokens || 0) + (step.output_tokens || 0)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Status badge */}
              <Badge
                variant="outline"
                className={cn(
                  "gap-1.5 font-medium",
                  statusConfig.color,
                  statusConfig.bgColor,
                  statusConfig.borderColor
                )}
              >
                <StatusIcon
                  className={cn(
                    "h-3.5 w-3.5",
                    step.status === "running" && "animate-spin"
                  )}
                />
                {statusConfig.label}
              </Badge>
            </div>
          </CardHeader>

          {/* Expandable content */}
          {isExpanded && hasContent && (
            <CardContent className="px-4 pb-4 pt-0 space-y-4 border-t border-border/50">
              {/* Token breakdown for LLM calls */}
              {step.step_type === "llm" && (step.input_tokens || step.output_tokens) && (
                <div className="flex gap-4 pt-3">
                  {step.input_tokens && (
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      <span className="text-xs text-muted-foreground">
                        Input: <span className="font-mono text-foreground">{step.input_tokens.toLocaleString()}</span>
                      </span>
                    </div>
                  )}
                  {step.output_tokens && (
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-xs text-muted-foreground">
                        Output: <span className="font-mono text-foreground">{step.output_tokens.toLocaleString()}</span>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Input */}
              {step.input && Object.keys(step.input).length > 0 && (
                <div className="pt-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Zap className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Input
                    </span>
                  </div>
                  <div className="rounded-lg bg-background-tertiary/50 border border-border/50 overflow-hidden">
                    <JsonViewer data={step.input} collapsed />
                  </div>
                </div>
              )}

              {/* Output */}
              {step.output && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Output
                    </span>
                  </div>
                  {typeof step.output === "string" ? (
                    <div className="rounded-lg bg-background-tertiary/50 border border-border/50 overflow-hidden">
                      <pre className="p-4 text-sm overflow-auto max-h-64 whitespace-pre-wrap font-mono text-foreground/90">
                        {step.output}
                      </pre>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-background-tertiary/50 border border-border/50 overflow-hidden">
                      <JsonViewer data={step.output} collapsed />
                    </div>
                  )}
                </div>
              )}

              {/* Error */}
              {step.error && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                    <span className="text-xs font-medium text-red-400 uppercase tracking-wider">
                      Error
                    </span>
                  </div>
                  <div className="rounded-lg bg-red-500/5 border border-red-500/20 overflow-hidden">
                    <pre className="p-4 text-sm text-red-400 overflow-auto max-h-32 whitespace-pre-wrap font-mono">
                      {typeof step.error === "string"
                        ? step.error
                        : JSON.stringify(step.error, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Timing details */}
              {step.started_at && (
                <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground border-t border-border/30">
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3 w-3" />
                    <span>
                      Started{" "}
                      <span className="text-foreground font-mono">
                        {new Date(step.started_at).toLocaleTimeString()}
                      </span>
                    </span>
                  </div>
                  {step.completed_at && (
                    <div className="flex items-center gap-1.5">
                      <CheckCircle className="h-3 w-3 text-green-400" />
                      <span>
                        Completed{" "}
                        <span className="text-foreground font-mono">
                          {new Date(step.completed_at).toLocaleTimeString()}
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          )}
        </Card>
      </div>
    </div>
  );
}
