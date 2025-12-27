"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AuditEvent,
  AuditEventFilters,
  ListAuditEventsResponse,
  AuditAction,
  AuditActorType,
  AuditResourceType,
} from "@/types";

async function fetchAuditEvents(
  filters: AuditEventFilters = {}
): Promise<ListAuditEventsResponse> {
  const params = new URLSearchParams();

  if (filters.action) params.set("action", filters.action);
  if (filters.actor_type) params.set("actor_type", filters.actor_type);
  if (filters.actor_id) params.set("actor_id", filters.actor_id);
  if (filters.resource_type) params.set("resource_type", filters.resource_type);
  if (filters.resource_id) params.set("resource_id", filters.resource_id);
  if (filters.project_id) params.set("project_id", filters.project_id);
  if (filters.run_id) params.set("run_id", filters.run_id);
  if (filters.start_date) params.set("start_date", filters.start_date);
  if (filters.end_date) params.set("end_date", filters.end_date);

  const res = await fetch(`/api/v1/audit?${params.toString()}`);

  if (!res.ok) {
    throw new Error("Failed to fetch audit events");
  }

  return res.json();
}

export function useAuditEvents(filters: AuditEventFilters = {}) {
  return useQuery({
    queryKey: ["audit-events", filters],
    queryFn: () => fetchAuditEvents(filters),
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}

// Helper to get action category from audit action
export function getActionCategory(action: AuditAction): string {
  const [category] = action.split(".");
  return category;
}

// Helper to get action display name
export function getActionDisplayName(action: AuditAction): string {
  const actionNames: Record<AuditAction, string> = {
    "run.created": "Run Created",
    "run.started": "Run Started",
    "run.completed": "Run Completed",
    "run.failed": "Run Failed",
    "run.cancelled": "Run Cancelled",
    "step.started": "Step Started",
    "step.completed": "Step Completed",
    "step.failed": "Step Failed",
    "approval.requested": "Approval Requested",
    "approval.approved": "Approved",
    "approval.rejected": "Rejected",
    "approval.expired": "Approval Expired",
    "agent.created": "Agent Created",
    "agent.updated": "Agent Updated",
    "agent.archived": "Agent Archived",
    "agent.version_created": "Version Created",
    "tool.created": "Tool Created",
    "tool.updated": "Tool Updated",
    "tool.disabled": "Tool Disabled",
    "policy.created": "Policy Created",
    "policy.updated": "Policy Updated",
    "policy.deleted": "Policy Deleted",
    "api_key.created": "API Key Created",
    "api_key.revoked": "API Key Revoked",
    "settings.updated": "Settings Updated",
  };
  return actionNames[action] || action;
}

// Helper to get actor type display name
export function getActorTypeDisplayName(actorType: AuditActorType): string {
  const names: Record<AuditActorType, string> = {
    user: "User",
    api_key: "API Key",
    system: "System",
    agent: "Agent",
  };
  return names[actorType] || actorType;
}

// Helper to get resource type display name
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
  };
  return names[resourceType] || resourceType;
}

// Export types for convenience
export type { AuditEvent, AuditEventFilters, AuditAction, AuditActorType, AuditResourceType };
