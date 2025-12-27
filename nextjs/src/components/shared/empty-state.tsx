"use client";

import { LucideIcon } from "lucide-react";
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
  variant?: "default" | "compact" | "card";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionLabel,
  onAction,
  className,
  variant = "default",
}: EmptyStateProps) {
  const isCompact = variant === "compact";
  const isCard = variant === "card";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center animate-fade-in",
        isCompact ? "py-8" : "py-16",
        isCard &&
          "rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm",
        className
      )}
    >
      {/* Decorative background elements */}
      <div className="relative mb-6">
        {/* Outer glow ring */}
        <div
          className={cn(
            "absolute inset-0 rounded-full opacity-20 blur-xl",
            "bg-gradient-to-br from-accent-blue via-accent-purple to-accent-cyan"
          )}
          style={{
            transform: "scale(1.5)",
          }}
        />

        {/* Icon container */}
        <div
          className={cn(
            "relative flex items-center justify-center rounded-2xl",
            "bg-gradient-to-br from-background-secondary to-background-tertiary",
            "border border-border/50 shadow-lg shadow-black/20",
            isCompact ? "h-14 w-14" : "h-20 w-20"
          )}
        >
          <Icon
            className={cn(
              "text-muted-foreground/70",
              isCompact ? "h-6 w-6" : "h-8 w-8"
            )}
            strokeWidth={1.5}
          />
        </div>

        {/* Subtle decorative dots */}
        <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-accent-purple/40" />
        <div className="absolute -bottom-1 -left-1 h-1.5 w-1.5 rounded-full bg-accent-cyan/40" />
      </div>

      <div className="space-y-2 max-w-md">
        <h3
          className={cn(
            "font-semibold tracking-tight text-foreground",
            isCompact ? "text-base" : "text-lg"
          )}
        >
          {title}
        </h3>

        {description && (
          <p
            className={cn(
              "text-muted-foreground leading-relaxed",
              isCompact ? "text-xs" : "text-sm"
            )}
          >
            {description}
          </p>
        )}
      </div>

      {/* Action button */}
      {(action || (actionLabel && onAction)) && (
        <div className="mt-6">
          {action || (
            <Button
              onClick={onAction}
              variant="outline"
              className="bg-background-secondary hover:bg-background-tertiary border-border/50"
            >
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
}: {
  colSpan?: number;
  message?: string;
}) {
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="py-12 text-center text-sm text-muted-foreground"
      >
        {message}
      </td>
    </tr>
  );
}
