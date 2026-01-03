"use client";

/**
 * Connection Status Indicator
 *
 * Displays the current SSE connection status with visual indicators:
 * - Green dot (pulsing): Connected - Live updates active
 * - Yellow dot: Stale - Live updates paused, reconnecting soon
 * - Red dot: Disconnected - No connection, click to reconnect
 * - Gray dot (pulsing): Connecting - Establishing connection
 *
 * Click behavior:
 * - When stale or disconnected: Triggers manual reconnection
 * - When connected: Shows connection info tooltip
 */

import { useCallback, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useGlobalConnectionStatus } from "@/lib/realtime";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ============================================================================
// Types
// ============================================================================

interface ConnectionStatusProps {
  /** Show extended status text (default: true on desktop, false on mobile) */
  showText?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

type CombinedStatus = "connected" | "stale" | "disconnected" | "connecting" | "degraded";

// ============================================================================
// Status Configuration
// ============================================================================

const STATUS_CONFIG: Record<
  CombinedStatus,
  {
    dotClass: string;
    text: string;
    description: string;
    canReconnect: boolean;
  }
> = {
  connected: {
    dotClass: "bg-accent-green animate-pulse",
    text: "Connected",
    description: "Live updates are active",
    canReconnect: false,
  },
  stale: {
    dotClass: "bg-accent-yellow",
    text: "Live updates paused",
    description: "Connection is stale. Click to reconnect.",
    canReconnect: true,
  },
  disconnected: {
    dotClass: "bg-accent-red",
    text: "Disconnected",
    description: "No connection to server. Click to reconnect.",
    canReconnect: true,
  },
  connecting: {
    dotClass: "bg-muted-foreground animate-pulse",
    text: "Connecting...",
    description: "Establishing connection to server",
    canReconnect: false,
  },
  degraded: {
    dotClass: "bg-accent-orange",
    text: "Degraded",
    description: "Gateway unreachable. Some features may be unavailable.",
    canReconnect: true,
  },
};

// ============================================================================
// Component
// ============================================================================

export function ConnectionStatus({
  showText = true,
  className,
  size = "md",
}: ConnectionStatusProps) {
  const [isReconnecting, setIsReconnecting] = useState(false);

  // Health check for gateway connectivity
  const { isError: isGatewayError, isLoading: isGatewayLoading } = useQuery({
    queryKey: ["health"],
    queryFn: () => fetch("/api/health").then((r) => r.json()),
    refetchInterval: 10000,
    retry: false,
  });

  // SSE connection status
  const { status: sseStatus, reconnectAll, activeChannels } = useGlobalConnectionStatus();

  // Determine combined status
  const getCombinedStatus = (): CombinedStatus => {
    // If gateway is down, show degraded
    if (isGatewayError) {
      return "degraded";
    }

    // If gateway is loading, show connecting
    if (isGatewayLoading) {
      return "connecting";
    }

    // If we're in a reconnecting state, show connecting
    if (isReconnecting) {
      return "connecting";
    }

    // Otherwise, use SSE status (but only if we have active channels)
    if (activeChannels.length === 0) {
      // No active SSE subscriptions, just check gateway health
      return "connected";
    }

    return sseStatus as CombinedStatus;
  };

  const combinedStatus = getCombinedStatus();
  const config = STATUS_CONFIG[combinedStatus];

  // Handle reconnection
  const handleReconnect = useCallback(async () => {
    if (!config.canReconnect || isReconnecting) return;

    setIsReconnecting(true);

    try {
      // Reconnect all SSE channels
      reconnectAll();

      // Wait a bit before allowing another reconnect
      await new Promise((resolve) => setTimeout(resolve, 2000));
    } finally {
      setIsReconnecting(false);
    }
  }, [config.canReconnect, isReconnecting, reconnectAll]);

  // Size classes
  const sizeClasses = {
    sm: {
      dot: "h-1.5 w-1.5",
      text: "text-xs",
      gap: "gap-1.5",
    },
    md: {
      dot: "h-2 w-2",
      text: "text-sm",
      gap: "gap-2",
    },
    lg: {
      dot: "h-2.5 w-2.5",
      text: "text-base",
      gap: "gap-2.5",
    },
  };

  const sizes = sizeClasses[size];

  const content = (
    <div
      className={cn(
        "flex items-center",
        sizes.gap,
        sizes.text,
        config.canReconnect && "cursor-pointer hover:opacity-80",
        className
      )}
      onClick={config.canReconnect ? handleReconnect : undefined}
      role={config.canReconnect ? "button" : undefined}
      tabIndex={config.canReconnect ? 0 : undefined}
      onKeyDown={(e) => {
        if (config.canReconnect && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          handleReconnect();
        }
      }}
    >
      <span
        className={cn("rounded-full transition-colors duration-200", sizes.dot, config.dotClass)}
        aria-hidden="true"
      />
      {showText && (
        <span className="text-muted-foreground whitespace-nowrap">{config.text}</span>
      )}
    </div>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{content}</TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-xs">
        <div className="space-y-1">
          <p className="font-medium">{config.text}</p>
          <p className="text-xs text-muted-foreground">{config.description}</p>
          {activeChannels.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Active subscriptions: {activeChannels.length}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

// ============================================================================
// Compact Variant
// ============================================================================

/**
 * Compact connection status indicator (just the dot)
 * Useful for tight layouts like mobile headers
 */
export function ConnectionStatusDot({
  className,
  size = "md",
}: Omit<ConnectionStatusProps, "showText">) {
  return <ConnectionStatus showText={false} className={className} size={size} />;
}

// ============================================================================
// SSE-Only Status (for pages with active subscriptions)
// ============================================================================

interface SSEConnectionStatusProps {
  /** Channel being monitored */
  channel?: string;
  /** Show extended status text */
  showText?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

/**
 * SSE-only connection status for components that are actively subscribed
 * Shows the status of SSE channels without gateway health check
 */
export function SSEConnectionStatus({
  showText = true,
  className,
  size = "sm",
}: SSEConnectionStatusProps) {
  const { status, reconnectAll, activeChannels } = useGlobalConnectionStatus();

  const config = STATUS_CONFIG[status as CombinedStatus] || STATUS_CONFIG.disconnected;

  const sizeClasses = {
    sm: { dot: "h-1.5 w-1.5", text: "text-xs", gap: "gap-1.5" },
    md: { dot: "h-2 w-2", text: "text-sm", gap: "gap-2" },
    lg: { dot: "h-2.5 w-2.5", text: "text-base", gap: "gap-2.5" },
  };

  const sizes = sizeClasses[size];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex items-center",
            sizes.gap,
            sizes.text,
            config.canReconnect && "cursor-pointer hover:opacity-80",
            className
          )}
          onClick={config.canReconnect ? reconnectAll : undefined}
          role={config.canReconnect ? "button" : undefined}
          tabIndex={config.canReconnect ? 0 : undefined}
        >
          <span
            className={cn("rounded-full", sizes.dot, config.dotClass)}
            aria-hidden="true"
          />
          {showText && (
            <span className="text-muted-foreground whitespace-nowrap">
              {status === "connected" ? "Live" : config.text}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <p>{config.description}</p>
        {activeChannels.length > 0 && (
          <p className="text-xs opacity-70 mt-1">
            Channels: {activeChannels.join(", ")}
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
