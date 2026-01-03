"use client";

import { useQuery, useMutation, useInfiniteQuery } from "@tanstack/react-query";
import type {
  AuditEvent,
  AuditEventFilters,
  AuditCursorParams,
  ListAuditEventsResponse,
  GetAuditEventResponse,
  AuditExportRequest,
  AuditExportResponse,
  AuditEventType,
  AuditActorType,
  AuditResourceType,
} from "@/types/audit";

// ============================================================================
// API Functions
// ============================================================================

async function fetchAuditEvents(
  filters: AuditEventFilters = {},
  cursor?: AuditCursorParams
): Promise<ListAuditEventsResponse> {
  const params = new URLSearchParams();

  // Search
  if (filters.search) params.set("search", filters.search);

  // Event types (multi-select)
  if (filters.event_types?.length) {
    filters.event_types.forEach((type) => params.append("event_type", type));
  }

  // Actor filters
  if (filters.actor_type) params.set("actor_type", filters.actor_type);
  if (filters.actor_id) params.set("actor_id", filters.actor_id);

  // Target filters
  if (filters.target_type) params.set("target_type", filters.target_type);
  if (filters.target_id) params.set("target_id", filters.target_id);

  // Context filters
  if (filters.project_id) params.set("project_id", filters.project_id);
  if (filters.run_id) params.set("run_id", filters.run_id);

  // Date range
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);

  // Legacy compatibility
  if (filters.action) params.set("action", filters.action);
  if (filters.resource_type) params.set("resource_type", filters.resource_type);
  if (filters.resource_id) params.set("resource_id", filters.resource_id);

  // Cursor pagination
  if (cursor?.cursor) params.set("cursor", cursor.cursor);
  if (cursor?.limit) params.set("limit", String(cursor.limit));

  const res = await fetch(`/api/v1/audit?${params.toString()}`);

  if (!res.ok) {
    throw new Error("Failed to fetch audit events");
  }

  return res.json();
}

async function fetchAuditEvent(eventId: string): Promise<GetAuditEventResponse> {
  const res = await fetch(`/api/v1/audit/${eventId}`);

  if (!res.ok) {
    throw new Error("Failed to fetch audit event");
  }

  return res.json();
}

async function exportAuditEvents(request: AuditExportRequest): Promise<AuditExportResponse> {
  const res = await fetch("/api/v1/audit/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    throw new Error("Failed to export audit events");
  }

  return res.json();
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for fetching audit events with filters and cursor-based pagination
 */
export function useAuditEvents(filters: AuditEventFilters = {}, limit: number = 50) {
  return useInfiniteQuery({
    queryKey: ["audit-events", filters, limit],
    queryFn: ({ pageParam }) =>
      fetchAuditEvents(filters, { cursor: pageParam, limit }),
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.next_cursor : undefined,
    initialPageParam: undefined as string | undefined,
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

/**
 * Hook for fetching audit events with simple query (no infinite scroll)
 */
export function useAuditEventsSimple(filters: AuditEventFilters = {}) {
  return useQuery({
    queryKey: ["audit-events-simple", filters],
    queryFn: () => fetchAuditEvents(filters),
    refetchInterval: 10000,
  });
}

/**
 * Hook for fetching a single audit event
 */
export function useAuditEvent(eventId: string | undefined) {
  return useQuery({
    queryKey: ["audit-event", eventId],
    queryFn: () => fetchAuditEvent(eventId!),
    enabled: !!eventId,
  });
}

/**
 * Hook for exporting audit events
 */
export function useExportAudit() {
  return useMutation({
    mutationFn: exportAuditEvents,
    onSuccess: (data) => {
      if (data.download_url) {
        // Trigger download from URL
        window.open(data.download_url, "_blank");
      } else if (data.data) {
        // Create download from data
        const blob = new Blob(
          [
            data.format === "json"
              ? JSON.stringify(data.data, null, 2)
              : convertToCSV(data.data),
          ],
          {
            type: data.format === "json" ? "application/json" : "text/csv",
          }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.${data.format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    },
  });
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Convert audit events to CSV format
 */
function convertToCSV(events: AuditEvent[]): string {
  if (events.length === 0) return "";

  const headers = [
    "id",
    "event_type",
    "actor_type",
    "actor_id",
    "actor_name",
    "target_type",
    "target_id",
    "target_name",
    "description",
    "occurred_at",
    "run_id",
    "step_id",
    "ip_address",
    "trace_id",
  ];

  const rows = events.map((event) =>
    headers
      .map((header) => {
        const value = event[header as keyof AuditEvent];
        if (value === undefined || value === null) return "";
        if (typeof value === "object") return JSON.stringify(value);
        return String(value).replace(/"/g, '""');
      })
      .map((v) => `"${v}"`)
      .join(",")
  );

  return [headers.join(","), ...rows].join("\n");
}

/**
 * Get display name for event type
 */
export function getEventTypeDisplayName(eventType: AuditEventType): string {
  const names: Partial<Record<AuditEventType, string>> = {
    // Run events
    "run.created": "Run Created",
    "run.started": "Run Started",
    "run.completed": "Run Completed",
    "run.failed": "Run Failed",
    "run.cancelled": "Run Cancelled",
    "run.timeout": "Run Timeout",
    "run.budget_killed": "Run Budget Killed",
    // Step events
    "step.started": "Step Started",
    "step.completed": "Step Completed",
    "step.failed": "Step Failed",
    "step.retry": "Step Retry",
    // Policy events
    "policy.allowed": "Policy Allowed",
    "policy.denied": "Policy Denied",
    "policy.created": "Policy Created",
    "policy.updated": "Policy Updated",
    "policy.deleted": "Policy Deleted",
    // Approval events
    "approval.requested": "Approval Requested",
    "approval.approved": "Approved",
    "approval.rejected": "Rejected",
    "approval.expired": "Approval Expired",
    "approval.auto_approved": "Auto-Approved",
    // Budget events
    "budget.warning": "Budget Warning",
    "budget.exceeded": "Budget Exceeded",
    "budget.updated": "Budget Updated",
    // Agent events
    "agent.created": "Agent Created",
    "agent.updated": "Agent Updated",
    "agent.archived": "Agent Archived",
    "agent.version_created": "Version Created",
    // Tool events
    "tool.created": "Tool Created",
    "tool.updated": "Tool Updated",
    "tool.disabled": "Tool Disabled",
    "tool.invoked": "Tool Invoked",
    // Admin events
    "admin.login": "Admin Login",
    "admin.logout": "Admin Logout",
    "admin.settings_updated": "Settings Updated",
    "admin.user_created": "User Created",
    "admin.user_deleted": "User Deleted",
    "admin.role_changed": "Role Changed",
    // API Key events
    "api_key.created": "API Key Created",
    "api_key.revoked": "API Key Revoked",
    "api_key.expired": "API Key Expired",
    // Settings events
    "settings.updated": "Settings Updated",
  };
  return names[eventType] || eventType.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Get display name for actor type
 */
export function getActorTypeDisplayName(actorType: AuditActorType): string {
  const names: Record<AuditActorType, string> = {
    user: "User",
    api_key: "API Key",
    system: "System",
    agent: "Agent",
  };
  return names[actorType] || actorType;
}

/**
 * Get display name for resource/target type
 */
export function getResourceTypeDisplayName(resourceType: AuditResourceType): string {
  const names: Record<AuditResourceType, string> = {
    run: "Run",
    step: "Step",
    approval: "Approval",
    agent: "Agent",
    agent_version: "Agent Version",
    tool: "Tool",
    tool_version: "Tool Version",
    workflow: "Workflow",
    workflow_run: "Workflow Run",
    policy: "Policy",
    api_key: "API Key",
    settings: "Settings",
    user: "User",
    budget: "Budget",
  };
  return names[resourceType] || resourceType;
}

/**
 * Get action category from event type
 */
export function getActionCategory(eventType: AuditEventType): string {
  const [category] = eventType.split(".");
  return category;
}

/**
 * Get all available event types grouped by category
 */
export function getEventTypesByCategory(): Record<string, AuditEventType[]> {
  return {
    run: [
      "run.created",
      "run.started",
      "run.completed",
      "run.failed",
      "run.cancelled",
      "run.timeout",
      "run.budget_killed",
    ],
    step: ["step.started", "step.completed", "step.failed", "step.retry"],
    policy: [
      "policy.allowed",
      "policy.denied",
      "policy.created",
      "policy.updated",
      "policy.deleted",
    ],
    approval: [
      "approval.requested",
      "approval.approved",
      "approval.rejected",
      "approval.expired",
      "approval.auto_approved",
    ],
    budget: ["budget.warning", "budget.exceeded", "budget.updated"],
    agent: ["agent.created", "agent.updated", "agent.archived", "agent.version_created"],
    tool: ["tool.created", "tool.updated", "tool.disabled", "tool.invoked"],
    admin: [
      "admin.login",
      "admin.logout",
      "admin.settings_updated",
      "admin.user_created",
      "admin.user_deleted",
      "admin.role_changed",
    ],
    api_key: ["api_key.created", "api_key.revoked", "api_key.expired"],
    settings: ["settings.updated"],
  };
}

/**
 * Format timestamp for display
 */
export function formatAuditTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Get full timestamp for tooltip
 */
export function getFullTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Get time range date from preset
 */
export function getTimeRangeDate(range: string): string | undefined {
  const now = new Date();
  switch (range) {
    case "1h":
      return new Date(now.getTime() - 3600000).toISOString();
    case "24h":
      return new Date(now.getTime() - 86400000).toISOString();
    case "7d":
      return new Date(now.getTime() - 604800000).toISOString();
    case "30d":
      return new Date(now.getTime() - 2592000000).toISOString();
    case "90d":
      return new Date(now.getTime() - 7776000000).toISOString();
    default:
      return undefined;
  }
}

// Re-export types for convenience
export type { AuditEvent, AuditEventFilters, AuditEventType, AuditActorType, AuditResourceType };
