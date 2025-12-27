// Approval status types - matches Rust ApprovalStatus enum
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";

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
