"use client";

import { Brain, Wrench, Database, User, Shield, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { JsonViewer } from "@/components/shared/json-viewer";
import type { Step, StepType, StepStatus } from "@/types/run";

const stepTypeConfig: Record<StepType, { icon: typeof Brain; label: string; color: string }> = {
  llm: { icon: Brain, label: "LLM", color: "text-purple-400" },
  tool: { icon: Wrench, label: "Tool", color: "text-blue-400" },
  retrieval: { icon: Database, label: "Retrieval", color: "text-cyan-400" },
  human: { icon: User, label: "Human", color: "text-orange-400" },
  approval: { icon: Shield, label: "Approval", color: "text-yellow-400" },
};

const stepStatusConfig: Record<StepStatus, { icon: typeof CheckCircle; label: string; className: string }> = {
  pending: { icon: Clock, label: "Pending", className: "bg-secondary text-secondary-foreground" },
  running: { icon: Loader2, label: "Running", className: "bg-yellow-500/20 text-yellow-400" },
  waiting_approval: { icon: Shield, label: "Waiting", className: "bg-amber-500/20 text-amber-400" },
  completed: { icon: CheckCircle, label: "Completed", className: "bg-green-500/20 text-green-400" },
  failed: { icon: XCircle, label: "Failed", className: "bg-red-500/20 text-red-400" },
  skipped: { icon: Clock, label: "Skipped", className: "bg-secondary text-secondary-foreground" },
};

interface StepTimelineProps {
  steps: Step[];
}

export function StepTimeline({ steps }: StepTimelineProps) {
  const sortedSteps = [...steps].sort((a, b) => {
    if (a.step_number && b.step_number) return a.step_number - b.step_number;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-6 top-0 bottom-0 w-px bg-border" />

      <div className="space-y-4">
        {sortedSteps.map((step) => (
          <StepCard key={step.id} step={step} />
        ))}
      </div>
    </div>
  );
}

interface StepCardProps {
  step: Step;
}

function StepCard({ step }: StepCardProps) {
  const typeConfig = stepTypeConfig[step.step_type] || stepTypeConfig.tool;
  const statusConfig = stepStatusConfig[step.status] || stepStatusConfig.pending;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  return (
    <div className="relative pl-14">
      {/* Timeline node */}
      <div
        className={cn(
          "absolute left-4 w-5 h-5 rounded-full flex items-center justify-center bg-background-secondary border-2",
          step.status === "completed" ? "border-green-500" :
          step.status === "failed" ? "border-red-500" :
          step.status === "running" ? "border-yellow-500" : "border-border"
        )}
      >
        <TypeIcon className={cn("h-3 w-3", typeConfig.color)} />
      </div>

      <Card className={cn(
        "border-l-2",
        step.status === "completed" ? "border-l-green-500" :
        step.status === "failed" ? "border-l-red-500" :
        step.status === "running" ? "border-l-yellow-500" : "border-l-border"
      )}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TypeIcon className={cn("h-4 w-4", typeConfig.color)} />
              {step.tool_name || step.model || typeConfig.label}
              {step.step_number && (
                <span className="text-xs text-muted-foreground">#{step.step_number}</span>
              )}
            </CardTitle>
            <Badge variant="secondary" className={cn("text-xs", statusConfig.className)}>
              <StatusIcon className={cn("h-3 w-3 mr-1", step.status === "running" && "animate-spin")} />
              {statusConfig.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Token usage */}
          {(step.input_tokens || step.output_tokens) && (
            <div className="flex gap-4 text-xs text-muted-foreground">
              {step.input_tokens && <span>Input: {step.input_tokens} tokens</span>}
              {step.output_tokens && <span>Output: {step.output_tokens} tokens</span>}
            </div>
          )}

          {/* Input */}
          {step.input && Object.keys(step.input).length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Input</p>
              <JsonViewer data={step.input} collapsed />
            </div>
          )}

          {/* Output */}
          {step.output && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Output</p>
              {typeof step.output === "string" ? (
                <pre className="bg-background-tertiary rounded-md p-3 text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                  {step.output}
                </pre>
              ) : (
                <JsonViewer data={step.output} collapsed />
              )}
            </div>
          )}

          {/* Error */}
          {step.error && (
            <div>
              <p className="text-xs text-red-400 mb-1">Error</p>
              <pre className="bg-red-500/10 border border-red-500/20 rounded-md p-3 text-xs text-red-400 overflow-auto max-h-32">
                {typeof step.error === "string" ? step.error : JSON.stringify(step.error, null, 2)}
              </pre>
            </div>
          )}

          {/* Timing */}
          {step.started_at && (
            <div className="text-xs text-muted-foreground">
              Started: {new Date(step.started_at).toLocaleString()}
              {step.completed_at && (
                <span className="ml-4">
                  Duration: {Math.round((new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()) / 1000)}s
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
