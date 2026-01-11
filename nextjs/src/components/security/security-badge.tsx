"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";
import type { ViolationType } from "@/types/security";
import { getViolationTypeLabel } from "@/types/security";
import { Shield, ShieldAlert, ShieldX, AlertTriangle } from "lucide-react";

interface RiskConfig {
  label: string;
  icon: typeof Shield;
  className: string;
  glowColor?: string;
}

const riskConfig: Record<RiskLevel, RiskConfig> = {
  critical: {
    label: "Critical",
    icon: ShieldX,
    className: "bg-red-500/10 text-red-500 border-red-500/30",
    glowColor: "rgba(239, 68, 68, 0.25)",
  },
  high: {
    label: "High",
    icon: ShieldAlert,
    className: "bg-orange-500/10 text-orange-500 border-orange-500/30",
    glowColor: "rgba(249, 115, 22, 0.2)",
  },
  medium: {
    label: "Medium",
    icon: AlertTriangle,
    className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/30",
    glowColor: "rgba(234, 179, 8, 0.15)",
  },
  low: {
    label: "Low",
    icon: Shield,
    className: "bg-blue-500/10 text-blue-500 border-blue-500/30",
  },
};

interface SecurityBadgeProps {
  riskLevel: RiskLevel;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "default" | "lg";
  showGlow?: boolean;
}

export function SecurityBadge({
  riskLevel,
  className,
  showIcon = true,
  size = "default",
  showGlow = true,
}: SecurityBadgeProps) {
  const config = riskConfig[riskLevel] || riskConfig.low;
  const Icon = config.icon;

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

  const isHighRisk = riskLevel === "critical" || riskLevel === "high";

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
        boxShadow: showGlow && config.glowColor ? `0 0 12px ${config.glowColor}` : undefined,
      }}
    >
      {showIcon && (
        <Icon
          className={cn(
            iconSizes[size],
            isHighRisk && "animate-pulse"
          )}
        />
      )}
      <span>{config.label}</span>
    </Badge>
  );
}

// Violation type badge
interface ViolationBadgeProps {
  violationType: ViolationType;
  className?: string;
  size?: "sm" | "default" | "lg";
}

export function ViolationBadge({
  violationType,
  className,
  size = "default",
}: ViolationBadgeProps) {
  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0 h-5",
    default: "text-xs px-2 py-0.5 h-6",
    lg: "text-sm px-3 py-1 h-7",
  };

  return (
    <Badge
      variant="outline"
      className={cn(
        "font-medium tracking-tight border bg-secondary/50 text-foreground-muted border-border/50",
        sizeClasses[size],
        className
      )}
    >
      {getViolationTypeLabel(violationType)}
    </Badge>
  );
}

// Security dot indicator for timeline
export function SecurityDot({
  riskLevel,
  className,
  size = "default",
}: {
  riskLevel: RiskLevel;
  className?: string;
  size?: "sm" | "default" | "lg";
}) {
  const sizeClasses = {
    sm: "h-1.5 w-1.5",
    default: "h-2 w-2",
    lg: "h-2.5 w-2.5",
  };

  const colorClass = (() => {
    switch (riskLevel) {
      case "critical":
        return "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]";
      case "high":
        return "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.5)]";
      case "medium":
        return "bg-yellow-500 shadow-[0_0_6px_rgba(234,179,8,0.4)]";
      case "low":
        return "bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.4)]";
      default:
        return "bg-foreground-muted";
    }
  })();

  const config = riskConfig[riskLevel];
  const isHighRisk = riskLevel === "critical" || riskLevel === "high";

  return (
    <span
      className={cn(
        "inline-block rounded-full",
        sizeClasses[size],
        colorClass,
        isHighRisk && "animate-pulse",
        className
      )}
      title={config?.label || riskLevel}
    />
  );
}

// Compact risk score display
export function RiskScoreDisplay({
  score,
  riskLevel,
  className,
}: {
  score: number;
  riskLevel: RiskLevel;
  className?: string;
}) {
  const textColor = (() => {
    switch (riskLevel) {
      case "critical":
        return "text-red-500";
      case "high":
        return "text-orange-500";
      case "medium":
        return "text-yellow-500";
      case "low":
        return "text-blue-500";
      default:
        return "text-muted-foreground";
    }
  })();

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <SecurityDot riskLevel={riskLevel} size="sm" />
      <span className={cn("text-sm font-mono font-bold", textColor)}>
        {score}
      </span>
    </div>
  );
}
