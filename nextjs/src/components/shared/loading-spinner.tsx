"use client";

import { cn } from "@/lib/utils";

interface LoadingSpinnerProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}

const sizeClasses = {
  sm: "h-4 w-4",
  md: "h-6 w-6",
  lg: "h-8 w-8",
  xl: "h-12 w-12",
};

const borderSizes = {
  sm: "border-2",
  md: "border-2",
  lg: "border-3",
  xl: "border-4",
};

export function LoadingSpinner({ className, size = "md" }: LoadingSpinnerProps) {
  return (
    <div
      className={cn(
        "rounded-full animate-spin",
        "border-accent-blue/30 border-t-accent-blue",
        sizeClasses[size],
        borderSizes[size],
        className
      )}
      role="status"
      aria-label="Loading"
    />
  );
}

// Full page loading with branding
export function LoadingPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] animate-fade-in">
      {/* Orbital loader */}
      <div className="relative">
        {/* Outer ring */}
        <div className="h-16 w-16 rounded-full border-2 border-border/30" />

        {/* Spinning accent */}
        <div
          className="absolute inset-0 h-16 w-16 rounded-full border-2 border-transparent border-t-accent-blue animate-spin"
          style={{ animationDuration: "1s" }}
        />

        {/* Inner spinning accent (opposite direction) */}
        <div
          className="absolute inset-2 h-12 w-12 rounded-full border-2 border-transparent border-b-accent-purple animate-spin"
          style={{ animationDuration: "1.5s", animationDirection: "reverse" }}
        />

        {/* Center dot */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-2 w-2 rounded-full bg-accent-cyan animate-pulse" />
        </div>
      </div>

      <p className="mt-6 text-sm text-muted-foreground animate-pulse">
        Loading...
      </p>
    </div>
  );
}

// Skeleton loading blocks
interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-md skeleton-shimmer",
        className
      )}
      style={style}
    />
  );
}

// Skeleton line for text
export function SkeletonLine({
  width = "100%",
  height = "h-4",
}: {
  width?: string;
  height?: string;
}) {
  return (
    <div
      className={cn("rounded skeleton-shimmer", height)}
      style={{ width }}
    />
  );
}

// Card skeleton
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-border/30 bg-card/30 p-4 space-y-3",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

// Table row skeleton - uses deterministic widths based on column index
const SKELETON_WIDTHS = [75, 60, 85, 70, 65, 80, 72, 68];

export function SkeletonTableRow({ columns = 4 }: { columns?: number }) {
  return (
    <tr className="border-b border-border/30">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="py-3 px-4">
          <Skeleton className="h-4" style={{ width: `${SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]}%` }} />
        </td>
      ))}
    </tr>
  );
}

// Generic skeleton row for lists
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 py-3 px-4 border-b border-border/30">
      <Skeleton className="h-10 w-10 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/4" />
      </div>
      <Skeleton className="h-6 w-16" />
    </div>
  );
}
