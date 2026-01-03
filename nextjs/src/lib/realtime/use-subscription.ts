"use client";

/**
 * React Hook for SSE Subscriptions
 *
 * Provides a convenient hook interface for subscribing to SSE channels
 * with automatic cleanup and connection status tracking.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from "react";
import {
  SubscriptionManager,
  getSubscriptionManager,
  type ConnectionStatus,
  type EventCallback,
} from "./subscription-manager";
import type { SSEEvent, ChannelDescriptor } from "./channels";

// ============================================================================
// Types
// ============================================================================

export interface UseSubscriptionOptions {
  /** Whether the subscription is enabled (default: true) */
  enabled?: boolean;
  /** Called when the connection status changes */
  onStatusChange?: (status: ConnectionStatus) => void;
}

export interface UseSubscriptionResult {
  /** Current connection status for the channel */
  status: ConnectionStatus;
  /** Manually trigger a reconnection */
  reconnect: () => void;
  /** Manually disconnect from the channel */
  disconnect: () => void;
  /** Whether the connection is active (connected or connecting) */
  isConnected: boolean;
  /** Whether the connection is stale (no recent heartbeat) */
  isStale: boolean;
}

// ============================================================================
// Main Hook
// ============================================================================

/**
 * Subscribe to an SSE channel with automatic cleanup.
 *
 * @param channel - Channel name or ChannelDescriptor
 * @param onMessage - Callback for incoming events
 * @param options - Additional options
 *
 * @example
 * ```tsx
 * function RunsPage() {
 *   const { data, refetch } = useRuns();
 *   const { status, reconnect } = useSubscription(
 *     buildRunsChannel("ws_123"),
 *     (event) => {
 *       if (event.type === "run_created") {
 *         refetch();
 *       }
 *     }
 *   );
 *
 *   return <div>Status: {status}</div>;
 * }
 * ```
 */
export function useSubscription<T extends SSEEvent>(
  channel: string | ChannelDescriptor<T>,
  onMessage: EventCallback<T>,
  options: UseSubscriptionOptions = {}
): UseSubscriptionResult {
  const { enabled = true, onStatusChange } = options;

  // Extract channel name
  const channelName = typeof channel === "string" ? channel : channel.name;

  // Track connection status
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  // Use ref for callback to avoid re-subscribing on callback changes
  const callbackRef = useRef(onMessage);
  useEffect(() => {
    callbackRef.current = onMessage;
  }, [onMessage]);

  // Use ref for status callback
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // Get manager instance
  const managerRef = useRef<SubscriptionManager | null>(null);

  // Initialize manager on mount
  useEffect(() => {
    managerRef.current = getSubscriptionManager();
    return () => {
      managerRef.current = null;
    };
  }, []);

  // Subscribe to channel
  useEffect(() => {
    if (!enabled || typeof window === "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus("disconnected");
      return;
    }

    const manager = getSubscriptionManager();
    managerRef.current = manager;

    // Update initial status
    setStatus(manager.getChannelStatus(channelName));

    // Subscribe with stable callback wrapper
    const unsubscribe = manager.subscribe<T>(channelName, (event) => {
      callbackRef.current(event);
    });

    // Poll for status changes (simpler than implementing channel-specific listeners)
    const statusInterval = setInterval(() => {
      const currentStatus = manager.getChannelStatus(channelName);
      setStatus((prev) => {
        if (prev !== currentStatus) {
          onStatusChangeRef.current?.(currentStatus);
          return currentStatus;
        }
        return prev;
      });
    }, 1000);

    return () => {
      unsubscribe();
      clearInterval(statusInterval);
    };
  }, [channelName, enabled]);

  // Reconnect function
  const reconnect = useCallback(() => {
    managerRef.current?.reconnect(channelName);
  }, [channelName]);

  // Disconnect function
  const disconnect = useCallback(() => {
    managerRef.current?.disconnect(channelName);
  }, [channelName]);

  // Computed properties
  const result = useMemo<UseSubscriptionResult>(
    () => ({
      status,
      reconnect,
      disconnect,
      isConnected: status === "connected" || status === "connecting",
      isStale: status === "stale",
    }),
    [status, reconnect, disconnect]
  );

  return result;
}

// ============================================================================
// Specialized Hooks
// ============================================================================

/**
 * Hook to track global SSE connection status across all channels.
 *
 * @example
 * ```tsx
 * function StatusIndicator() {
 *   const { status, reconnectAll } = useGlobalConnectionStatus();
 *   return <span>{status}</span>;
 * }
 * ```
 */
export function useGlobalConnectionStatus(): {
  status: ConnectionStatus;
  reconnectAll: () => void;
  disconnectAll: () => void;
  activeChannels: string[];
} {
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [activeChannels, setActiveChannels] = useState<string[]>([]);

  const managerRef = useRef<SubscriptionManager | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const manager = getSubscriptionManager();
    managerRef.current = manager;

    // Subscribe to status changes
    const unsubscribe = manager.onStatusChange((newStatus) => {
      setStatus(newStatus);
      setActiveChannels(manager.getActiveChannels());
    });

    // Initial state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(manager.getGlobalStatus());
    setActiveChannels(manager.getActiveChannels());

    return unsubscribe;
  }, []);

  const reconnectAll = useCallback(() => {
    managerRef.current?.reconnectAll();
  }, []);

  const disconnectAll = useCallback(() => {
    managerRef.current?.disconnectAll();
  }, []);

  return useMemo(
    () => ({
      status,
      reconnectAll,
      disconnectAll,
      activeChannels,
    }),
    [status, reconnectAll, disconnectAll, activeChannels]
  );
}

// ============================================================================
// Utility Hooks
// ============================================================================

/**
 * Hook that provides a callback to subscribe to multiple channels.
 * Useful when channel names are dynamic or created at runtime.
 *
 * @example
 * ```tsx
 * function RunDetail({ runId }: { runId: string }) {
 *   const { subscribe } = useSubscriptionManager();
 *
 *   useEffect(() => {
 *     return subscribe(buildRunChannel(runId), (event) => {
 *       console.log(event);
 *     });
 *   }, [runId, subscribe]);
 * }
 * ```
 */
export function useSubscriptionManager(): {
  subscribe: <T extends SSEEvent>(
    channel: string | ChannelDescriptor<T>,
    callback: EventCallback<T>
  ) => () => void;
  getStatus: (channel: string) => ConnectionStatus;
  reconnect: (channel: string) => void;
} {
  const managerRef = useRef<SubscriptionManager | null>(null);

  useEffect(() => {
    managerRef.current = getSubscriptionManager();
    return () => {
      managerRef.current = null;
    };
  }, []);

  const subscribe = useCallback(
    <T extends SSEEvent>(
      channel: string | ChannelDescriptor<T>,
      callback: EventCallback<T>
    ): (() => void) => {
      const channelName = typeof channel === "string" ? channel : channel.name;
      return getSubscriptionManager().subscribe(channelName, callback);
    },
    []
  );

  const getStatus = useCallback((channel: string): ConnectionStatus => {
    return managerRef.current?.getChannelStatus(channel) ?? "disconnected";
  }, []);

  const reconnect = useCallback((channel: string): void => {
    managerRef.current?.reconnect(channel);
  }, []);

  return useMemo(
    () => ({
      subscribe,
      getStatus,
      reconnect,
    }),
    [subscribe, getStatus, reconnect]
  );
}
