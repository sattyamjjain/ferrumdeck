"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function RunsConsoleSkeleton() {
  return (
    <div className="flex flex-col h-full space-y-4 animate-fade-in">
      {/* Stats bar skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-8 w-20" />
        </div>
        <Skeleton className="h-9 w-24" />
      </div>

      {/* Saved views skeleton */}
      <div className="flex items-center gap-1 p-1 rounded-lg bg-background-secondary border border-border/30 w-fit">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton
            key={i}
            className="h-7 w-20"
            rounded="md"
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>

      {/* Filter bar skeleton */}
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 max-w-md" />
        <Skeleton className="h-9 w-[140px]" />
        <Skeleton className="h-9 w-[160px]" />
      </div>

      {/* Table skeleton */}
      <div className="flex-1 min-h-0 rounded-xl border border-border/40 bg-gradient-to-b from-background-secondary/60 to-background overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-4 px-4 py-3 border-b border-border/30 bg-background-secondary/50">
          <Skeleton className="h-4 w-4" variant="glow" />
          <Skeleton className="h-4 w-[140px]" />
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[100px]" />
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[90px]" />
          <Skeleton className="h-4 w-[70px]" />
          <Skeleton className="h-4 w-[80px]" />
          <Skeleton className="h-4 w-[50px]" />
        </div>

        {/* Table rows with staggered animation */}
        <div className="p-4 space-y-1 skeleton-stagger">
          {Array.from({ length: 8 }).map((_, i) => (
            <RunRowSkeleton key={i} index={i} />
          ))}
        </div>
      </div>

      {/* Pagination skeleton */}
      <div className="flex items-center justify-between px-2">
        <Skeleton className="h-4 w-28" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8" rounded="lg" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-8 w-8" rounded="lg" />
        </div>
        <Skeleton className="h-4 w-20" />
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function RunRowSkeleton({ index }: { index: number }) {
  return (
    <div
      className={cn(
        "flex items-center gap-4 py-3 px-2 rounded-lg",
        "hover:bg-background-secondary/30 transition-colors"
      )}
    >
      {/* Checkbox */}
      <Skeleton className="h-4 w-4" rounded="sm" />

      {/* Run ID */}
      <div className="flex items-center gap-2 w-[140px]">
        <Skeleton className="h-2 w-2" rounded="full" variant="glow" />
        <Skeleton className="h-4 w-20" />
      </div>

      {/* Status */}
      <Skeleton className="h-6 w-20" rounded="full" />

      {/* Agent */}
      <div className="flex items-center gap-2 w-[120px]">
        <Skeleton className="h-6 w-6" rounded="lg" />
        <Skeleton className="h-4 w-16" />
      </div>

      {/* Task preview */}
      <Skeleton className="h-4 flex-1 max-w-[200px]" />

      {/* Steps */}
      <Skeleton className="h-4 w-12" />

      {/* Cost */}
      <Skeleton className="h-4 w-14" />

      {/* Duration */}
      <Skeleton className="h-4 w-12" />

      {/* Actions */}
      <Skeleton className="h-7 w-7" rounded="lg" />
    </div>
  );
}

// Compact skeleton for inline loading
export function RunsTableLoadingOverlay() {
  return (
    <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center z-10">
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="h-10 w-10 rounded-full border-2 border-accent-primary/20 border-t-accent-primary animate-spin" />
          <div className="absolute inset-0 h-10 w-10 rounded-full border-2 border-transparent border-t-accent-cyan/50 animate-spin" style={{ animationDirection: "reverse", animationDuration: "1.5s" }} />
        </div>
        <span className="text-sm text-foreground-muted animate-pulse">Loading runs...</span>
      </div>
    </div>
  );
}

// Card-style skeleton for grid views
export function RunCardSkeleton() {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/30 bg-gradient-to-br from-background-secondary/80 to-background p-4">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10" rounded="xl" variant="glow" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <Skeleton className="h-6 w-16" rounded="full" />
        </div>

        {/* Content */}
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-border/20">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-8" />
          </div>
          <Skeleton className="h-7 w-20" rounded="lg" />
        </div>
      </div>

      {/* Shimmer overlay */}
      <div className="absolute inset-0 skeleton-shimmer-overlay" />
    </div>
  );
}
