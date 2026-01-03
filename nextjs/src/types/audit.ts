// Audit event type categories based on domain
export type AuditEventType =
  // Run events
  | "run.created"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "run.timeout"
  | "run.budget_killed"
  // Step events
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "step.retry"
  // Policy events
  | "policy.allowed"
  | "policy.denied"
  | "policy.created"
  | "policy.updated"
  | "policy.deleted"
  // Approval events
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.expired"
  | "approval.auto_approved"
  // Budget events
  | "budget.warning"
  | "budget.exceeded"
  | "budget.updated"
  // Agent events
  | "agent.created"
  | "agent.updated"
  | "agent.archived"
  | "agent.version_created"
  // Tool events
  | "tool.created"
  | "tool.updated"
  | "tool.disabled"
  | "tool.invoked"
  // Admin events
  | "admin.login"
  | "admin.logout"
  | "admin.settings_updated"
  | "admin.user_created"
  | "admin.user_deleted"
  | "admin.role_changed"
  // API Key events
  | "api_key.created"
  | "api_key.revoked"
  | "api_key.expired"
  // Settings events
  | "settings.updated";

// Actor types - who performed the action
export type AuditActorType = "user" | "api_key" | "system" | "agent";

// Resource types - what was affected
export type AuditResourceType =
  | "run"
  | "step"
  | "approval"
  | "agent"
  | "agent_version"
  | "tool"
  | "tool_version"
  | "workflow"
  | "workflow_run"
  | "policy"
  | "api_key"
  | "settings"
  | "user"
  | "budget";

// Actor information
export interface AuditActor {
  type: AuditActorType;
  id: string;
  name?: string;
  email?: string;
}

// Target information
export interface AuditTarget {
  type: AuditResourceType;
  id: string;
  name?: string;
}

// Full audit event model
export interface AuditEvent {
  id: string;
  // Event type
  event_type: AuditEventType;
  // Actor information (who did it)
  actor_type: AuditActorType;
  actor_id: string;
  actor_name?: string;
  actor_email?: string;
  // Target information (what was affected)
  target_type: AuditResourceType;
  target_id: string;
  target_name?: string;
  // Legacy fields for backward compatibility
  action: AuditEventType;
  resource_type: AuditResourceType;
  resource_id: string;
  // Context IDs
  tenant_id?: string;
  workspace_id?: string;
  project_id?: string;
  run_id?: string;
  step_id?: string;
  policy_id?: string;
  // Event details (JSON payload with full context)
  details: Record<string, unknown>;
  // Brief description of the event
  description?: string;
  // Redacted fields indicator
  redacted_fields?: string[];
  // Request metadata
  request_id?: string;
  ip_address?: string;
  user_agent?: string;
  // Observability
  trace_id?: string;
  span_id?: string;
  // Timestamp
  occurred_at: string;
  created_at?: string;
}

// Audit event filters for querying
export interface AuditEventFilters {
  // Search query (searches event type, actor, target)
  search?: string;
  // Filter by event types (multi-select)
  event_types?: AuditEventType[];
  // Filter by actor type
  actor_type?: AuditActorType;
  actor_id?: string;
  // Filter by target
  target_type?: AuditResourceType;
  target_id?: string;
  // Context filters
  project_id?: string;
  run_id?: string;
  // Date range
  start_date?: string;
  end_date?: string;
  // Legacy compatibility
  action?: AuditEventType;
  resource_type?: AuditResourceType;
  resource_id?: string;
}

// Cursor-based pagination
export interface AuditCursorParams {
  cursor?: string;
  limit?: number;
}

// List audit events response with cursor pagination
export interface ListAuditEventsResponse {
  events: AuditEvent[];
  next_cursor?: string;
  has_more: boolean;
  total?: number;
  // Legacy offset pagination support
  offset?: number;
  limit?: number;
}

// Single audit event response
export interface GetAuditEventResponse {
  event: AuditEvent;
  related_events?: AuditEvent[];
}

// Export request
export interface AuditExportRequest {
  filters: AuditEventFilters;
  format: "csv" | "json";
  date_range?: {
    start: string;
    end: string;
  };
}

// Export response
export interface AuditExportResponse {
  download_url?: string;
  data?: AuditEvent[];
  format: "csv" | "json";
  count: number;
}

// Saved view configuration
export interface AuditSavedView {
  id: string;
  name: string;
  filters: AuditEventFilters;
  is_default?: boolean;
}

// Predefined saved views
export const AUDIT_SAVED_VIEWS: AuditSavedView[] = [
  {
    id: "all",
    name: "All",
    filters: {},
    is_default: true,
  },
  {
    id: "policy-decisions",
    name: "Policy Decisions",
    filters: {
      event_types: ["policy.allowed", "policy.denied"],
    },
  },
  {
    id: "approvals",
    name: "Approvals",
    filters: {
      event_types: [
        "approval.requested",
        "approval.approved",
        "approval.rejected",
        "approval.expired",
        "approval.auto_approved",
      ],
    },
  },
  {
    id: "errors",
    name: "Errors",
    filters: {
      event_types: [
        "run.failed",
        "run.timeout",
        "run.budget_killed",
        "step.failed",
        "policy.denied",
      ],
    },
  },
  {
    id: "admin-actions",
    name: "Admin Actions",
    filters: {
      event_types: [
        "admin.login",
        "admin.logout",
        "admin.settings_updated",
        "admin.user_created",
        "admin.user_deleted",
        "admin.role_changed",
      ],
    },
  },
];

// Audit event summary for analytics
export interface AuditEventSummary {
  event_type: AuditEventType;
  count: number;
  last_occurred_at: string;
}

// Event type category for color coding
export type AuditEventCategory =
  | "run"
  | "step"
  | "policy"
  | "approval"
  | "budget"
  | "agent"
  | "tool"
  | "admin"
  | "api_key"
  | "settings";

// Get category from event type
export function getEventCategory(eventType: AuditEventType): AuditEventCategory {
  const [category] = eventType.split(".") as [AuditEventCategory];
  if (category === "api_key") return "api_key";
  return category;
}

// Event type color mapping
export const EVENT_TYPE_COLORS: Record<AuditEventCategory, { bg: string; text: string; border: string }> = {
  run: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
  },
  step: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-400",
    border: "border-cyan-500/20",
  },
  policy: {
    bg: "bg-emerald-500/10", // Will be overridden for denied
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  approval: {
    bg: "bg-purple-500/10",
    text: "text-purple-400",
    border: "border-purple-500/20",
  },
  budget: {
    bg: "bg-orange-500/10",
    text: "text-orange-400",
    border: "border-orange-500/20",
  },
  agent: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/20",
  },
  tool: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/20",
  },
  admin: {
    bg: "bg-yellow-500/10",
    text: "text-yellow-400",
    border: "border-yellow-500/20",
  },
  api_key: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/20",
  },
  settings: {
    bg: "bg-slate-500/10",
    text: "text-slate-400",
    border: "border-slate-500/20",
  },
};

// Special color overrides for specific event types
export function getEventTypeColors(eventType: AuditEventType): { bg: string; text: string; border: string } {
  // Policy denied is red, policy allowed is green
  if (eventType === "policy.denied") {
    return {
      bg: "bg-red-500/10",
      text: "text-red-400",
      border: "border-red-500/20",
    };
  }
  if (eventType === "policy.allowed") {
    return {
      bg: "bg-green-500/10",
      text: "text-green-400",
      border: "border-green-500/20",
    };
  }
  // Error events are red
  if (eventType.includes("failed") || eventType.includes("timeout") || eventType.includes("killed")) {
    return {
      bg: "bg-red-500/10",
      text: "text-red-400",
      border: "border-red-500/20",
    };
  }
  // Success events are green
  if (eventType.includes("completed") || eventType.includes("approved")) {
    return {
      bg: "bg-green-500/10",
      text: "text-green-400",
      border: "border-green-500/20",
    };
  }
  // Default to category color
  const category = getEventCategory(eventType);
  return EVENT_TYPE_COLORS[category];
}
