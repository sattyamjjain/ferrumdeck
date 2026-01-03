/**
 * SSE Subscription Manager
 *
 * A singleton manager for handling Server-Sent Events connections with:
 * - Automatic reconnection with exponential backoff
 * - Connection status tracking
 * - Multiple subscriber support per channel
 * - Heartbeat monitoring
 */

import type { SSEEvent } from "./channels";

// ============================================================================
// Types
// ============================================================================

/** Connection status states */
export type ConnectionStatus = "connecting" | "connected" | "stale" | "disconnected";

/** Callback function for receiving events */
export type EventCallback<T = SSEEvent> = (event: T) => void;

/** Callback function for connection status changes */
export type StatusCallback = (status: ConnectionStatus) => void;

/** Internal subscriber tracking */
interface Subscriber {
  id: string;
  callback: EventCallback;
}

/** Internal channel state */
interface ChannelState {
  eventSource: EventSource | null;
  subscribers: Map<string, Subscriber>;
  status: ConnectionStatus;
  reconnectAttempts: number;
  reconnectTimeoutId: ReturnType<typeof setTimeout> | null;
  lastEventTime: number;
  heartbeatTimeoutId: ReturnType<typeof setTimeout> | null;
}

/** Configuration options for the subscription manager */
export interface SubscriptionManagerConfig {
  /** Base URL for SSE endpoints (defaults to /api/sse) */
  baseUrl: string;
  /** Initial reconnection delay in ms (default: 1000) */
  initialReconnectDelay: number;
  /** Maximum reconnection delay in ms (default: 30000) */
  maxReconnectDelay: number;
  /** Heartbeat timeout in ms - connection marked stale if exceeded (default: 45000) */
  heartbeatTimeout: number;
  /** Maximum reconnection attempts before giving up (default: Infinity) */
  maxReconnectAttempts: number;
}

const DEFAULT_CONFIG: SubscriptionManagerConfig = {
  baseUrl: "/api/sse",
  initialReconnectDelay: 1000,
  maxReconnectDelay: 30000,
  heartbeatTimeout: 45000, // 30s heartbeat + 15s buffer
  maxReconnectAttempts: Infinity,
};

// ============================================================================
// Subscription Manager Class
// ============================================================================

/**
 * Singleton manager for SSE subscriptions.
 *
 * Usage:
 * ```ts
 * const manager = SubscriptionManager.getInstance();
 * const unsubscribe = manager.subscribe("runs:ws_123", (event) => {
 *   console.log("Event received:", event);
 * });
 *
 * // Later...
 * unsubscribe();
 * ```
 */
export class SubscriptionManager {
  private static instance: SubscriptionManager | null = null;

  private config: SubscriptionManagerConfig;
  private channels: Map<string, ChannelState>;
  private statusListeners: Set<StatusCallback>;
  private globalStatus: ConnectionStatus;
  private subscriberIdCounter: number;

  private constructor(config: Partial<SubscriptionManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.channels = new Map();
    this.statusListeners = new Set();
    this.globalStatus = "disconnected";
    this.subscriberIdCounter = 0;
  }

  /**
   * Get the singleton instance of the SubscriptionManager
   */
  public static getInstance(config?: Partial<SubscriptionManagerConfig>): SubscriptionManager {
    if (!SubscriptionManager.instance) {
      SubscriptionManager.instance = new SubscriptionManager(config);
    }
    return SubscriptionManager.instance;
  }

  /**
   * Reset the singleton instance (useful for testing)
   */
  public static resetInstance(): void {
    if (SubscriptionManager.instance) {
      SubscriptionManager.instance.disconnectAll();
      SubscriptionManager.instance = null;
    }
  }

  /**
   * Subscribe to a channel with a callback
   * @returns Unsubscribe function
   */
  public subscribe<T extends SSEEvent>(
    channel: string,
    callback: EventCallback<T>
  ): () => void {
    const subscriberId = `sub_${++this.subscriberIdCounter}`;

    // Get or create channel state
    let channelState = this.channels.get(channel);
    if (!channelState) {
      channelState = this.createChannelState();
      this.channels.set(channel, channelState);
    }

    // Add subscriber
    channelState.subscribers.set(subscriberId, {
      id: subscriberId,
      callback: callback as EventCallback,
    });

    // Connect if this is the first subscriber
    if (channelState.subscribers.size === 1) {
      this.connect(channel, channelState);
    }

    // Return unsubscribe function
    return () => {
      this.unsubscribe(channel, subscriberId);
    };
  }

  /**
   * Manually reconnect a channel
   */
  public reconnect(channel: string): void {
    const channelState = this.channels.get(channel);
    if (!channelState) return;

    // Clear any pending reconnection
    if (channelState.reconnectTimeoutId) {
      clearTimeout(channelState.reconnectTimeoutId);
      channelState.reconnectTimeoutId = null;
    }

    // Reset reconnection attempts
    channelState.reconnectAttempts = 0;

    // Disconnect and reconnect
    this.closeEventSource(channelState);
    this.connect(channel, channelState);
  }

  /**
   * Manually reconnect all channels
   */
  public reconnectAll(): void {
    for (const channel of this.channels.keys()) {
      this.reconnect(channel);
    }
  }

  /**
   * Disconnect a specific channel
   */
  public disconnect(channel: string): void {
    const channelState = this.channels.get(channel);
    if (!channelState) return;

    this.closeEventSource(channelState);
    this.updateChannelStatus(channel, channelState, "disconnected");
  }

  /**
   * Disconnect all channels
   */
  public disconnectAll(): void {
    for (const [channel, channelState] of this.channels.entries()) {
      this.closeEventSource(channelState);
      this.updateChannelStatus(channel, channelState, "disconnected");
    }
    this.channels.clear();
  }

  /**
   * Get the connection status for a specific channel
   */
  public getChannelStatus(channel: string): ConnectionStatus {
    return this.channels.get(channel)?.status ?? "disconnected";
  }

  /**
   * Get the global connection status (worst status among all channels)
   */
  public getGlobalStatus(): ConnectionStatus {
    return this.globalStatus;
  }

  /**
   * Listen for global status changes
   */
  public onStatusChange(callback: StatusCallback): () => void {
    this.statusListeners.add(callback);
    // Immediately notify with current status
    callback(this.globalStatus);
    return () => {
      this.statusListeners.delete(callback);
    };
  }

  /**
   * Get the number of active subscribers for a channel
   */
  public getSubscriberCount(channel: string): number {
    return this.channels.get(channel)?.subscribers.size ?? 0;
  }

  /**
   * Get all active channel names
   */
  public getActiveChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private createChannelState(): ChannelState {
    return {
      eventSource: null,
      subscribers: new Map(),
      status: "disconnected",
      reconnectAttempts: 0,
      reconnectTimeoutId: null,
      lastEventTime: 0,
      heartbeatTimeoutId: null,
    };
  }

  private unsubscribe(channel: string, subscriberId: string): void {
    const channelState = this.channels.get(channel);
    if (!channelState) return;

    channelState.subscribers.delete(subscriberId);

    // Disconnect if no more subscribers
    if (channelState.subscribers.size === 0) {
      this.closeEventSource(channelState);
      this.channels.delete(channel);
      this.updateGlobalStatus();
    }
  }

  private connect(channel: string, channelState: ChannelState): void {
    if (typeof window === "undefined") {
      // SSR - don't connect
      return;
    }

    // Update status to connecting
    this.updateChannelStatus(channel, channelState, "connecting");

    // Build URL
    const url = `${this.config.baseUrl}/${encodeURIComponent(channel)}`;

    try {
      const eventSource = new EventSource(url);
      channelState.eventSource = eventSource;

      eventSource.onopen = () => {
        channelState.reconnectAttempts = 0;
        channelState.lastEventTime = Date.now();
        this.updateChannelStatus(channel, channelState, "connected");
        this.startHeartbeatMonitor(channel, channelState);
      };

      eventSource.onmessage = (event) => {
        channelState.lastEventTime = Date.now();

        // Reset stale status if we were stale
        if (channelState.status === "stale") {
          this.updateChannelStatus(channel, channelState, "connected");
        }

        // Parse and dispatch event
        try {
          const data = JSON.parse(event.data) as SSEEvent;

          // Handle heartbeat events silently
          if ((data as { type: string }).type === "heartbeat") {
            return;
          }

          // Notify all subscribers
          for (const subscriber of channelState.subscribers.values()) {
            try {
              subscriber.callback(data);
            } catch (error) {
              console.error(
                `[SubscriptionManager] Subscriber error on channel ${channel}:`,
                error
              );
            }
          }
        } catch (error) {
          console.error(
            `[SubscriptionManager] Failed to parse event on channel ${channel}:`,
            error
          );
        }
      };

      eventSource.onerror = () => {
        this.handleConnectionError(channel, channelState);
      };
    } catch (error) {
      console.error(`[SubscriptionManager] Failed to create EventSource:`, error);
      this.handleConnectionError(channel, channelState);
    }
  }

  private handleConnectionError(channel: string, channelState: ChannelState): void {
    this.closeEventSource(channelState);
    this.updateChannelStatus(channel, channelState, "disconnected");

    // Check if we should attempt reconnection
    if (channelState.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.warn(
        `[SubscriptionManager] Max reconnection attempts reached for channel ${channel}`
      );
      return;
    }

    // Calculate backoff delay
    const delay = Math.min(
      this.config.initialReconnectDelay * Math.pow(2, channelState.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    channelState.reconnectAttempts++;

    console.log(
      `[SubscriptionManager] Reconnecting to ${channel} in ${delay}ms (attempt ${channelState.reconnectAttempts})`
    );

    // Schedule reconnection
    channelState.reconnectTimeoutId = setTimeout(() => {
      channelState.reconnectTimeoutId = null;
      if (channelState.subscribers.size > 0) {
        this.connect(channel, channelState);
      }
    }, delay);
  }

  private closeEventSource(channelState: ChannelState): void {
    // Clear timeouts
    if (channelState.reconnectTimeoutId) {
      clearTimeout(channelState.reconnectTimeoutId);
      channelState.reconnectTimeoutId = null;
    }

    if (channelState.heartbeatTimeoutId) {
      clearTimeout(channelState.heartbeatTimeoutId);
      channelState.heartbeatTimeoutId = null;
    }

    // Close event source
    if (channelState.eventSource) {
      channelState.eventSource.close();
      channelState.eventSource = null;
    }
  }

  private startHeartbeatMonitor(channel: string, channelState: ChannelState): void {
    // Clear existing monitor
    if (channelState.heartbeatTimeoutId) {
      clearTimeout(channelState.heartbeatTimeoutId);
    }

    const checkHeartbeat = () => {
      const timeSinceLastEvent = Date.now() - channelState.lastEventTime;

      if (timeSinceLastEvent > this.config.heartbeatTimeout) {
        // Connection is stale
        if (channelState.status === "connected") {
          this.updateChannelStatus(channel, channelState, "stale");
        }
      }

      // Schedule next check
      if (channelState.eventSource && channelState.eventSource.readyState !== EventSource.CLOSED) {
        channelState.heartbeatTimeoutId = setTimeout(checkHeartbeat, 10000); // Check every 10s
      }
    };

    channelState.heartbeatTimeoutId = setTimeout(checkHeartbeat, this.config.heartbeatTimeout);
  }

  private updateChannelStatus(
    channel: string,
    channelState: ChannelState,
    status: ConnectionStatus
  ): void {
    if (channelState.status === status) return;

    channelState.status = status;
    this.updateGlobalStatus();
  }

  private updateGlobalStatus(): void {
    // Calculate worst status across all channels
    let worstStatus: ConnectionStatus = "connected";

    if (this.channels.size === 0) {
      worstStatus = "disconnected";
    } else {
      for (const channelState of this.channels.values()) {
        if (channelState.status === "disconnected") {
          worstStatus = "disconnected";
          break;
        } else if (channelState.status === "connecting") {
          worstStatus = "connecting";
        } else if (channelState.status === "stale" && worstStatus === "connected") {
          worstStatus = "stale";
        }
      }
    }

    if (this.globalStatus === worstStatus) return;

    this.globalStatus = worstStatus;

    // Notify all status listeners
    for (const listener of this.statusListeners) {
      try {
        listener(worstStatus);
      } catch (error) {
        console.error("[SubscriptionManager] Status listener error:", error);
      }
    }
  }
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Get the singleton SubscriptionManager instance
 */
export function getSubscriptionManager(
  config?: Partial<SubscriptionManagerConfig>
): SubscriptionManager {
  return SubscriptionManager.getInstance(config);
}
