"use client";

import { useMemo } from "react";
import {
  Play,
  CheckCircle,
  XCircle,
  Shield,
  Clock,
  AlertTriangle,
  Loader2,
  User,
  Ban,
  DollarSign,
  Timer,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/shared/empty-state";
import { cn, formatDateTime, formatTimeAgo, truncateId } from "@/lib/utils";
import type { Run, Step } from "@/types/run";

// Audit event types for this run
type AuditEventType =
  | "run.created"
  | "run.queued"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.timeout"
  | "run.budget_killed"
  | "step.created"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "policy.check"
  | "policy.blocked"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected";

interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: string;
  details: Record<string, unknown>;
  actor?: string;
}

interface AuditTabProps {
  run: Run;
  steps: Step[];
  className?: string;
}

export function AuditTab({ run, steps, className }: AuditTabProps) {
  // Generate audit events from run and steps data
  const auditEvents = useMemo(() => {
    const events: AuditEvent[] = [];

    // Run lifecycle events
    events.push({
      id: `${run.id}-created`,
      type: "run.created",
      timestamp: run.created_at,
      details: {
        agent_version_id: run.agent_version_id,
        project_id: run.project_id,
      },
    });

    if (run.started_at) {
      events.push({
        id: `${run.id}-started`,
        type: "run.started",
        timestamp: run.started_at,
        details: {},
      });
    }

    // Generate step events
    steps.forEach((step) => {
      events.push({
        id: `${step.id}-created`,
        type: "step.created",
        timestamp: step.created_at,
        details: {
          step_type: step.step_type,
          tool_name: step.tool_name,
          model: step.model,
        },
      });

      if (step.started_at) {
        events.push({
          id: `${step.id}-started`,
          type: "step.started",
          timestamp: step.started_at,
          details: {
            step_type: step.step_type,
            tool_name: step.tool_name,
          },
        });
      }

      if (step.status === "completed" && step.completed_at) {
        events.push({
          id: `${step.id}-completed`,
          type: "step.completed",
          timestamp: step.completed_at,
          details: {
            step_type: step.step_type,
            input_tokens: step.input_tokens,
            output_tokens: step.output_tokens,
          },
        });
      }

      if (step.status === "failed" && step.completed_at) {
        events.push({
          id: `${step.id}-failed`,
          type: "step.failed",
          timestamp: step.completed_at,
          details: {
            step_type: step.step_type,
            error: step.error,
          },
        });
      }

      if (step.status === "waiting_approval") {
        events.push({
          id: `${step.id}-approval-requested`,
          type: "approval.requested",
          timestamp: step.started_at || step.created_at,
          details: {
            tool_name: step.tool_name,
            step_id: step.id,
          },
        });
      }
    });

    // Run completion events
    if (run.completed_at) {
      const eventType = (() => {
        switch (run.status) {
          case "completed":
            return "run.completed" as const;
          case "failed":
            return "run.failed" as const;
          case "cancelled":
            return "run.cancelled" as const;
          case "timeout":
            return "run.timeout" as const;
          case "budget_killed":
            return "run.budget_killed" as const;
          default:
            return "run.completed" as const;
        }
      })();

      events.push({
        id: `${run.id}-${run.status}`,
        type: eventType,
        timestamp: run.completed_at,
        details: {
          status: run.status,
          status_reason: run.status_reason,
          cost_cents: run.cost_cents,
          input_tokens: run.input_tokens,
          output_tokens: run.output_tokens,
        },
      });
    }

    // Sort by timestamp descending (most recent first)
    return events.sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [run, steps]);

  if (auditEvents.length === 0) {
    return (
      <EmptyState
        icon={Clock}
        title="No audit events"
        description="Audit events will appear as the run progresses."
        variant="compact"
        className={className}
      />
    );
  }

  return (
    <ScrollArea className={cn("h-[500px]", className)}>
      <div className="relative pl-6">
        {/* Timeline line */}
        <div className="absolute left-[11px] top-0 bottom-0 w-px bg-border" />

        <div className="space-y-4 pb-4">
          {auditEvents.map((event, index) => (
            <AuditEventCard
              key={event.id}
              event={event}
              isFirst={index === 0}
              isLast={index === auditEvents.length - 1}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  );
}

interface AuditEventCardProps {
  event: AuditEvent;
  isFirst: boolean;
  isLast: boolean;
}

function AuditEventCard({ event }: AuditEventCardProps) {
  const config = getEventConfig(event.type);
  const Icon = config.icon;

  return (
    <div className="relative">
      {/* Timeline node */}
      <div
        className={cn(
          "absolute -left-6 w-[22px] h-[22px] rounded-full flex items-center justify-center border-2 bg-background",
          config.nodeClass
        )}
      >
        <Icon className={cn("h-3 w-3", config.iconClass)} />
      </div>

      {/* Event card */}
      <Card className="ml-4">
        <CardContent className="p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm">{config.label}</span>
                <Badge variant="outline" className={cn("text-xs", config.badgeClass)}>
                  {formatEventCategory(event.type)}
                </Badge>
              </div>

              {/* Event details */}
              <div className="text-xs text-muted-foreground space-y-0.5">
                {renderEventDetails(event)}
              </div>
            </div>

            <div className="text-right shrink-0">
              <div className="text-xs text-muted-foreground">
                {formatTimeAgo(event.timestamp)}
              </div>
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                {formatDateTime(event.timestamp)}
              </div>
            </div>
          </div>

          {event.actor && (
            <div className="flex items-center gap-1 mt-2 pt-2 border-t text-xs text-muted-foreground">
              <User className="h-3 w-3" />
              <span>{event.actor}</span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function getEventConfig(type: AuditEventType): {
  icon: typeof Play;
  label: string;
  nodeClass: string;
  iconClass: string;
  badgeClass: string;
} {
  switch (type) {
    case "run.created":
      return {
        icon: Play,
        label: "Run Created",
        nodeClass: "border-blue-500",
        iconClass: "text-blue-400",
        badgeClass: "text-blue-400 border-blue-500/30",
      };
    case "run.queued":
      return {
        icon: Clock,
        label: "Run Queued",
        nodeClass: "border-blue-500",
        iconClass: "text-blue-400",
        badgeClass: "text-blue-400 border-blue-500/30",
      };
    case "run.started":
      return {
        icon: Loader2,
        label: "Run Started",
        nodeClass: "border-yellow-500",
        iconClass: "text-yellow-400",
        badgeClass: "text-yellow-400 border-yellow-500/30",
      };
    case "run.completed":
      return {
        icon: CheckCircle,
        label: "Run Completed",
        nodeClass: "border-green-500",
        iconClass: "text-green-400",
        badgeClass: "text-green-400 border-green-500/30",
      };
    case "run.failed":
      return {
        icon: XCircle,
        label: "Run Failed",
        nodeClass: "border-red-500",
        iconClass: "text-red-400",
        badgeClass: "text-red-400 border-red-500/30",
      };
    case "run.cancelled":
      return {
        icon: Ban,
        label: "Run Cancelled",
        nodeClass: "border-gray-500",
        iconClass: "text-gray-400",
        badgeClass: "text-gray-400 border-gray-500/30",
      };
    case "run.timeout":
      return {
        icon: Timer,
        label: "Run Timeout",
        nodeClass: "border-orange-500",
        iconClass: "text-orange-400",
        badgeClass: "text-orange-400 border-orange-500/30",
      };
    case "run.budget_killed":
      return {
        icon: DollarSign,
        label: "Budget Exceeded",
        nodeClass: "border-red-500",
        iconClass: "text-red-400",
        badgeClass: "text-red-400 border-red-500/30",
      };
    case "step.created":
      return {
        icon: Clock,
        label: "Step Created",
        nodeClass: "border-border",
        iconClass: "text-muted-foreground",
        badgeClass: "text-muted-foreground border-border",
      };
    case "step.started":
      return {
        icon: Loader2,
        label: "Step Started",
        nodeClass: "border-yellow-500",
        iconClass: "text-yellow-400",
        badgeClass: "text-yellow-400 border-yellow-500/30",
      };
    case "step.completed":
      return {
        icon: CheckCircle,
        label: "Step Completed",
        nodeClass: "border-green-500",
        iconClass: "text-green-400",
        badgeClass: "text-green-400 border-green-500/30",
      };
    case "step.failed":
      return {
        icon: XCircle,
        label: "Step Failed",
        nodeClass: "border-red-500",
        iconClass: "text-red-400",
        badgeClass: "text-red-400 border-red-500/30",
      };
    case "policy.check":
      return {
        icon: Shield,
        label: "Policy Check",
        nodeClass: "border-purple-500",
        iconClass: "text-purple-400",
        badgeClass: "text-purple-400 border-purple-500/30",
      };
    case "policy.blocked":
      return {
        icon: Shield,
        label: "Policy Blocked",
        nodeClass: "border-red-500",
        iconClass: "text-red-400",
        badgeClass: "text-red-400 border-red-500/30",
      };
    case "approval.requested":
      return {
        icon: AlertTriangle,
        label: "Approval Requested",
        nodeClass: "border-amber-500",
        iconClass: "text-amber-400",
        badgeClass: "text-amber-400 border-amber-500/30",
      };
    case "approval.approved":
      return {
        icon: CheckCircle,
        label: "Approved",
        nodeClass: "border-green-500",
        iconClass: "text-green-400",
        badgeClass: "text-green-400 border-green-500/30",
      };
    case "approval.rejected":
      return {
        icon: XCircle,
        label: "Rejected",
        nodeClass: "border-red-500",
        iconClass: "text-red-400",
        badgeClass: "text-red-400 border-red-500/30",
      };
    default:
      return {
        icon: Clock,
        label: type,
        nodeClass: "border-border",
        iconClass: "text-muted-foreground",
        badgeClass: "text-muted-foreground border-border",
      };
  }
}

function formatEventCategory(type: AuditEventType): string {
  const [category] = type.split(".");
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function renderEventDetails(event: AuditEvent): React.ReactNode {
  const details = event.details;
  const lines: React.ReactNode[] = [];

  if (details.tool_name) {
    lines.push(
      <div key="tool">
        Tool: <span className="font-mono">{String(details.tool_name)}</span>
      </div>
    );
  }

  if (details.model) {
    lines.push(
      <div key="model">
        Model: <span className="font-mono">{String(details.model)}</span>
      </div>
    );
  }

  if (details.step_type) {
    lines.push(
      <div key="step_type">
        Type: <span className="font-mono">{String(details.step_type)}</span>
      </div>
    );
  }

  if (details.status_reason) {
    lines.push(
      <div key="reason">Reason: {String(details.status_reason)}</div>
    );
  }

  if (details.input_tokens || details.output_tokens) {
    lines.push(
      <div key="tokens">
        Tokens: {Number(details.input_tokens) || 0} in / {Number(details.output_tokens) || 0}{" "}
        out
      </div>
    );
  }

  if (details.cost_cents !== undefined && details.cost_cents !== null) {
    lines.push(<div key="cost">Cost: {Number(details.cost_cents)}c</div>);
  }

  if (details.agent_version_id) {
    lines.push(
      <div key="agent">
        Agent Version:{" "}
        <span className="font-mono">
          {truncateId(String(details.agent_version_id))}
        </span>
      </div>
    );
  }

  return lines.length > 0 ? lines : <div>-</div>;
}
