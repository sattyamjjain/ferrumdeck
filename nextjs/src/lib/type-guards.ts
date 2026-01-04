/**
 * Type guards for runtime type checking.
 * These provide type-safe narrowing for API responses and data validation.
 */

import type { Run, RunStatus, Step, StepType, StepStatus } from "@/types/run";
import type { RunsResponse } from "@/lib/api/runs";

// =============================================================================
// Run Type Guards
// =============================================================================

/** Valid run statuses from the backend */
export const RUN_STATUSES: readonly RunStatus[] = [
  "created",
  "queued",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "cancelled",
  "timeout",
  "budget_killed",
  "policy_blocked",
] as const;

/** Active run statuses that indicate the run is still in progress */
export const ACTIVE_RUN_STATUSES: readonly RunStatus[] = [
  "created",
  "queued",
  "running",
  "waiting_approval",
] as const;

/** Terminal run statuses that indicate the run has finished */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  "completed",
  "failed",
  "cancelled",
  "timeout",
  "budget_killed",
  "policy_blocked",
] as const;

/** Check if a value is a valid run status */
export function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && RUN_STATUSES.includes(value as RunStatus);
}

/** Check if a run is in an active state */
export function isRunActive(status: string): boolean {
  return isRunStatus(status) && ACTIVE_RUN_STATUSES.includes(status);
}

/** Check if a run is in a terminal state */
export function isRunTerminal(status: string): boolean {
  return isRunStatus(status) && TERMINAL_RUN_STATUSES.includes(status);
}

/** Type guard for Run object */
export function isRun(value: unknown): value is Run {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    isRunStatus(obj.status) &&
    typeof obj.created_at === "string"
  );
}

/** Type guard for RunsResponse */
export function isRunsResponse(value: unknown): value is RunsResponse {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    Array.isArray(obj.runs) &&
    typeof obj.total === "number" &&
    typeof obj.has_more === "boolean"
  );
}

// =============================================================================
// Step Type Guards
// =============================================================================

/** Valid step types - matches Rust StepType enum */
export const STEP_TYPES: readonly StepType[] = [
  "llm",
  "tool",
  "retrieval",
  "human",
  "approval",
] as const;

/** Valid step statuses - matches Rust StepStatus enum */
export const STEP_STATUSES: readonly StepStatus[] = [
  "pending",
  "running",
  "waiting_approval",
  "completed",
  "failed",
  "skipped",
] as const;

/** Active step statuses */
export const ACTIVE_STEP_STATUSES: readonly StepStatus[] = [
  "pending",
  "running",
  "waiting_approval",
] as const;

/** Check if a value is a valid step type */
export function isStepType(value: unknown): value is StepType {
  return typeof value === "string" && STEP_TYPES.includes(value as StepType);
}

/** Check if a value is a valid step status */
export function isStepStatus(value: unknown): value is StepStatus {
  return typeof value === "string" && STEP_STATUSES.includes(value as StepStatus);
}

/** Check if a step is in an active state */
export function isStepActive(status: string): boolean {
  return isStepStatus(status) && ACTIVE_STEP_STATUSES.includes(status as StepStatus);
}

/** Type guard for Step object */
export function isStep(value: unknown): value is Step {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.id === "string" &&
    typeof obj.run_id === "string" &&
    isStepType(obj.step_type) &&
    isStepStatus(obj.status)
  );
}

// =============================================================================
// API Response Utilities
// =============================================================================

/** Extract error message from unknown error */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "An unexpected error occurred";
}

/** Check if an error is a network/connection error */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    return (
      error.message.includes("fetch") ||
      error.message.includes("network") ||
      error.message.includes("Failed to fetch")
    );
  }
  return false;
}
