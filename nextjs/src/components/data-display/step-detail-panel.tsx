"use client";

import {
  Brain,
  Wrench,
  Database,
  User,
  Shield,
  Clock,
  Coins,
  Hash,
  Calendar,
  Timer,
  AlertCircle,
  CheckCircle2,
  Loader2,
  XCircle,
  X,
} from "lucide-react";
import { cn, formatTokens, formatCost } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { JsonViewer } from "@/components/shared/json-viewer";
import type { Step, StepType, StepStatus } from "@/types/run";

// Step type configuration
const STEP_TYPE_CONFIG: Record<
  StepType,
  { icon: typeof Brain; label: string; color: string; bgClass: string }
> = {
  llm: {
    icon: Brain,
    label: "LLM Call",
    color: "#a855f7",
    bgClass: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  },
  tool: {
    icon: Wrench,
    label: "Tool Call",
    color: "#3b82f6",
    bgClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  },
  retrieval: {
    icon: Database,
    label: "Retrieval",
    color: "#06b6d4",
    bgClass: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  },
  human: {
    icon: User,
    label: "Human Input",
    color: "#f97316",
    bgClass: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  },
  approval: {
    icon: Shield,
    label: "Approval",
    color: "#eab308",
    bgClass: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  },
};

// Step status configuration
const STEP_STATUS_CONFIG: Record<
  StepStatus,
  { icon: typeof CheckCircle2; label: string; className: string }
> = {
  pending: {
    icon: Clock,
    label: "Pending",
    className: "bg-muted/50 text-muted-foreground border-border/50",
  },
  running: {
    icon: Loader2,
    label: "Running",
    className: "bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30",
  },
  waiting_approval: {
    icon: Shield,
    label: "Waiting Approval",
    className: "bg-accent-purple/15 text-accent-purple border-accent-purple/30",
  },
  completed: {
    icon: CheckCircle2,
    label: "Completed",
    className: "bg-accent-green/15 text-accent-green border-accent-green/30",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    className: "bg-accent-red/15 text-accent-red border-accent-red/30",
  },
  skipped: {
    icon: Clock,
    label: "Skipped",
    className: "bg-muted/50 text-muted-foreground border-border/50",
  },
};

interface PolicyDecision {
  allowed: boolean;
  policy_id?: string;
  policy_name?: string;
  reason?: string;
  required_approval?: boolean;
}

interface StepDetailPanelProps {
  step: Step;
  onClose?: () => void;
  className?: string;
}

export function StepDetailPanel({
  step,
  onClose,
  className,
}: StepDetailPanelProps) {
  const typeConfig = STEP_TYPE_CONFIG[step.step_type] || STEP_TYPE_CONFIG.tool;
  const statusConfig =
    STEP_STATUS_CONFIG[step.status] || STEP_STATUS_CONFIG.pending;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  // Calculate duration
  const duration = calculateDuration(step);

  // Extract policy decision from step input/output if it's a tool call
  const policyDecision = extractPolicyDecision(step);

  return (
    <div
      className={cn(
        "flex flex-col h-full bg-background-secondary border-l border-border",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background-tertiary">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="flex-shrink-0 p-2 rounded-lg"
            style={{ backgroundColor: `${typeConfig.color}20` }}
          >
            <TypeIcon
              className="h-5 w-5"
              style={{ color: typeConfig.color }}
            />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">
              {step.tool_name || step.model || typeConfig.label}
            </h3>
            <p className="text-xs text-muted-foreground">
              {typeConfig.label}
              {step.step_number !== undefined && ` #${step.step_number}`}
            </p>
          </div>
        </div>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Status Badge */}
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn("font-medium", statusConfig.className)}
            >
              <StatusIcon
                className={cn(
                  "h-3 w-3 mr-1.5",
                  step.status === "running" && "animate-spin"
                )}
              />
              {statusConfig.label}
            </Badge>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard
              icon={Timer}
              label="Duration"
              value={formatDurationDisplay(duration)}
              iconColor="text-accent-blue"
            />
            <MetricCard
              icon={Hash}
              label="Tokens In"
              value={formatTokens(step.input_tokens)}
              iconColor="text-accent-cyan"
            />
            <MetricCard
              icon={Hash}
              label="Tokens Out"
              value={formatTokens(step.output_tokens)}
              iconColor="text-accent-purple"
            />
            <MetricCard
              icon={Coins}
              label="Cost"
              value={calculateStepCost(step)}
              iconColor="text-accent-green"
            />
          </div>

          <Separator />

          {/* Timestamps */}
          <Section title="Timestamps">
            <div className="space-y-2 text-sm">
              <TimestampRow
                icon={Calendar}
                label="Created"
                value={step.created_at}
              />
              {step.started_at && (
                <TimestampRow
                  icon={Clock}
                  label="Started"
                  value={step.started_at}
                />
              )}
              {step.completed_at && (
                <TimestampRow
                  icon={CheckCircle2}
                  label="Completed"
                  value={step.completed_at}
                />
              )}
            </div>
          </Section>

          {/* Policy Decision (for tool calls) */}
          {policyDecision && (
            <>
              <Separator />
              <Section title="Policy Decision">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        policyDecision.allowed
                          ? "bg-accent-green/15 text-accent-green border-accent-green/30"
                          : "bg-accent-red/15 text-accent-red border-accent-red/30"
                      )}
                    >
                      {policyDecision.allowed ? (
                        <CheckCircle2 className="h-3 w-3 mr-1" />
                      ) : (
                        <XCircle className="h-3 w-3 mr-1" />
                      )}
                      {policyDecision.allowed ? "Allowed" : "Denied"}
                    </Badge>
                    {policyDecision.required_approval && (
                      <Badge
                        variant="outline"
                        className="bg-accent-yellow/15 text-accent-yellow border-accent-yellow/30"
                      >
                        <Shield className="h-3 w-3 mr-1" />
                        Required Approval
                      </Badge>
                    )}
                  </div>
                  {policyDecision.policy_name && (
                    <div className="text-sm">
                      <span className="text-muted-foreground">Policy: </span>
                      <span className="font-mono text-xs">
                        {policyDecision.policy_name}
                      </span>
                    </div>
                  )}
                  {policyDecision.reason && (
                    <div className="text-sm text-muted-foreground">
                      {policyDecision.reason}
                    </div>
                  )}
                </div>
              </Section>
            </>
          )}

          {/* Input */}
          {step.input && Object.keys(step.input).length > 0 && (
            <>
              <Separator />
              <Section title="Input">
                <JsonViewer data={step.input} collapsed />
              </Section>
            </>
          )}

          {/* Output */}
          {step.output && (
            <>
              <Separator />
              <Section title="Output">
                {typeof step.output === "string" ? (
                  <div className="bg-background-tertiary rounded-md p-3 text-sm">
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                      {step.output}
                    </pre>
                  </div>
                ) : (
                  <JsonViewer data={step.output} collapsed />
                )}
              </Section>
            </>
          )}

          {/* Error */}
          {step.status === "failed" && step.error && (
            <>
              <Separator />
              <Section title="Error">
                <div className="bg-accent-red/10 border border-accent-red/20 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-accent-red flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-accent-red">
                      {typeof step.error === "string" ? (
                        <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                          {step.error}
                        </pre>
                      ) : (
                        <JsonViewer data={step.error} />
                      )}
                    </div>
                  </div>
                </div>
              </Section>
            </>
          )}

          {/* Trace Info */}
          {step.span_id && (
            <>
              <Separator />
              <Section title="Trace Info">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Step ID</span>
                    <code className="font-mono text-xs bg-background-tertiary px-2 py-0.5 rounded">
                      {step.id}
                    </code>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Span ID</span>
                    <code className="font-mono text-xs bg-background-tertiary px-2 py-0.5 rounded">
                      {step.span_id}
                    </code>
                  </div>
                  {step.parent_step_id && (
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Parent Step</span>
                      <code className="font-mono text-xs bg-background-tertiary px-2 py-0.5 rounded">
                        {step.parent_step_id}
                      </code>
                    </div>
                  )}
                </div>
              </Section>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// Helper components

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="space-y-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </div>
  );
}

interface MetricCardProps {
  icon: typeof Timer;
  label: string;
  value: string;
  iconColor?: string;
}

function MetricCard({ icon: Icon, label, value, iconColor }: MetricCardProps) {
  return (
    <div className="bg-background-tertiary rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-3.5 w-3.5", iconColor || "text-muted-foreground")} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <div className="font-semibold text-sm">{value}</div>
    </div>
  );
}

interface TimestampRowProps {
  icon: typeof Clock;
  label: string;
  value: string;
}

function TimestampRow({ icon: Icon, label, value }: TimestampRowProps) {
  const date = new Date(value);
  const formatted = date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <span className="font-mono text-xs">{formatted}</span>
    </div>
  );
}

// Helper functions

function calculateDuration(step: Step): number {
  if (!step.started_at) return 0;

  const startTime = new Date(step.started_at).getTime();
  const endTime = step.completed_at
    ? new Date(step.completed_at).getTime()
    : Date.now();

  return endTime - startTime;
}

function formatDurationDisplay(ms: number): string {
  if (ms === 0) return "-";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(1)}m`;
  return `${(ms / 3600000).toFixed(1)}h`;
}

function calculateStepCost(step: Step): string {
  // Estimate cost based on token usage
  // Using approximate rates: input ~$0.01/1K, output ~$0.03/1K
  const inputCost = ((step.input_tokens || 0) / 1000) * 0.01;
  const outputCost = ((step.output_tokens || 0) / 1000) * 0.03;
  const totalCents = Math.round((inputCost + outputCost) * 100);

  if (totalCents === 0 && (step.input_tokens || step.output_tokens)) {
    return "<1c";
  }

  return formatCost(totalCents);
}

function extractPolicyDecision(step: Step): PolicyDecision | null {
  // Check if step input or output contains policy decision info
  if (step.step_type !== "tool") return null;

  const input = step.input as Record<string, unknown>;
  const output = step.output as Record<string, unknown> | undefined;

  // Look for policy decision in input
  if (input?.policy_decision) {
    return input.policy_decision as PolicyDecision;
  }

  // Look in output
  if (output && typeof output === "object" && "policy_decision" in output) {
    return output.policy_decision as PolicyDecision;
  }

  return null;
}
