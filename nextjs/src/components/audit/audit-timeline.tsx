"use client";

import { useRef, useCallback, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Link from "next/link";
import {
  Play,
  Activity,
  Shield,
  CheckCircle,
  XCircle,
  Clock,
  User,
  Bot,
  Key,
  Settings,
  Wrench,
  AlertTriangle,
  DollarSign,
  LogIn,
  LogOut,
  UserPlus,
  UserMinus,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import type { AuditEvent, AuditEventType, AuditActorType } from "@/types/audit";
import { getEventTypeColors } from "@/types/audit";
import {
  formatAuditTimestamp,
  getFullTimestamp,
  getEventTypeDisplayName,
  getActorTypeDisplayName,
  getResourceTypeDisplayName,
} from "@/hooks/use-audit";

// ============================================================================
// Types
// ============================================================================

interface AuditTimelineProps {
  events: AuditEvent[];
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onEventClick?: (event: AuditEvent) => void;
  className?: string;
}

// ============================================================================
// Icon Components
// ============================================================================

function EventIconDisplay({ eventType, className }: { eventType: AuditEventType; className?: string }) {
  // Run events
  if (eventType.startsWith("run.")) {
    if (eventType === "run.completed") return <CheckCircle className={className} />;
    if (eventType === "run.failed" || eventType === "run.timeout" || eventType === "run.budget_killed")
      return <XCircle className={className} />;
    return <Play className={className} />;
  }
  // Step events
  if (eventType.startsWith("step.")) {
    if (eventType === "step.retry") return <RotateCcw className={className} />;
    return <Activity className={className} />;
  }
  // Policy events
  if (eventType.startsWith("policy.")) {
    if (eventType === "policy.denied") return <XCircle className={className} />;
    if (eventType === "policy.allowed") return <CheckCircle className={className} />;
    return <Shield className={className} />;
  }
  // Approval events
  if (eventType.startsWith("approval.")) {
    if (eventType === "approval.approved" || eventType === "approval.auto_approved")
      return <CheckCircle className={className} />;
    if (eventType === "approval.rejected") return <XCircle className={className} />;
    return <Shield className={className} />;
  }
  // Budget events
  if (eventType.startsWith("budget.")) {
    if (eventType === "budget.exceeded") return <AlertTriangle className={className} />;
    return <DollarSign className={className} />;
  }
  // Agent events
  if (eventType.startsWith("agent.")) return <Bot className={className} />;
  // Tool events
  if (eventType.startsWith("tool.")) return <Wrench className={className} />;
  // Admin events
  if (eventType.startsWith("admin.")) {
    if (eventType === "admin.login") return <LogIn className={className} />;
    if (eventType === "admin.logout") return <LogOut className={className} />;
    if (eventType === "admin.user_created") return <UserPlus className={className} />;
    if (eventType === "admin.user_deleted") return <UserMinus className={className} />;
    return <Settings className={className} />;
  }
  // API Key events
  if (eventType.startsWith("api_key.")) return <Key className={className} />;
  // Settings events
  if (eventType.startsWith("settings.")) return <Settings className={className} />;

  return <Activity className={className} />;
}

function ActorIconDisplay({ actorType, className }: { actorType: AuditActorType; className?: string }) {
  switch (actorType) {
    case "user":
      return <User className={className} />;
    case "api_key":
      return <Key className={className} />;
    case "agent":
      return <Bot className={className} />;
    case "system":
      return <Settings className={className} />;
    default:
      return <User className={className} />;
  }
}

// ============================================================================
// Event Row Component
// ============================================================================

interface AuditEventRowProps {
  event: AuditEvent;
  onClick?: () => void;
}

function AuditEventRow({ event, onClick }: AuditEventRowProps) {
  const eventType = event.event_type || event.action;
  const colors = getEventTypeColors(eventType);

  // Get target link if applicable
  const getTargetLink = useCallback(() => {
    if (event.run_id) {
      return `/runs/${event.run_id}`;
    }
    const targetType = event.target_type || event.resource_type;
    const targetId = event.target_id || event.resource_id;
    switch (targetType) {
      case "run":
        return `/runs/${targetId}`;
      case "agent":
        return `/agents/${targetId}`;
      case "approval":
        return `/approvals`;
      default:
        return null;
    }
  }, [event]);

  // Get actor link if applicable
  const getActorLink = useCallback(() => {
    if (event.actor_type === "agent") {
      return `/agents/${event.actor_id}`;
    }
    return null;
  }, [event.actor_type, event.actor_id]);

  const targetLink = getTargetLink();
  const actorLink = getActorLink();

  // Generate description if not provided
  const description = useMemo(() => {
    if (event.description) return event.description;
    const targetType = event.target_type || event.resource_type;
    const targetName = event.target_name || event.resource_id;
    return `${getEventTypeDisplayName(eventType)} on ${getResourceTypeDisplayName(targetType)} ${targetName}`;
  }, [event, eventType]);

  return (
    <div
      className={cn(
        "group flex items-center gap-4 px-4 py-3 border-b border-slate-800/50",
        "hover:bg-slate-800/30 cursor-pointer transition-colors",
        "animate-fade-in"
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          onClick?.();
        }
      }}
    >
      {/* Timestamp */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 w-[100px] flex-shrink-0">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              {formatAuditTimestamp(event.occurred_at)}
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {getFullTimestamp(event.occurred_at)}
        </TooltipContent>
      </Tooltip>

      {/* Event Type Badge */}
      <Badge
        variant="outline"
        className={cn("gap-1.5 font-medium flex-shrink-0 w-[140px]", colors.bg, colors.text, colors.border)}
      >
        <EventIconDisplay eventType={eventType} className="h-3 w-3" />
        <span className="truncate">{getEventTypeDisplayName(eventType)}</span>
      </Badge>

      {/* Actor */}
      <div className="flex items-center gap-2 w-[140px] flex-shrink-0">
        <div className="p-1 rounded bg-slate-800">
          <ActorIconDisplay actorType={event.actor_type} className="h-3 w-3 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          {actorLink ? (
            <Link
              href={actorLink}
              className="text-sm font-medium truncate hover:text-primary transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {event.actor_name || event.actor_id}
            </Link>
          ) : (
            <p className="text-sm font-medium truncate">{event.actor_name || event.actor_id}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {getActorTypeDisplayName(event.actor_type)}
          </p>
        </div>
      </div>

      {/* Target */}
      <div className="flex items-center gap-2 w-[140px] flex-shrink-0">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {getResourceTypeDisplayName(event.target_type || event.resource_type)}
          </p>
          {targetLink ? (
            <Link
              href={targetLink}
              className="text-sm font-mono text-slate-400 truncate hover:text-primary transition-colors block"
              onClick={(e) => e.stopPropagation()}
            >
              {(event.target_id || event.resource_id).slice(0, 12)}...
            </Link>
          ) : (
            <p className="text-sm font-mono text-slate-500 truncate">
              {(event.target_id || event.resource_id).slice(0, 12)}...
            </p>
          )}
        </div>
      </div>

      {/* Description */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-muted-foreground truncate">{description}</p>
      </div>

      {/* Trace ID (if present) */}
      {event.trace_id && (
        <Tooltip>
          <TooltipTrigger asChild>
            <code className="text-xs font-mono text-slate-500 bg-slate-800/50 px-1.5 py-0.5 rounded flex-shrink-0">
              {event.trace_id.slice(0, 8)}
            </code>
          </TooltipTrigger>
          <TooltipContent side="top" className="text-xs font-mono">
            {event.trace_id}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ============================================================================
// Skeleton Row
// ============================================================================

function AuditEventRowSkeleton() {
  return (
    <div className="flex items-center gap-4 px-4 py-3 border-b border-slate-800/50">
      <Skeleton className="h-4 w-[100px]" />
      <Skeleton className="h-6 w-[140px]" />
      <div className="flex items-center gap-2 w-[140px]">
        <Skeleton className="h-6 w-6 rounded" />
        <div>
          <Skeleton className="h-4 w-20 mb-1" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>
      <div className="w-[140px]">
        <Skeleton className="h-3 w-12 mb-1" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-4 flex-1" />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function AuditTimeline({
  events,
  isLoading = false,
  hasMore = false,
  onLoadMore,
  onEventClick,
  className,
}: AuditTimelineProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  // Virtual list configuration
  const virtualizer = useVirtualizer({
    count: events.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 52, // Estimated row height in pixels
    overscan: 10,
  });

  // Handle scroll for infinite loading
  const handleScroll = useCallback(() => {
    if (!parentRef.current || !hasMore || !onLoadMore) return;

    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;

    // Load more when 80% scrolled
    if (scrollPercentage > 0.8) {
      onLoadMore();
    }
  }, [hasMore, onLoadMore]);

  // Empty state
  if (!isLoading && events.length === 0) {
    return (
      <div className={cn("flex flex-col items-center justify-center py-16", className)}>
        <div className="p-3 rounded-full bg-slate-800/50 mb-4">
          <Activity className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium mb-1">No audit events found</h3>
        <p className="text-sm text-muted-foreground">
          Try adjusting your filters or check back later.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={parentRef}
      className={cn("overflow-auto rounded-lg border border-slate-700/50", className)}
      onScroll={handleScroll}
    >
      {/* Header */}
      <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/50 border-b border-slate-700/50 sticky top-0 z-10">
        <div className="w-[100px] text-xs font-medium text-slate-400">Time</div>
        <div className="w-[140px] text-xs font-medium text-slate-400">Event</div>
        <div className="w-[140px] text-xs font-medium text-slate-400">Actor</div>
        <div className="w-[140px] text-xs font-medium text-slate-400">Target</div>
        <div className="flex-1 text-xs font-medium text-slate-400">Description</div>
        <div className="w-[70px] text-xs font-medium text-slate-400">Trace</div>
      </div>

      {/* Virtualized content */}
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const event = events[virtualItem.index];
          return (
            <div
              key={event.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualItem.size}px`,
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <AuditEventRow event={event} onClick={() => onEventClick?.(event)} />
            </div>
          );
        })}
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="border-t border-slate-800/50">
          {Array.from({ length: 5 }).map((_, i) => (
            <AuditEventRowSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Load more indicator */}
      {hasMore && !isLoading && (
        <div className="flex items-center justify-center py-4 border-t border-slate-800/50">
          <button
            onClick={onLoadMore}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            Load more events...
          </button>
        </div>
      )}
    </div>
  );
}

export { AuditEventRow, AuditEventRowSkeleton };
