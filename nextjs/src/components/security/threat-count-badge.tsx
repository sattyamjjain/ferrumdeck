"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types";
import { ShieldAlert, Shield } from "lucide-react";

interface ThreatCountBadgeProps {
  count: number;
  highestRiskLevel?: RiskLevel;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "default" | "lg";
}

export function ThreatCountBadge({
  count,
  highestRiskLevel,
  className,
  showIcon = true,
  size = "default",
}: ThreatCountBadgeProps) {
  if (count === 0) {
    return null;
  }

  const isHighRisk = highestRiskLevel === "critical" || highestRiskLevel === "high";
  const Icon = isHighRisk ? ShieldAlert : Shield;

  const colorClass = (() => {
    switch (highestRiskLevel) {
      case "critical":
        return "bg-red-500/10 text-red-500 border-red-500/30";
      case "high":
        return "bg-orange-500/10 text-orange-500 border-orange-500/30";
      case "medium":
        return "bg-yellow-500/10 text-yellow-500 border-yellow-500/30";
      case "low":
        return "bg-blue-500/10 text-blue-500 border-blue-500/30";
      default:
        return "bg-secondary/50 text-foreground-muted border-border/50";
    }
  })();

  const glowColor = (() => {
    switch (highestRiskLevel) {
      case "critical":
        return "0 0 12px rgba(239, 68, 68, 0.25)";
      case "high":
        return "0 0 10px rgba(249, 115, 22, 0.2)";
      default:
        return undefined;
    }
  })();

  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0 h-5 gap-1",
    default: "text-xs px-2 py-0.5 h-6 gap-1.5",
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
        "font-semibold tracking-tight border transition-all duration-200 inline-flex items-center cursor-pointer hover:brightness-110",
        sizeClasses[size],
        colorClass,
        className
      )}
      style={{
        boxShadow: glowColor,
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
      <span>{count}</span>
    </Badge>
  );
}

// Compact inline indicator for tight spaces
export function ThreatIndicator({
  count,
  highestRiskLevel,
  className,
}: {
  count: number;
  highestRiskLevel?: RiskLevel;
  className?: string;
}) {
  if (count === 0) {
    return null;
  }

  const isHighRisk = highestRiskLevel === "critical" || highestRiskLevel === "high";
  const Icon = isHighRisk ? ShieldAlert : Shield;

  const colorClass = (() => {
    switch (highestRiskLevel) {
      case "critical":
        return "text-red-500";
      case "high":
        return "text-orange-500";
      case "medium":
        return "text-yellow-500";
      case "low":
        return "text-blue-500";
      default:
        return "text-foreground-muted";
    }
  })();

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Icon className={cn("h-3.5 w-3.5", colorClass, isHighRisk && "animate-pulse")} />
      <span className={cn("text-xs font-medium", colorClass)}>{count}</span>
    </div>
  );
}
