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

// Reversibility-aware graduated response (DeepMind AI Control Roadmap R1-R3),
// plus the recorded decision itself.
//
// PUSHED FOR REAL as of 0.8.13 (issue #5). This was a wire shape with only a
// synthetic generator behind it; the gateway now emits it from
// `check_tool_policy`, and specifically from INSIDE the spawned audit write,
// after the row commits. That ordering is the reason `record_id` below is
// trustworthy: it is read off the inserted row, so an event carrying it is an
// event whose record already exists and can be fetched from
// `GET /v1/audit/{record_id}`.
//
// The four fields added here are additive. Every previously-defined field is
// still sent with the same meaning, so a consumer written against the old shape
// keeps working.
export interface PolicyResponseRecordedEvent extends BaseSSEEvent {
  type: "policy.response.recorded";
  payload: {
    run_id: string;
    tool_name: string;
    /** allow_and_log (R1) | allow_under_budget (R2) | require_approval (R3) */
    response_level: "allow_and_log" | "allow_under_budget" | "require_approval";
    reversibility: "reversible" | "costly" | "irreversible";
    at: string;

    // --- added 0.8.13, all optional so the old shape still type-checks -----

    /**
     * The EFFECTIVE decision, after the reversibility ladder folds into the
     * allowlist verdict: `Allow` | `AllowWithWarning` | `RequiresApproval` |
     * `Deny`.
     */
    decision?: string;
    /**
     * The allowlist's own verdict before the ladder. Differs from `decision`
     * exactly when a gate escalated, and that difference is the interesting
     * part — an `Allow` held for a human is not the same event as an `Allow`.
     */
    raw_decision?: string;
    /**
     * The rule that fired: the stable `source` of the winning verdict from the
     * precedence resolver, e.g. `allowlist:denied`.
     *
     * `null` is meaningful and is NOT a missing value: it means no rule matched
     * and deny-by-default is what refused the call. Render it as such rather
     * than as a blank.
     */
    rule?: string | null;
    /** The winning verdict's human-readable reason. */
    reason?: string;
    /** How long the enforcement check took, end to end. */
    latency_ms?: number;
    /** The audit row this event describes. Resolvable via GET /v1/audit/{id}. */
    record_id?: string;
    /** The row's position in its tenant's hash chain. */
    chain_seq?: number | null;
    /** When the row committed (not when the decision was computed). */
    recorded_at?: string;
    airlock_risk_score?: number;
    /**
     * True when Airlock ran in shadow: the violation was RECORDED and the call
     * was still allowed. Without this a reader cannot tell a blocked call from
     * a logged one, which is the difference the whole product turns on.
     */
    shadow_mode?: boolean;
    /** Content hash of the policy document in force, for reconstruction. */
    policy_hash?: string;
  };
}

/**
 * The stream telling you it is not complete.
 *
 * Emitted when a reconnect cursor falls outside the gateway's replay buffer,
 * when a subscriber lags the fan-out, or when the BFF cannot reach the gateway
 * at all. It exists because on an audit surface a silent stream and a broken
 * stream look identical, and treating a gap as quiet is the failure that makes
 * SSE worse than polling.
 */
export interface StreamGapEvent extends BaseSSEEvent {
  type: "stream.gap" | "stream.degraded" | "stream.error" | "stream.connected";
  payload: {
    message: string;
    reason?: string;
    requested_after?: number;
    skipped?: number;
    buffer_size?: number;
    issue?: string;
  };
}

export type RunChannelEvent =
  | StepCreatedEvent
  | StepStatusChangedEvent
  | StepCompletedEvent
  | PolicyResponseRecordedEvent
  | StreamGapEvent;

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
    event.type === "step_completed" ||
    // Was missing since PolicyResponseRecordedEvent was added to the union.
    // The guard returned false for a variant it was supposed to admit, so any
    // consumer narrowing through it discarded every policy event. Harmless
    // while the channel carried heartbeats only; it would have silently thrown
    // away the real ones the moment the gateway started pushing.
    event.type === "policy.response.recorded" ||
    isStreamGapEvent(event)
  );
}

/** A gap/degradation notice rather than a governance event. */
export function isStreamGapEvent(event: SSEEvent): event is StreamGapEvent {
  return (
    event.type === "stream.gap" ||
    event.type === "stream.degraded" ||
    event.type === "stream.error" ||
    event.type === "stream.connected"
  );
}

/** The recorded policy decision, pushed by the gateway after it committed. */
export function isPolicyResponseRecordedEvent(
  event: SSEEvent,
): event is PolicyResponseRecordedEvent {
  return event.type === "policy.response.recorded";
}

export function isApprovalsChannelEvent(event: SSEEvent): event is ApprovalsChannelEvent {
  return event.type === "approval_created" || event.type === "approval_resolved";
}

export function isAuditChannelEvent(event: SSEEvent): event is AuditChannelEvent {
  return event.type === "audit_event_created";
}
