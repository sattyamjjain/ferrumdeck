/**
 * SSE Channel Definitions and Type-Safe Builders
 *
 * This module defines the channel types for real-time subscriptions and provides
 * type-safe builders for constructing channel names with proper event payloads.
 */

import type { Run, Step, RunStatus, StepStatus } from "@/types/run";
import type { ApprovalRequest, ApprovalStatus } from "@/types/approval";

// ============================================================================
// Event Type Definitions
// ============================================================================

/** Base event structure for all SSE events */
export interface BaseSSEEvent {
  id: string;
  timestamp: string;
  channel: string;
}

// Runs channel events (runs:{wsId})
export interface RunStatusChangedEvent extends BaseSSEEvent {
  type: "run_status_changed";
  payload: {
    run_id: string;
    previous_status: RunStatus;
    new_status: RunStatus;
    status_reason?: string;
  };
}

export interface RunCreatedEvent extends BaseSSEEvent {
  type: "run_created";
  payload: {
    run: Run;
  };
}

export interface RunCompletedEvent extends BaseSSEEvent {
  type: "run_completed";
  payload: {
    run_id: string;
    status: RunStatus;
    output?: unknown;
    error?: unknown;
    usage?: {
      input_tokens: number;
      output_tokens: number;
      tool_calls: number;
      cost_cents: number;
    };
  };
}

export type RunsChannelEvent =
  | RunStatusChangedEvent
  | RunCreatedEvent
  | RunCompletedEvent;

// Run channel events (run:{runId})
export interface StepCreatedEvent extends BaseSSEEvent {
  type: "step_created";
  payload: {
    step: Step;
  };
}

export interface StepStatusChangedEvent extends BaseSSEEvent {
  type: "step_status_changed";
  payload: {
    step_id: string;
    run_id: string;
    previous_status: StepStatus;
    new_status: StepStatus;
  };
}

export interface StepCompletedEvent extends BaseSSEEvent {
  type: "step_completed";
  payload: {
    step_id: string;
    run_id: string;
    status: StepStatus;
    output?: unknown;
    error?: unknown;
    input_tokens?: number;
    output_tokens?: number;
  };
}

export type RunChannelEvent =
  | StepCreatedEvent
  | StepStatusChangedEvent
  | StepCompletedEvent;

// Approvals channel events (approvals:{wsId})
export interface ApprovalCreatedEvent extends BaseSSEEvent {
  type: "approval_created";
  payload: {
    approval: ApprovalRequest;
  };
}

export interface ApprovalResolvedEvent extends BaseSSEEvent {
  type: "approval_resolved";
  payload: {
    approval_id: string;
    status: ApprovalStatus;
    resolved_by?: string;
    resolved_at: string;
    resolution_note?: string;
  };
}

export type ApprovalsChannelEvent = ApprovalCreatedEvent | ApprovalResolvedEvent;

// Audit channel events (audit:{wsId})
export interface AuditEventCreatedEvent extends BaseSSEEvent {
  type: "audit_event_created";
  payload: {
    id: string;
    event_type: string;
    actor_type: string;
    actor_id: string;
    resource_type: string;
    resource_id: string;
    action: string;
    metadata?: Record<string, unknown>;
    created_at: string;
  };
}

export type AuditChannelEvent = AuditEventCreatedEvent;

// Union of all channel events
export type SSEEvent =
  | RunsChannelEvent
  | RunChannelEvent
  | ApprovalsChannelEvent
  | AuditChannelEvent;

// ============================================================================
// Channel Type Mappings
// ============================================================================

/**
 * Maps channel patterns to their event types for type safety
 */
export interface ChannelEventMap {
  runs: RunsChannelEvent;
  run: RunChannelEvent;
  approvals: ApprovalsChannelEvent;
  audit: AuditChannelEvent;
}

export type ChannelType = keyof ChannelEventMap;

// ============================================================================
// Channel Builders
// ============================================================================

/**
 * Channel descriptor with type information
 */
export interface ChannelDescriptor<T extends SSEEvent> {
  /** Full channel name for subscription */
  name: string;
  /** Channel type for type discrimination */
  type: ChannelType;
  /** Phantom type parameter for event typing */
  _eventType?: T;
}

/**
 * Build a runs channel for workspace-level run events.
 * Events: RunStatusChanged, RunCreated, RunCompleted
 */
export function buildRunsChannel(workspaceId: string): ChannelDescriptor<RunsChannelEvent> {
  return {
    name: `runs:${workspaceId}`,
    type: "runs",
  };
}

/**
 * Build a run channel for individual run events.
 * Events: StepCreated, StepStatusChanged, StepCompleted
 */
export function buildRunChannel(runId: string): ChannelDescriptor<RunChannelEvent> {
  return {
    name: `run:${runId}`,
    type: "run",
  };
}

/**
 * Build an approvals channel for workspace-level approval events.
 * Events: ApprovalCreated, ApprovalResolved
 */
export function buildApprovalsChannel(workspaceId: string): ChannelDescriptor<ApprovalsChannelEvent> {
  return {
    name: `approvals:${workspaceId}`,
    type: "approvals",
  };
}

/**
 * Build an audit channel for workspace-level audit events.
 * Events: EventCreated
 */
export function buildAuditChannel(workspaceId: string): ChannelDescriptor<AuditChannelEvent> {
  return {
    name: `audit:${workspaceId}`,
    type: "audit",
  };
}

// ============================================================================
// Channel Parsing
// ============================================================================

/**
 * Parse a channel name to extract type and identifier
 */
export function parseChannelName(channelName: string): {
  type: ChannelType;
  identifier: string;
} | null {
  const parts = channelName.split(":");
  if (parts.length !== 2) return null;

  const [type, identifier] = parts;
  if (!type || !identifier) return null;

  if (type === "runs" || type === "run" || type === "approvals" || type === "audit") {
    return { type, identifier };
  }

  return null;
}

/**
 * Validate if a channel name is well-formed
 */
export function isValidChannelName(channelName: string): boolean {
  return parseChannelName(channelName) !== null;
}

// ============================================================================
// Event Type Guards
// ============================================================================

export function isRunsChannelEvent(event: SSEEvent): event is RunsChannelEvent {
  return (
    event.type === "run_status_changed" ||
    event.type === "run_created" ||
    event.type === "run_completed"
  );
}

export function isRunChannelEvent(event: SSEEvent): event is RunChannelEvent {
  return (
    event.type === "step_created" ||
    event.type === "step_status_changed" ||
    event.type === "step_completed"
  );
}

export function isApprovalsChannelEvent(event: SSEEvent): event is ApprovalsChannelEvent {
  return event.type === "approval_created" || event.type === "approval_resolved";
}

export function isAuditChannelEvent(event: SSEEvent): event is AuditChannelEvent {
  return event.type === "audit_event_created";
}
