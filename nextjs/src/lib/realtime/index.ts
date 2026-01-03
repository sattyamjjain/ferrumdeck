/**
 * Real-time SSE Subscription Infrastructure
 *
 * This module provides a complete SSE (Server-Sent Events) subscription system
 * for the FerrumDeck dashboard with:
 *
 * - Type-safe channel definitions and event payloads
 * - Singleton subscription manager with automatic reconnection
 * - React hooks for easy subscription management
 * - Connection status tracking and heartbeat monitoring
 *
 * @example
 * ```tsx
 * import {
 *   useSubscription,
 *   buildRunsChannel,
 *   type RunsChannelEvent
 * } from "@/lib/realtime";
 *
 * function RunsList({ workspaceId }: { workspaceId: string }) {
 *   const { data, refetch } = useRuns();
 *
 *   const { status } = useSubscription(
 *     buildRunsChannel(workspaceId),
 *     (event: RunsChannelEvent) => {
 *       if (event.type === "run_created") {
 *         refetch();
 *       }
 *     }
 *   );
 *
 *   return (
 *     <div>
 *       <ConnectionStatus status={status} />
 *       <RunList runs={data} />
 *     </div>
 *   );
 * }
 * ```
 */

// ============================================================================
// Channel Definitions
// ============================================================================

export {
  // Channel builders
  buildRunsChannel,
  buildRunChannel,
  buildApprovalsChannel,
  buildAuditChannel,
  // Channel utilities
  parseChannelName,
  isValidChannelName,
  // Type guards
  isRunsChannelEvent,
  isRunChannelEvent,
  isApprovalsChannelEvent,
  isAuditChannelEvent,
} from "./channels";

export type {
  // Base types
  BaseSSEEvent,
  SSEEvent,
  ChannelType,
  ChannelDescriptor,
  ChannelEventMap,
  // Runs channel events
  RunsChannelEvent,
  RunStatusChangedEvent,
  RunCreatedEvent,
  RunCompletedEvent,
  // Run channel events
  RunChannelEvent,
  StepCreatedEvent,
  StepStatusChangedEvent,
  StepCompletedEvent,
  // Approvals channel events
  ApprovalsChannelEvent,
  ApprovalCreatedEvent,
  ApprovalResolvedEvent,
  // Audit channel events
  AuditChannelEvent,
  AuditEventCreatedEvent,
} from "./channels";

// ============================================================================
// Subscription Manager
// ============================================================================

export {
  SubscriptionManager,
  getSubscriptionManager,
} from "./subscription-manager";

export type {
  ConnectionStatus,
  EventCallback,
  StatusCallback,
  SubscriptionManagerConfig,
} from "./subscription-manager";

// ============================================================================
// React Hooks
// ============================================================================

export {
  useSubscription,
  useGlobalConnectionStatus,
  useSubscriptionManager,
} from "./use-subscription";

export type {
  UseSubscriptionOptions,
  UseSubscriptionResult,
} from "./use-subscription";
