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
  glowColor?: string;
}

const statusConfig: Record<RunStatus, StatusConfig> = {
  created: {
    label: "Created",
    icon: Clock,
    className: "bg-secondary/80 text-foreground-muted border-border/50",
  },
  queued: {
    label: "Queued",
    icon: Clock,
    className: "bg-accent-blue/10 text-accent-blue border-accent-blue/25",
    glowColor: "rgba(59, 130, 246, 0.15)",
  },
  running: {
    label: "Running",
    icon: Loader2,
    className: "bg-accent-yellow/10 text-accent-yellow border-accent-yellow/25",
    dotClass: "animate-pulse",
    glowColor: "rgba(255, 184, 0, 0.2)",
  },
  waiting_approval: {
    label: "Awaiting",
    icon: AlertTriangle,
    className: "bg-accent-purple/10 text-accent-purple border-accent-purple/25",
    dotClass: "animate-pulse",
    glowColor: "rgba(168, 85, 247, 0.2)",
  },
  completed: {
    label: "Completed",
    icon: CheckCircle2,
    className: "bg-accent-green/10 text-accent-green border-accent-green/25",
    glowColor: "rgba(0, 255, 136, 0.1)",
  },
  failed: {
    label: "Failed",
    icon: XCircle,
    className: "bg-accent-red/10 text-accent-red border-accent-red/25",
    glowColor: "rgba(255, 61, 61, 0.15)",
  },
  cancelled: {
    label: "Cancelled",
    icon: Ban,
    className: "bg-secondary/80 text-foreground-muted border-border/50",
  },
  timeout: {
    label: "Timeout",
    icon: Timer,
    className: "bg-accent-orange/10 text-accent-orange border-accent-orange/25",
    glowColor: "rgba(255, 107, 44, 0.15)",
  },
  budget_killed: {
    label: "Budget",
    icon: DollarSign,
    className: "bg-accent-red/10 text-accent-red border-accent-red/25",
    glowColor: "rgba(255, 61, 61, 0.15)",
  },
  policy_blocked: {
    label: "Blocked",
    icon: Shield,
    className: "bg-accent-purple/10 text-accent-purple border-accent-purple/25",
    glowColor: "rgba(168, 85, 247, 0.15)",
  },
};

interface RunStatusBadgeProps {
  status: RunStatus;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "default" | "lg";
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
    className: "bg-secondary/80 text-foreground-muted",
  };

  const Icon = config.icon;
  const isAnimated = status === "running";
  const hasGlow = config.glowColor && (status === "running" || status === "waiting_approval");

  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0 h-5 gap-1",
    default: "text-xs px-2.5 py-0.5 h-6 gap-1.5",
    lg: "text-sm px-3 py-1 h-7 gap-2",
  };

  const iconSizes = {
    sm: "h-2.5 w-2.5",
    default: "h-3 w-3",
    lg: "h-3.5 w-3.5",
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-semibold tracking-tight border transition-all duration-200 inline-flex items-center",
        sizeClasses[size],
        config.className,
        className
      )}
      style={{
        boxShadow: hasGlow ? `0 0 12px ${config.glowColor}` : undefined,
      }}
    >
      {showIcon && (
        <Icon
          className={cn(
            iconSizes[size],
            isAnimated && "animate-spin"
          )}
        />
      )}
      <span className="relative">
        {config.label}
        {/* Subtle highlight for active states */}
        {(status === "running" || status === "waiting_approval") && (
          <span className="absolute inset-0 rounded animate-pulse opacity-30" />
        )}
      </span>
    </Badge>
  );
}

// Compact dot indicator for tight spaces
export function RunStatusDot({
  status,
  className,
  size = "default",
}: {
  status: RunStatus;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const config = statusConfig[status];

  const sizeClasses = {
    sm: "h-1.5 w-1.5",
    default: "h-2 w-2",
    lg: "h-2.5 w-2.5",
  };

  const colorClass = (() => {
    switch (status) {
      case "running":
        return "bg-accent-yellow shadow-[0_0_8px_rgba(255,184,0,0.5)]";
      case "waiting_approval":
        return "bg-accent-purple shadow-[0_0_8px_rgba(168,85,247,0.5)]";
      case "completed":
        return "bg-accent-green shadow-[0_0_6px_rgba(0,255,136,0.4)]";
      case "failed":
      case "budget_killed":
        return "bg-accent-red shadow-[0_0_6px_rgba(255,61,61,0.4)]";
      case "timeout":
        return "bg-accent-orange shadow-[0_0_6px_rgba(255,107,44,0.4)]";
      case "queued":
        return "bg-accent-blue shadow-[0_0_6px_rgba(59,130,246,0.4)]";
      case "policy_blocked":
        return "bg-accent-purple shadow-[0_0_6px_rgba(168,85,247,0.4)]";
      default:
        return "bg-foreground-muted";
    }
  })();

  const animationClass = (() => {
    switch (status) {
      case "running":
        return "animate-[pulse-status_2s_ease-in-out_infinite]";
      case "waiting_approval":
        return "animate-[pulse-status-purple_2s_ease-in-out_infinite]";
      default:
        return "";
    }
  })();

  return (
    <span
      className={cn(
        "inline-block rounded-full",
        sizeClasses[size],
        colorClass,
        animationClass,
        className
      )}
      title={config?.label || status}
    />
  );
}

// Status indicator with label for detailed views
export function RunStatusIndicator({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const config = statusConfig[status];

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <RunStatusDot status={status} size="sm" />
      <span className="text-sm font-medium text-foreground-secondary">
        {config?.label || status}
      </span>
    </div>
  );
}
