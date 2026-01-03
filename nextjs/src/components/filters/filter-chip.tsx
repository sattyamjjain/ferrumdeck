"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilterChipProps {
  label: string;
  value: string;
  onRemove: () => void;
  color?: "default" | "blue" | "green" | "yellow" | "red" | "purple";
  className?: string;
}

const colorVariants = {
  default: "bg-background-tertiary border-border/30 text-foreground",
  blue: "bg-accent-blue/15 border-accent-blue/30 text-accent-blue",
  green: "bg-accent-green/15 border-accent-green/30 text-accent-green",
  yellow: "bg-accent-yellow/15 border-accent-yellow/30 text-accent-yellow",
  red: "bg-accent-red/15 border-accent-red/30 text-accent-red",
  purple: "bg-accent-purple/15 border-accent-purple/30 text-accent-purple",
} as const;

export function FilterChip({
  label,
  value,
  onRemove,
  color = "default",
  className,
}: FilterChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 h-6 px-2 rounded-md border text-xs font-medium transition-all",
        "animate-scale-in",
        colorVariants[color],
        className
      )}
    >
      <span className="text-muted-foreground">{label}:</span>
      <span className="max-w-[120px] truncate">{value}</span>
      <button
        onClick={onRemove}
        className={cn(
          "ml-0.5 p-0.5 rounded-sm transition-colors",
          "hover:bg-foreground/10",
          "focus:outline-none focus:ring-1 focus:ring-ring"
        )}
        aria-label={`Remove ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

interface FilterChipsContainerProps {
  children: React.ReactNode;
  onClearAll?: () => void;
  className?: string;
}

export function FilterChipsContainer({
  children,
  onClearAll,
  className,
}: FilterChipsContainerProps) {
  const childArray = React.Children.toArray(children);

  if (childArray.length === 0) {
    return null;
  }

  return (
    <div className={cn("flex items-center gap-2 flex-wrap", className)}>
      {children}
      {onClearAll && childArray.length > 1 && (
        <button
          onClick={onClearAll}
          className={cn(
            "text-xs text-muted-foreground hover:text-foreground transition-colors",
            "underline-offset-2 hover:underline"
          )}
        >
          Clear all
        </button>
      )}
    </div>
  );
}
