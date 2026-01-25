"use client";

import { LucideIcon, Sparkles, Zap, Database, Search, FileX } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  variant?: "default" | "compact" | "card" | "hero";
  accentColor?: "cyan" | "purple" | "green" | "yellow" | "red";
}

const accentColors = {
  cyan: {
    glow: "from-accent-primary/20 via-accent-cyan/10 to-transparent",
    iconBg: "from-accent-primary/10 to-accent-cyan/5",
    border: "border-accent-primary/20",
    dot1: "bg-accent-primary/40",
    dot2: "bg-accent-cyan/30",
  },
  purple: {
    glow: "from-accent-purple/20 via-accent-primary/10 to-transparent",
    iconBg: "from-accent-purple/10 to-accent-primary/5",
    border: "border-accent-purple/20",
    dot1: "bg-accent-purple/40",
    dot2: "bg-accent-primary/30",
  },
  green: {
    glow: "from-accent-green/20 via-accent-cyan/10 to-transparent",
    iconBg: "from-accent-green/10 to-accent-cyan/5",
    border: "border-accent-green/20",
    dot1: "bg-accent-green/40",
    dot2: "bg-accent-cyan/30",
  },
  yellow: {
    glow: "from-accent-yellow/20 via-accent-orange/10 to-transparent",
    iconBg: "from-accent-yellow/10 to-accent-orange/5",
    border: "border-accent-yellow/20",
    dot1: "bg-accent-yellow/40",
    dot2: "bg-accent-orange/30",
  },
  red: {
    glow: "from-accent-red/20 via-accent-orange/10 to-transparent",
    iconBg: "from-accent-red/10 to-accent-orange/5",
    border: "border-accent-red/20",
    dot1: "bg-accent-red/40",
    dot2: "bg-accent-orange/30",
  },
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionLabel,
  onAction,
  className,
  variant = "default",
  accentColor = "cyan",
}: EmptyStateProps) {
  const isCompact = variant === "compact";
  const isCard = variant === "card";
  const isHero = variant === "hero";
  const colors = accentColors[accentColor];

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center text-center",
        isCompact ? "py-8" : isHero ? "py-24" : "py-16",
        isCard &&
          "rounded-xl border border-border/30 bg-gradient-to-b from-background-secondary/50 to-background",
        className
      )}
    >
      {/* Background decoration for hero variant */}
      {isHero && (
        <>
          {/* Grid pattern */}
          <div className="absolute inset-0 bg-grid opacity-30" />
          {/* Radial glow */}
          <div
            className={cn(
              "absolute top-0 left-1/2 -translate-x-1/2 w-96 h-48 blur-3xl opacity-30",
              `bg-gradient-to-b ${colors.glow}`
            )}
          />
        </>
      )}

      {/* Icon Section */}
      <div className="relative mb-6 animate-fade-in">
        {/* Outer glow ring */}
        <div
          className={cn(
            "absolute inset-0 rounded-full blur-2xl opacity-40",
            `bg-gradient-to-br ${colors.glow}`
          )}
          style={{ transform: "scale(2)" }}
        />

        {/* Animated ring for hero variant */}
        {isHero && (
          <div className="absolute inset-0 rounded-full animate-spin-slow">
            <div className="absolute inset-0 rounded-full border border-dashed border-border/30" style={{ transform: "scale(2.5)" }} />
          </div>
        )}

        {/* Icon container */}
        <div
          className={cn(
            "relative flex items-center justify-center rounded-2xl transition-transform duration-500 hover:scale-105",
            `bg-gradient-to-br ${colors.iconBg}`,
            `border ${colors.border}`,
            "shadow-2xl shadow-black/20",
            isCompact ? "h-14 w-14" : isHero ? "h-24 w-24" : "h-20 w-20"
          )}
        >
          {/* Inner glow */}
          <div className="absolute inset-2 rounded-xl bg-background/50 backdrop-blur-sm" />

          <Icon
            className={cn(
              "relative text-foreground-muted/80",
              isCompact ? "h-6 w-6" : isHero ? "h-10 w-10" : "h-8 w-8"
            )}
            strokeWidth={1.5}
          />
        </div>

        {/* Decorative orbiting dots */}
        <div className={cn("absolute -top-1 -right-1 h-2 w-2 rounded-full", colors.dot1)} />
        <div className={cn("absolute -bottom-1 -left-1 h-1.5 w-1.5 rounded-full", colors.dot2)} />
        {isHero && (
          <>
            <div className={cn("absolute top-1/2 -right-4 h-1 w-1 rounded-full animate-pulse", colors.dot1)} />
            <div className={cn("absolute -top-3 left-1/2 h-1.5 w-1.5 rounded-full animate-pulse", colors.dot2)} style={{ animationDelay: "0.5s" }} />
          </>
        )}
      </div>

      {/* Text Content */}
      <div className={cn("relative space-y-3", isHero ? "max-w-lg" : "max-w-md", "reveal-up")} style={{ animationDelay: '150ms' }}>
        <h3
          className={cn(
            "font-semibold tracking-tight text-foreground font-display",
            isCompact ? "text-base" : isHero ? "text-2xl" : "text-lg"
          )}
        >
          {title}
        </h3>

        {description && (
          <p
            className={cn(
              "text-foreground-muted leading-relaxed",
              isCompact ? "text-xs" : "text-sm"
            )}
          >
            {description}
          </p>
        )}
      </div>

      {/* Action Button */}
      {(action || (actionLabel && onAction)) && (
        <div className="relative mt-6 animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {action || (
            <Button
              onClick={onAction}
              variant="outline"
              className={cn(
                "bg-background-secondary/80 hover:bg-background-tertiary",
                "border-border/50 hover:border-border",
                "transition-all duration-200 hover:shadow-lg",
                "group gap-2"
              )}
            >
              <Sparkles className="h-4 w-4 opacity-60 group-hover:opacity-100 transition-opacity" />
              {actionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Inline empty state for tables/lists
export function EmptyRow({
  colSpan,
  message = "No data",
  icon: Icon = FileX,
}: {
  colSpan?: number;
  message?: string;
  icon?: LucideIcon;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="py-12 text-center"
      >
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-background-secondary border border-border/30">
            <Icon className="h-5 w-5 text-foreground-muted" strokeWidth={1.5} />
          </div>
          <span className="text-sm text-foreground-muted">{message}</span>
        </div>
      </td>
    </tr>
  );
}

// Search-specific empty state
export function NoResultsState({
  searchTerm,
  onClear,
  className,
}: {
  searchTerm?: string;
  onClear?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={Search}
      title="No results found"
      description={
        searchTerm
          ? `No matches for "${searchTerm}". Try adjusting your search or filters.`
          : "Try adjusting your search or filters to find what you're looking for."
      }
      actionLabel={onClear ? "Clear filters" : undefined}
      onAction={onClear}
      className={className}
      variant="compact"
      accentColor="purple"
    />
  );
}

// Loading/connecting state
export function ConnectingState({
  className,
}: {
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16", className)}>
      <div className="relative">
        {/* Animated rings */}
        <div className="absolute inset-0 rounded-full border-2 border-accent-primary/20 animate-ping" />
        <div className="absolute inset-0 rounded-full border-2 border-accent-primary/10 animate-ping" style={{ animationDelay: "0.5s" }} />

        <div className="relative flex items-center justify-center h-16 w-16 rounded-full bg-gradient-to-br from-background-secondary to-background-tertiary border border-border/30">
          <Zap className="h-7 w-7 text-accent-primary animate-pulse" />
        </div>
      </div>
      <p className="mt-4 text-sm text-foreground-muted">Connecting to system...</p>
    </div>
  );
}

// Data loading/syncing state
export function SyncingState({
  message = "Syncing data...",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-12", className)}>
      <div className="relative">
        <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-background-secondary to-background-tertiary border border-border/30 flex items-center justify-center">
          <Database className="h-6 w-6 text-accent-primary animate-pulse" />
        </div>
        {/* Orbiting dot */}
        <div className="absolute -inset-2 animate-spin-slow">
          <div className="absolute top-0 left-1/2 h-1.5 w-1.5 rounded-full bg-accent-primary" />
        </div>
      </div>
      <p className="mt-4 text-sm text-foreground-muted">{message}</p>
    </div>
  );
}
