import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ============================================================================
// Cost & Token Formatting
// ============================================================================

export function formatCost(cents: number | undefined): string {
  if (cents === undefined || cents === null) return "-";
  if (cents < 100) return `${cents}c`;
  const dollars = cents / 100;
  if (dollars >= 1000) return `$${(dollars / 1000).toFixed(1)}K`;
  return `$${dollars.toFixed(2)}`;
}

export function formatCostUSD(usd: number | undefined): string {
  if (usd === undefined || usd === null) return "-";
  if (usd < 0.01) return `$${(usd * 100).toFixed(1)}c`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(tokens: number | undefined): string {
  if (tokens === undefined || tokens === null) return "-";
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
  return String(tokens);
}

// ============================================================================
// Time & Duration Formatting
// ============================================================================

export function formatTimeAgo(dateString: string | undefined | null): string {
  if (!dateString) return "-";

  const date = new Date(dateString);

  // Check for invalid date
  if (isNaN(date.getTime())) return "-";

  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 0) return "just now"; // Future date
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms === null) return "-";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function formatDurationBetween(
  startDate: string | undefined,
  endDate: string | undefined
): string {
  if (!startDate) return "-";
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date();
  const ms = end.getTime() - start.getTime();
  return formatDuration(ms);
}

export function formatDateTime(dateString: string): string {
  return format(new Date(dateString), "MMM d, yyyy HH:mm:ss");
}

export function formatDateShort(dateString: string): string {
  return format(new Date(dateString), "MMM d, HH:mm");
}

export function formatRelativeTime(dateString: string): string {
  return formatDistanceToNow(new Date(dateString), { addSuffix: true });
}

// ============================================================================
// ID & String Formatting
// ============================================================================

export function truncateId(id: string, length: number = 12): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

export function formatRunId(id: string): string {
  // run_01HX7K2M... -> run_01HX...
  if (id.startsWith("run_") && id.length > 12) {
    return `run_${id.slice(4, 8)}...`;
  }
  return truncateId(id, 12);
}

export function formatStepId(id: string): string {
  if (id.startsWith("stp_") && id.length > 12) {
    return `stp_${id.slice(4, 8)}...`;
  }
  return truncateId(id, 12);
}

export function getTaskFromInput(input: Record<string, unknown> | undefined): string {
  if (!input) return "No task";
  if (typeof input.task === "string") return input.task;
  return JSON.stringify(input).slice(0, 100);
}

// ============================================================================
// Percentage & Number Formatting
// ============================================================================

export function formatPercentage(value: number, decimals: number = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
  return String(value);
}

// ============================================================================
// Status Helpers
// ============================================================================

export type RunStatusCategory = "active" | "success" | "error" | "pending";

export function getRunStatusCategory(status: string): RunStatusCategory {
  switch (status) {
    case "running":
    case "waiting_approval":
      return "active";
    case "completed":
      return "success";
    case "failed":
    case "cancelled":
    case "timeout":
    case "budget_killed":
    case "policy_blocked":
      return "error";
    default:
      return "pending";
  }
}

export function isRunActive(status: string): boolean {
  return status === "running" || status === "waiting_approval";
}

export function isRunTerminal(status: string): boolean {
  return ["completed", "failed", "cancelled", "timeout", "budget_killed", "policy_blocked"].includes(status);
}

// ============================================================================
// URL & Deep Link Helpers
// ============================================================================

export function buildRunUrl(runId: string, wsId?: string): string {
  if (wsId) return `/workspaces/${wsId}/runs/${runId}`;
  return `/runs/${runId}`;
}

export function buildStepUrl(runId: string, stepId: string, wsId?: string): string {
  if (wsId) return `/workspaces/${wsId}/runs/${runId}/steps/${stepId}`;
  return `/runs/${runId}/steps/${stepId}`;
}

export function buildAgentUrl(agentId: string, wsId?: string): string {
  if (wsId) return `/workspaces/${wsId}/agents/${agentId}`;
  return `/agents/${agentId}`;
}

export function buildApprovalUrl(approvalId: string, wsId?: string): string {
  if (wsId) return `/workspaces/${wsId}/approvals/${approvalId}`;
  return `/approvals/${approvalId}`;
}

export function buildAuditEventUrl(eventId: string, wsId?: string): string {
  if (wsId) return `/workspaces/${wsId}/audit/events/${eventId}`;
  return `/audit/events/${eventId}`;
}

// ============================================================================
// Copy to Clipboard
// ============================================================================

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Risk Level Helpers
// ============================================================================

export type RiskLevel = "low" | "medium" | "high" | "critical";

export function getRiskLevelColor(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "text-accent-green";
    case "medium":
      return "text-accent-yellow";
    case "high":
      return "text-accent-orange";
    case "critical":
      return "text-accent-red";
  }
}

export function getRiskLevelBgColor(level: RiskLevel): string {
  switch (level) {
    case "low":
      return "bg-accent-green/15 border-accent-green/30";
    case "medium":
      return "bg-accent-yellow/15 border-accent-yellow/30";
    case "high":
      return "bg-accent-orange/15 border-accent-orange/30";
    case "critical":
      return "bg-accent-red/15 border-accent-red/30";
  }
}
