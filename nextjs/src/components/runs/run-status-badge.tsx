"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/types/run";
import {
  Play,
  Clock,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Ban,
  Timer,
  DollarSign,
  Shield,
} from "lucide-react";

interface StatusConfig {
  label: string;
  icon: typeof Play;
  className: string;
  dotClass?: string;
}

const statusConfig: Record<RunStatus, StatusConfig> = {
  created: {
    label: "Created",
    icon: Clock,
    className: "bg-muted/50 text-muted-foreground border-border/50",
  },
  queued: {
    label: "Queued",
    icon: Clock,
    className: "bg-accent-blue/10 text-accent-blue border-accent-blue/30",
  },
  running: {
    label: "Running",
    icon: Loader2,
    className: "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/30",
    dotClass: "animate-pulse",
  },
  waiting_approval: {
    label: "Awaiting",
    icon: AlertTriangle,
    className: "bg-accent-purple/10 text-accent-purple border-accent-purple/30",
    dotClass: "animate-pulse",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "bg-accent-green/10 text-accent-green border-accent-green/30",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className: "bg-accent-red/10 text-accent-red border-accent-red/30",
  },
  cancelled: {
    label: "Cancelled",
    icon: Ban,
    className: "bg-muted/50 text-muted-foreground border-border/50",
  },
  timeout: {
    label: "Timeout",
    icon: Timer,
    className: "bg-accent-orange/10 text-accent-orange border-accent-orange/30",
  },
  budget_killed: {
    label: "Budget",
    icon: DollarSign,
    className: "bg-accent-red/10 text-accent-red border-accent-red/30",
  },
  policy_blocked: {
    label: "Blocked",
    icon: Shield,
    className: "bg-accent-purple/10 text-accent-purple border-accent-purple/30",
  },
};

interface RunStatusBadgeProps {
  status: RunStatus;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "default";
}

export function RunStatusBadge({
  status,
  className,
  showIcon = true,
  size = "default",
}: RunStatusBadgeProps) {
  const config = statusConfig[status] || {
    label: status,
    icon: Clock,
    className: "bg-muted/50 text-muted-foreground",
  };

  const Icon = config.icon;
  const isAnimated = status === "running";

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium tracking-tight border transition-colors",
        size === "sm" ? "text-[10px] px-1.5 py-0 h-5" : "text-xs px-2 py-0.5",
        config.className,
        className
      )}
    >
      {showIcon && (
        <Icon
          className={cn(
            size === "sm" ? "h-2.5 w-2.5 mr-1" : "h-3 w-3 mr-1.5",
            isAnimated && "animate-spin"
          )}
        />
      )}
      {config.label}
    </Badge>
  );
}

// Compact dot indicator for tight spaces
export function RunStatusDot({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const config = statusConfig[status];

  const colorClass = (() => {
    switch (status) {
      case "running":
        return "bg-accent-yellow status-dot-running";
      case "waiting_approval":
        return "bg-accent-purple status-dot-waiting";
      case "completed":
        return "bg-accent-green";
      case "failed":
      case "timeout":
      case "budget_killed":
        return "bg-accent-red";
      case "queued":
        return "bg-accent-blue";
      case "policy_blocked":
        return "bg-accent-purple";
      default:
        return "bg-muted-foreground";
    }
  })();

  return (
    <span
      className={cn("status-dot", colorClass, config?.dotClass, className)}
      title={config?.label || status}
    />
  );
}
