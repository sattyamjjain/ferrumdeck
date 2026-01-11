"use client";

import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

type ColorTheme =
  | "blue"
  | "green"
  | "red"
  | "yellow"
  | "purple"
  | "orange"
  | "cyan"
  | "indigo";

interface StatsCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  colorTheme?: ColorTheme;
  trend?: {
    value: number;
    direction: "up" | "down";
    label?: string;
  };
  className?: string;
  compact?: boolean;
}

const themeConfig: Record<
  ColorTheme,
  {
    iconBg: string;
    iconColor: string;
    valueColor: string;
    glowColor: string;
  }
> = {
  blue: {
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-400",
    valueColor: "text-blue-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(59,130,246,0.15)]",
  },
  green: {
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-400",
    valueColor: "text-emerald-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(16,185,129,0.15)]",
  },
  red: {
    iconBg: "bg-red-500/10",
    iconColor: "text-red-400",
    valueColor: "text-red-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(239,68,68,0.15)]",
  },
  yellow: {
    iconBg: "bg-amber-500/10",
    iconColor: "text-amber-400",
    valueColor: "text-amber-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(245,158,11,0.15)]",
  },
  purple: {
    iconBg: "bg-purple-500/10",
    iconColor: "text-purple-400",
    valueColor: "text-purple-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(168,85,247,0.15)]",
  },
  orange: {
    iconBg: "bg-orange-500/10",
    iconColor: "text-orange-400",
    valueColor: "text-orange-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(249,115,22,0.15)]",
  },
  cyan: {
    iconBg: "bg-cyan-500/10",
    iconColor: "text-cyan-400",
    valueColor: "text-cyan-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(6,182,212,0.15)]",
  },
  indigo: {
    iconBg: "bg-indigo-500/10",
    iconColor: "text-indigo-400",
    valueColor: "text-indigo-400",
    glowColor: "group-hover:shadow-[0_0_20px_rgba(99,102,241,0.15)]",
  },
};

export function StatsCard({
  title,
  value,
  icon: Icon,
  colorTheme = "blue",
  trend,
  className,
  compact = false,
}: StatsCardProps) {
  const theme = themeConfig[colorTheme];
  const formattedValue =
    typeof value === "number" ? value.toLocaleString() : value;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-xl border border-border/50",
        "bg-gradient-to-br from-background-secondary/80 to-background/60",
        "backdrop-blur-sm transition-all duration-300",
        "hover:border-border-hover hover:-translate-y-0.5",
        theme.glowColor,
        className
      )}
    >
      {/* Subtle top accent line */}
      <div
        className={cn(
          "absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity",
          "bg-gradient-to-r from-transparent via-current to-transparent",
          theme.valueColor
        )}
      />

      <div className={cn("p-4", compact && "p-3")}>
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div
            className={cn(
              "p-2 rounded-lg transition-transform duration-200 group-hover:scale-110",
              theme.iconBg,
              compact && "p-1.5"
            )}
          >
            <Icon
              className={cn(
                "h-5 w-5",
                theme.iconColor,
                compact && "h-4 w-4"
              )}
            />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-sm text-muted-foreground truncate">{title}</p>
            <div className="flex items-baseline gap-2">
              <p
                className={cn(
                  "text-2xl font-semibold tabular-nums",
                  compact && "text-xl"
                )}
              >
                {formattedValue}
              </p>
              {trend && (
                <span
                  className={cn(
                    "text-xs font-medium",
                    trend.direction === "up"
                      ? "text-emerald-400"
                      : "text-red-400"
                  )}
                >
                  {trend.direction === "up" ? "+" : "-"}
                  {trend.value}%
                  {trend.label && (
                    <span className="text-muted-foreground ml-1">
                      {trend.label}
                    </span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface StatsGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function StatsGrid({
  children,
  columns = 4,
  className,
}: StatsGridProps) {
  return (
    <div
      className={cn(
        "grid gap-4",
        columns === 2 && "grid-cols-1 md:grid-cols-2",
        columns === 3 && "grid-cols-1 md:grid-cols-3",
        columns === 4 && "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
        className
      )}
    >
      {children}
    </div>
  );
}
