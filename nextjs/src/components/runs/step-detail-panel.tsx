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
  AlertTriangle,
  ChevronRight,
  FileText,
  Code,
  Terminal,
  ExternalLink,
} from "lucide-react";
import { useState, useCallback, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

// Step type configuration with enhanced styling
const stepTypeConfig: Record<
  StepType,
  { icon: typeof Brain; label: string; color: string; gradient: string }
> = {
  llm: {
    icon: Brain,
    label: "LLM Call",
    color: "text-purple-400",
    gradient: "from-purple-500 to-purple-600",
  },
  tool: {
    icon: Wrench,
    label: "Tool Call",
    color: "text-blue-400",
    gradient: "from-blue-500 to-blue-600",
  },
  retrieval: {
    icon: Database,
    label: "Retrieval",
    color: "text-cyan-400",
    gradient: "from-cyan-500 to-cyan-600",
  },
  human: {
    icon: User,
    label: "Human Input",
    color: "text-orange-400",
    gradient: "from-orange-500 to-orange-600",
  },
  approval: {
    icon: Shield,
    label: "Approval",
    color: "text-yellow-400",
    gradient: "from-yellow-500 to-yellow-600",
  },
};

const stepStatusConfig: Record<
  StepStatus,
  { icon: typeof CheckCircle; label: string; color: string; bgColor: string }
> = {
  pending: {
    icon: Clock,
    label: "Pending",
    color: "text-foreground-muted",
    bgColor: "bg-secondary",
  },
  running: {
    icon: Loader2,
    label: "Running",
    color: "text-yellow-400",
    bgColor: "bg-yellow-500/20",
  },
  waiting_approval: {
    icon: Shield,
    label: "Waiting Approval",
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
  },
  completed: {
    icon: CheckCircle,
    label: "Completed",
    color: "text-green-400",
    bgColor: "bg-green-500/20",
  },
  failed: {
    icon: XCircle,
    label: "Failed",
    color: "text-red-400",
    bgColor: "bg-red-500/20",
  },
  skipped: {
    icon: Clock,
    label: "Skipped",
    color: "text-foreground-muted",
    bgColor: "bg-secondary",
  },
};

interface StepDetailPanelProps {
  step: Step | null;
  className?: string;
}

export function StepDetailPanel({ step, className }: StepDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<"input" | "output" | "error" | "timing">("input");
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  const handleCopyId = useCallback(async () => {
    if (!step) return;
    const success = await copyToClipboard(step.id);
    if (success) {
      toast.success("Step ID copied");
    }
  }, [step]);

  // Update current time for running steps
  useEffect(() => {
    if (step?.status === "running" && step.started_at && !step.completed_at) {
      const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
      return () => clearInterval(interval);
    }
  }, [step?.status, step?.started_at, step?.completed_at]);

  // Auto-select error tab if step has error
  useEffect(() => {
    if (step?.error && activeTab !== "error") {
      queueMicrotask(() => setActiveTab("error"));
    } else if (step && !step.error && activeTab === "error") {
      queueMicrotask(() => setActiveTab("output"));
    }
  }, [step?.error, step, activeTab]);

  if (!step) {
    return (
      <div
        className={cn(
          "rounded-xl border border-border bg-background-secondary/30 flex items-center justify-center",
          className
        )}
      >
        <div className="text-center py-16 px-6">
          <div className="w-12 h-12 rounded-xl bg-background-tertiary flex items-center justify-center mx-auto mb-4">
            <Wrench className="h-6 w-6 text-foreground-muted" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">No step selected</h3>
          <p className="text-xs text-foreground-muted max-w-[200px]">
            Select a step from the timeline to view its details
          </p>
        </div>
      </div>
    );
  }

  const typeConfig = stepTypeConfig[step.step_type] || stepTypeConfig.tool;
  const statusConfig = stepStatusConfig[step.status] || stepStatusConfig.pending;
  const TypeIcon = typeConfig.icon;
  const StatusIcon = statusConfig.icon;

  const stepDuration =
    step.started_at && step.completed_at
      ? new Date(step.completed_at).getTime() - new Date(step.started_at).getTime()
      : step.started_at
      ? currentTime - new Date(step.started_at).getTime()
      : 0;

  const tabs = [
    { id: "input" as const, label: "Input", icon: ChevronRight },
    { id: "output" as const, label: "Output", icon: FileText },
    ...(step.error ? [{ id: "error" as const, label: "Error", icon: AlertTriangle }] : []),
    { id: "timing" as const, label: "Timing", icon: Timer },
  ];

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background-secondary/30 flex flex-col overflow-hidden animate-fade-in",
        className
      )}
    >
      {/* Header */}
      <div className="p-4 border-b border-border bg-background-tertiary/50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {/* Type Icon */}
            <div
              className={cn(
                "shrink-0 w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br",
                typeConfig.gradient
              )}
              style={{ boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}
            >
              <TypeIcon className="h-5 w-5 text-white" />
            </div>

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground truncate">
                  {step.tool_name || step.model || typeConfig.label}
                </h3>
                {step.step_number && (
                  <span className="text-xs text-foreground-muted font-mono px-1.5 py-0.5 rounded bg-background-tertiary">
                    #{step.step_number}
                  </span>
                )}
              </div>
              <button
                onClick={handleCopyId}
                className="text-xs font-mono text-foreground-muted hover:text-foreground-secondary transition-colors flex items-center gap-1 group"
              >
                <span>{truncateId(step.id, 24)}</span>
                <Copy className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            </div>
          </div>

          {/* Status Badge */}
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 gap-1.5 px-2.5 py-1",
              statusConfig.bgColor,
              statusConfig.color,
              "border-current/25"
            )}
          >
            <StatusIcon
              className={cn("h-3 w-3", step.status === "running" && "animate-spin")}
            />
            {statusConfig.label}
          </Badge>
        </div>

        {/* Metrics Row */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-border/50">
          <MetricPill
            icon={Timer}
            label="Duration"
            value={formatDuration(stepDuration)}
            isLive={step.status === "running"}
          />
          {(step.input_tokens || step.output_tokens) && (
            <MetricPill
              icon={Zap}
              label="Tokens"
              value={`${formatTokens(step.input_tokens || 0)} / ${formatTokens(step.output_tokens || 0)}`}
            />
          )}
          {step.model && (
            <MetricPill icon={Brain} label="Model" value={step.model} mono />
          )}
          {step.tool_version && (
            <MetricPill icon={Code} label="Version" value={`v${step.tool_version}`} mono />
          )}
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex border-b border-border bg-background-tertiary/30 px-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium transition-colors relative",
              activeTab === tab.id
                ? "text-accent-primary"
                : "text-foreground-muted hover:text-foreground-secondary"
            )}
          >
            <tab.icon className={cn("h-3.5 w-3.5", tab.id === "error" && "text-red-400")} />
            {tab.label}
            {activeTab === tab.id && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent-primary rounded-t-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {activeTab === "input" && <InputContent step={step} />}
          {activeTab === "output" && <OutputContent step={step} />}
          {activeTab === "error" && <ErrorContent step={step} />}
          {activeTab === "timing" && <TimingContent step={step} stepDuration={stepDuration} />}
        </div>
      </ScrollArea>
    </div>
  );
}

// Metric pill component
function MetricPill({
  icon: Icon,
  label,
  value,
  isLive,
  mono,
}: {
  icon: typeof Timer;
  label: string;
  value: string;
  isLive?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Icon className={cn("h-3 w-3", isLive ? "text-accent-primary" : "text-foreground-muted")} />
      <span className="text-foreground-muted">{label}:</span>
      <span className={cn("font-medium", mono && "font-mono", isLive && "text-accent-primary")}>
        {value}
      </span>
      {isLive && (
        <span className="relative flex h-2 w-2 ml-0.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-primary opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-accent-primary" />
        </span>
      )}
    </div>
  );
}

// Input content tab
function InputContent({ step }: { step: Step }) {
  if (!step.input || Object.keys(step.input).length === 0) {
    return <EmptyState message="No input data" icon={ChevronRight} />;
  }

  return <JsonViewer data={step.input} maxHeight={350} searchable />;
}

// Output content tab with markdown and text rendering
function OutputContent({ step }: { step: Step }) {
  if (!step.output) {
    if (step.status === "running") {
      return (
        <div className="flex items-center justify-center py-12">
          <div className="text-center">
            <Loader2 className="h-8 w-8 text-accent-primary animate-spin mx-auto mb-3" />
            <p className="text-sm text-foreground-muted">Waiting for output...</p>
          </div>
        </div>
      );
    }
    return <EmptyState message="No output data" icon={FileText} />;
  }

  // Handle string output (LLM responses, text content)
  if (typeof step.output === "string") {
    return <TextOutput content={step.output} />;
  }

  // Handle JSON output
  return <JsonViewer data={step.output} maxHeight={350} searchable />;
}

// Enhanced text output component with formatting
function TextOutput({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(content);
    if (success) {
      setCopied(true);
      toast.success("Output copied");
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Check if content contains code blocks
  const hasCodeBlocks = content.includes("```");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-foreground-muted">
          <Terminal className="h-3.5 w-3.5" />
          <span>Text Output</span>
          <span className="text-foreground-dim">({content.length.toLocaleString()} chars)</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 gap-1.5"
          onClick={handleCopy}
        >
          {copied ? (
            <CheckCircle className="h-3.5 w-3.5 text-accent-green" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          <span className="text-xs">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>

      <div className="relative">
        {hasCodeBlocks ? (
          <MarkdownCodeRenderer content={content} />
        ) : (
          <pre className="rounded-lg bg-background p-4 text-sm font-mono text-foreground-secondary overflow-auto max-h-[400px] whitespace-pre-wrap leading-relaxed border border-border">
            {content}
          </pre>
        )}
      </div>
    </div>
  );
}

// Simple markdown code block renderer
function MarkdownCodeRenderer({ content }: { content: string }) {
  const parts = useMemo(() => {
    const segments: { type: "text" | "code"; content: string; language?: string }[] = [];
    const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        segments.push({
          type: "text",
          content: content.slice(lastIndex, match.index),
        });
      }

      // Add code block
      segments.push({
        type: "code",
        language: match[1] || "plaintext",
        content: match[2],
      });

      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      segments.push({
        type: "text",
        content: content.slice(lastIndex),
      });
    }

    return segments.length > 0 ? segments : [{ type: "text" as const, content }];
  }, [content]);

  return (
    <div className="space-y-4 max-h-[400px] overflow-auto">
      {parts.map((part, index) => (
        <div key={index}>
          {part.type === "code" ? (
            <div className="relative group">
              <div className="absolute top-2 right-2 flex items-center gap-2">
                <span className="text-[10px] font-mono text-foreground-muted px-2 py-0.5 bg-background-tertiary rounded">
                  {part.language}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => {
                    copyToClipboard(part.content);
                    toast.success("Code copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <pre className="rounded-lg bg-background p-4 pt-8 text-sm font-mono text-foreground-secondary overflow-auto whitespace-pre leading-relaxed border border-border">
                {part.content}
              </pre>
            </div>
          ) : (
            <pre className="text-sm font-mono text-foreground-secondary whitespace-pre-wrap leading-relaxed">
              {part.content.trim()}
            </pre>
          )}
        </div>
      ))}
    </div>
  );
}

// Error content tab
function ErrorContent({ step }: { step: Step }) {
  if (!step.error) {
    return <EmptyState message="No error information" icon={AlertTriangle} />;
  }

  const errorMessage =
    typeof step.error === "object" && "message" in (step.error as Record<string, unknown>)
      ? String((step.error as Record<string, unknown>).message)
      : typeof step.error === "string"
      ? step.error
      : "Step execution failed";

  return (
    <div className="space-y-4">
      {/* Error banner */}
      <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-4">
        <div className="flex items-start gap-3">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
            <XCircle className="h-4 w-4 text-red-400" />
          </div>
          <div className="min-w-0 flex-1">
            <h4 className="text-sm font-semibold text-red-400 mb-1">Execution Failed</h4>
            <p className="text-sm text-red-300/80">{errorMessage}</p>
          </div>
        </div>
      </div>

      {/* Full error details */}
      {typeof step.error === "object" && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
            Error Details
          </h4>
          <JsonViewer data={step.error} maxHeight={250} />
        </div>
      )}
    </div>
  );
}

// Timing content tab
function TimingContent({ step, stepDuration }: { step: Step; stepDuration: number }) {
  return (
    <div className="space-y-6">
      {/* Timeline */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
          Timeline
        </h4>
        <div className="space-y-2">
          <TimingRow label="Created" time={step.created_at} />
          {step.started_at && <TimingRow label="Started" time={step.started_at} />}
          {step.completed_at && <TimingRow label="Completed" time={step.completed_at} />}
        </div>
      </div>

      {/* Duration */}
      {step.started_at && (
        <div className="space-y-3 pt-4 border-t border-border">
          <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
            Duration
          </h4>
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground-muted">Total execution time</span>
            <span className="text-lg font-mono font-semibold text-foreground tabular-nums">
              {formatDuration(stepDuration)}
            </span>
          </div>
        </div>
      )}

      {/* Trace info */}
      {step.span_id && (
        <div className="space-y-3 pt-4 border-t border-border">
          <h4 className="text-xs font-medium text-foreground-muted uppercase tracking-wider">
            Tracing
          </h4>
          <div className="flex items-center justify-between">
            <span className="text-sm text-foreground-muted">Span ID</span>
            <button
              onClick={() => {
                copyToClipboard(step.span_id!);
                toast.success("Span ID copied");
              }}
              className="flex items-center gap-2 text-sm font-mono text-foreground-secondary hover:text-foreground transition-colors"
            >
              {truncateId(step.span_id, 16)}
              <Copy className="h-3 w-3" />
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => {
              window.open(`http://localhost:16686/trace/${step.span_id}`, "_blank");
            }}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View in Jaeger
          </Button>
        </div>
      )}
    </div>
  );
}

function TimingRow({ label, time }: { label: string; time: string }) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-background-tertiary/50">
      <span className="text-sm text-foreground-muted">{label}</span>
      <span className="text-sm font-mono text-foreground-secondary">{formatDateTime(time)}</span>
    </div>
  );
}

function EmptyState({ message, icon: Icon }: { message: string; icon: typeof FileText }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <Icon className="h-8 w-8 text-foreground-muted mx-auto mb-3 opacity-50" />
        <p className="text-sm text-foreground-muted">{message}</p>
      </div>
    </div>
  );
}
