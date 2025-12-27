// Audit event action types
export type AuditAction =
  | "run.created"
  | "run.started"
  | "run.completed"
  | "run.failed"
  | "run.cancelled"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "approval.requested"
  | "approval.approved"
  | "approval.rejected"
  | "approval.expired"
  | "agent.created"
  | "agent.updated"
  | "agent.archived"
  | "agent.version_created"
  | "tool.created"
  | "tool.updated"
  | "tool.disabled"
  | "policy.created"
  | "policy.updated"
  | "policy.deleted"
  | "api_key.created"
  | "api_key.revoked"
  | "settings.updated";

// Audit event actor types
export type AuditActorType = "user" | "api_key" | "system" | "agent";

// Audit event resource types
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
  | "settings";

// Audit event model - matches Rust AuditEvent struct
export interface AuditEvent {
  id: string;
  // Actor information
  actor_type: AuditActorType;
  actor_id: string;
  actor_name?: string;
  // Action and resource
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string;
  // Context
  tenant_id?: string;
  workspace_id?: string;
  project_id?: string;
  run_id?: string;
  // Details
  details: Record<string, unknown>;
  // Request metadata
  request_id?: string;
  ip_address?: string;
  user_agent?: string;
  // Observability
  trace_id?: string;
  span_id?: string;
  // Timestamp
  occurred_at: string;
}

// Audit event filters
export interface AuditEventFilters {
  action?: AuditAction;
  actor_type?: AuditActorType;
  actor_id?: string;
  resource_type?: AuditResourceType;
  resource_id?: string;
  project_id?: string;
  run_id?: string;
  start_date?: string;
  end_date?: string;
}

// List audit events response
export interface ListAuditEventsResponse {
  events: AuditEvent[];
  total?: number;
  offset?: number;
  limit?: number;
}

// Audit event summary for analytics
export interface AuditEventSummary {
  action: AuditAction;
  count: number;
  last_occurred_at: string;
}
