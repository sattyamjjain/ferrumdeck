"use client";

import { cn } from "@/lib/utils";

interface SkeletonProps extends React.ComponentProps<"div"> {
  variant?: "default" | "shimmer" | "pulse" | "glow";
  rounded?: "none" | "sm" | "md" | "lg" | "xl" | "full";
}

function Skeleton({
  className,
  variant = "shimmer",
  rounded = "md",
  ...props
}: SkeletonProps) {
  const roundedClasses = {
    none: "rounded-none",
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
    xl: "rounded-xl",
    full: "rounded-full",
  };

  const variantClasses = {
    default: "bg-background-tertiary animate-pulse",
    shimmer: "skeleton-shimmer",
    pulse: "bg-background-tertiary animate-pulse",
    glow: "skeleton-glow",
  };

  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden",
        roundedClasses[rounded],
        variantClasses[variant],
        className
      )}
      {...props}
    />
  );
}

// Card skeleton with command center styling
function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/30",
        "bg-gradient-to-br from-background-secondary/80 to-background",
        className
      )}
    >
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
      {/* Shimmer overlay for extra polish */}
      <div className="absolute inset-0 skeleton-shimmer-overlay" />
    </div>
  );
}

// Table row skeleton
function SkeletonTableRow({
  columns = 5,
  className,
}: {
  columns?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-4",
            i === 0 ? "w-4" : i === 1 ? "w-24" : "flex-1 max-w-[120px]"
          )}
        />
      ))}
    </div>
  );
}

// List item skeleton
function SkeletonListItem({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg",
        "bg-background-secondary/50 border border-border/20",
        className
      )}
    >
      <Skeleton className="h-10 w-10 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

// Metric skeleton for stats
function SkeletonMetric({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-16" />
    </div>
  );
}

// Chart placeholder skeleton
function SkeletonChart({
  className,
  height = 200,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg",
        "bg-background-secondary/30 border border-border/30",
        className
      )}
      style={{ height }}
    >
      {/* Chart area background */}
      <div className="absolute inset-0 p-4">
        {/* Y-axis labels */}
        <div className="absolute left-4 top-4 bottom-4 flex flex-col justify-between">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-2 w-6" variant="pulse" />
          ))}
        </div>

        {/* X-axis labels */}
        <div className="absolute bottom-4 left-12 right-4 flex justify-between">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-2 w-8" variant="pulse" />
          ))}
        </div>

        {/* Fake bars/lines area */}
        <div className="absolute left-12 right-4 top-4 bottom-10 flex items-end justify-around gap-2">
          {[60, 80, 45, 90, 70, 55].map((h, i) => (
            <Skeleton
              key={i}
              className="flex-1 rounded-t"
              style={{
                height: `${h}%`,
                animationDelay: `${i * 100}ms`,
              }}
            />
          ))}
        </div>
      </div>

      {/* Shimmer overlay */}
      <div className="absolute inset-0 skeleton-shimmer-overlay" />
    </div>
  );
}

// Text block skeleton
function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-3",
            i === lines - 1 ? "w-2/3" : "w-full"
          )}
          style={{
            animationDelay: `${i * 50}ms`,
          }}
        />
      ))}
    </div>
  );
}

// Avatar skeleton
function SkeletonAvatar({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClasses = {
    sm: "h-8 w-8",
    md: "h-10 w-10",
    lg: "h-12 w-12",
  };

  return (
    <Skeleton
      className={cn(sizeClasses[size], className)}
      rounded="full"
    />
  );
}

// Badge skeleton
function SkeletonBadge({ className }: { className?: string }) {
  return (
    <Skeleton className={cn("h-5 w-16", className)} rounded="full" />
  );
}

export {
  Skeleton,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonListItem,
  SkeletonMetric,
  SkeletonChart,
  SkeletonText,
  SkeletonAvatar,
  SkeletonBadge,
};
