import type { RiskLevel } from "@/lib/utils";

// Approval status types - matches Rust ApprovalStatus enum
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

// Re-export RiskLevel from utils for convenience
export type { RiskLevel };

// Approval request model - matches Rust ApprovalRequest struct
export interface ApprovalRequest {
  id: string;
  run_id: string;
  step_id: string;
  policy_decision_id: string;
  action_type: string;
  action_details: Record<string, unknown>;
  tool_name?: string; // Derived from action_details for display
  reason: string;
  status: ApprovalStatus;
  risk_level?: RiskLevel; // Risk level determined by policy
  policy_name?: string; // Name of the policy that triggered the approval
  policy_rule?: string; // Specific rule within the policy
  agent_id?: string; // Agent that requested the action
  agent_name?: string; // Display name of the agent
  step_number?: number; // Step number in the run
  created_at: string;
  expires_at?: string;
  resolved_by?: string;
  resolved_at?: string;
  resolution_note?: string;
}

// Approval with run details for list views
export interface ApprovalWithRun extends ApprovalRequest {
  run?: {
    id: string;
    agent_id?: string;
    status: string;
  };
}

// Resolve approval request
export interface ResolveApprovalRequest {
  approved: boolean;
  note?: string;
}

// Resolve approval response
export interface ResolveApprovalResponse {
  id: string;
  status: ApprovalStatus;
  resolved_at: string;
}

// List approvals response
export interface ListApprovalsResponse {
  approvals: ApprovalRequest[];
  total?: number;
}

// Similar approval for context
export interface SimilarApproval {
  id: string;
  tool_name?: string;
  action_type: string;
  status: ApprovalStatus;
  resolved_at?: string;
  resolution_note?: string;
}
