"use client";

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
  Copy,
  Timer,
  Zap,
} from "lucide-react";
import { useState, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JsonViewer } from "@/components/shared/json-viewer";
import {
  cn,
  formatDuration,
  formatDateTime,
  formatTokens,
  truncateId,
  copyToClipboard,
} from "@/lib/utils";
import { toast } from "sonner";
import type { Step, StepType, StepStatus } from "@/types/run";

const stepTypeConfig: Record<
  StepType,
  { icon: typeof Brain; label: string; color: string }
> = {
  llm: { icon: Brain, label: "LLM Call", color: "text-purple-400" },
  tool: { icon: Wrench, label: "Tool Call", color: "text-blue-400" },
  retrieval: { icon: Database, label: "Retrieval", color: "text-cyan-400" },
  human: { icon: User, label: "Human Input", color: "text-orange-400" },
  approval: { icon: Shield, label: "Approval", color: "text-yellow-400" },
};

const stepStatusConfig: Record<
  StepStatus,
  { icon: typeof CheckCircle; label: string; className: string }
> = {
  pending: {
    icon: Clock,
    label: "Pending",
    className: "bg-secondary text-secondary-foreground",
  },
  running: {
    icon: Loader2,
    label: "Running",
    className: "bg-yellow-500/20 text-yellow-400",
  },
  waiting_approval: {
    icon: Shield,
    label: "Waiting Approval",
    className: "bg-amber-500/20 text-amber-400",
  },
  completed: {
    icon: CheckCircle,
    label: "Completed",
    className: "bg-green-500/20 text-green-400",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "bg-red-500/20 text-red-400",
  },
  skipped: {
    icon: Clock,
    label: "Skipped",
    className: "bg-secondary text-secondary-foreground",
  },
};

interface StepDetailPanelProps {
  step: Step | null;
  className?: string;
}

export function StepDetailPanel({ step, className }: StepDetailPanelProps) {
  const [activeTab, setActiveTab] = useState("input");
  const [currentTime, setCurrentTime] = useState(0);

  const handleCopyId = useCallback(async () => {
    if (!step) return;
    const success = await copyToClipboard(step.id);
    if (success) {
      toast.success("Step ID copied");
    }
  }, [step]);

  // Update current time for running steps
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentTime(Date.now());

    if (step?.status === "running" && step.started_at && !step.completed_at) {
      const interval = setInterval(() => {
        setCurrentTime(Date.now());
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [step?.status, step?.started_at, step?.completed_at]);

  if (!step) {
    return (
      <Card className={cn("flex items-center justify-center", className)}>
        <CardContent className="py-12 text-center text-muted-foreground">
          <Wrench className="h-8 w-8 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Select a step to view details</p>
        </CardContent>
      </Card>
    );
  }

  const typeConfig = stepTypeConfig[step.step_type] || stepTypeConfig.tool;
  const statusConfig = stepStatusConfig[step.status] || stepStatusConfig.pending;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  const stepDuration =
    step.started_at && step.completed_at
      ? new Date(step.completed_at).getTime() -
        new Date(step.started_at).getTime()
      : step.started_at && currentTime > 0
      ? currentTime - new Date(step.started_at).getTime()
      : 0;

  return (
    <Card className={cn("flex flex-col", className)}>
      {/* Header */}
      <CardHeader className="pb-3 border-b">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <TypeIcon className={cn("h-5 w-5", typeConfig.color)} />
              <CardTitle className="text-base font-medium">
                {step.tool_name || step.model || typeConfig.label}
              </CardTitle>
              {step.step_number && (
                <span className="text-xs text-muted-foreground font-mono">
                  #{step.step_number}
                </span>
              )}
            </div>
            <button
              onClick={handleCopyId}
              className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
            >
              {truncateId(step.id)}
            </button>
          </div>

          <Badge
            variant="secondary"
            className={cn("shrink-0", statusConfig.className)}
          >
            <StatusIcon
              className={cn(
                "h-3 w-3 mr-1",
                step.status === "running" && "animate-spin"
              )}
            />
            {statusConfig.label}
          </Badge>
        </div>

        {/* Metrics row */}
        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <Timer className="h-3.5 w-3.5" />
            <span>{formatDuration(stepDuration)}</span>
          </div>
          {(step.input_tokens || step.output_tokens) && (
            <div className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" />
              <span>
                {formatTokens(step.input_tokens || 0)} in /{" "}
                {formatTokens(step.output_tokens || 0)} out
              </span>
            </div>
          )}
          {step.model && (
            <div className="flex items-center gap-1 font-mono">
              <Brain className="h-3.5 w-3.5" />
              <span>{step.model}</span>
            </div>
          )}
          {step.tool_version && (
            <span className="font-mono">v{step.tool_version}</span>
          )}
        </div>
      </CardHeader>

      {/* Content tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 flex flex-col"
      >
        <div className="border-b px-4">
          <TabsList className="h-9 p-0 bg-transparent">
            <TabsTrigger value="input" className="text-xs">
              Input
            </TabsTrigger>
            <TabsTrigger value="output" className="text-xs">
              Output
            </TabsTrigger>
            {step.error && (
              <TabsTrigger value="error" className="text-xs text-red-400">
                Error
              </TabsTrigger>
            )}
            <TabsTrigger value="timing" className="text-xs">
              Timing
            </TabsTrigger>
          </TabsList>
        </div>

        <ScrollArea className="flex-1 p-4">
          <TabsContent value="input" className="mt-0">
            {step.input && Object.keys(step.input).length > 0 ? (
              <JsonViewer data={step.input} maxHeight={300} />
            ) : (
              <EmptyContent message="No input data" />
            )}
          </TabsContent>

          <TabsContent value="output" className="mt-0">
            {step.output ? (
              typeof step.output === "string" ? (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      Text Output
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => {
                        copyToClipboard(step.output as string);
                        toast.success("Output copied");
                      }}
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <pre className="bg-background-tertiary rounded-md p-4 text-sm overflow-auto max-h-64 whitespace-pre-wrap font-mono">
                    {step.output}
                  </pre>
                </div>
              ) : (
                <JsonViewer data={step.output} maxHeight={300} />
              )
            ) : (
              <EmptyContent
                message={
                  step.status === "running"
                    ? "Output will appear when step completes"
                    : "No output data"
                }
              />
            )}
          </TabsContent>

          <TabsContent value="error" className="mt-0">
            {step.error ? (
              <div className="space-y-3">
                <div className="p-3 rounded-md bg-red-500/10 border border-red-500/20">
                  <p className="text-sm text-red-400 font-medium">
                    {typeof step.error === "object" &&
                    "message" in (step.error as Record<string, unknown>)
                      ? String((step.error as Record<string, unknown>).message)
                      : "Step execution failed"}
                  </p>
                </div>
                <JsonViewer data={step.error} maxHeight={250} />
              </div>
            ) : (
              <EmptyContent message="No error information" />
            )}
          </TabsContent>

          <TabsContent value="timing" className="mt-0">
            <div className="space-y-4">
              <TimingRow label="Created" time={step.created_at} />
              {step.started_at && (
                <TimingRow label="Started" time={step.started_at} />
              )}
              {step.completed_at && (
                <TimingRow label="Completed" time={step.completed_at} />
              )}

              {step.started_at && (
                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Total Duration</span>
                    <span className="font-mono font-medium">
                      {formatDuration(stepDuration)}
                    </span>
                  </div>
                </div>
              )}

              {step.span_id && (
                <div className="pt-3 border-t">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Trace Span ID</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs">
                        {truncateId(step.span_id)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-5 w-5 p-0"
                        onClick={() => {
                          copyToClipboard(step.span_id!);
                          toast.success("Span ID copied");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </ScrollArea>
      </Tabs>
    </Card>
  );
}

function TimingRow({ label, time }: { label: string; time: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{formatDateTime(time)}</span>
    </div>
  );
}

function EmptyContent({ message }: { message: string }) {
  return (
    <div className="py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
