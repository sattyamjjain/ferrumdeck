// Policy action types - matches Rust PolicyAction enum
export type PolicyAction = "allow" | "deny" | "require_approval";

// Policy status types
export type PolicyStatus = "active" | "inactive" | "draft";

// Policy decision result
export type PolicyDecisionResult = "allowed" | "denied" | "approval_required";

// Budget type - what resource is being limited
export type BudgetType = "cost" | "tokens" | "calls" | "time";

// Budget period - time window for the budget
export type BudgetPeriod = "per_run" | "hourly" | "daily" | "weekly" | "monthly";

// Budget status
export type BudgetStatus = "active" | "inactive" | "exceeded";

// Individual policy rule
export interface PolicyRule {
  id: string;
  action: PolicyAction;
  condition: string; // Human-readable condition expression
  description?: string;
  order: number; // Evaluation order within the policy
}

// Policy model - matches Rust Policy struct
export interface Policy {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description?: string;
  priority: number; // Higher = evaluated first
  status: PolicyStatus;
  rules: PolicyRule[];
  // Scope restrictions
  agent_ids?: string[]; // If set, only applies to these agents
  tool_ids?: string[]; // If set, only applies to these tools
  // Metadata
  created_at: string;
  updated_at: string;
  created_by?: string;
}

// Policy with usage statistics
export interface PolicyWithStats extends Policy {
  evaluation_count: number;
  allow_count: number;
  deny_count: number;
  approval_count: number;
  last_evaluated_at?: string;
}

// Policy decision - result of evaluating a policy
export interface PolicyDecision {
  id: string;
  policy_id: string;
  policy_name: string;
  rule_id?: string;
  rule_description?: string;
  decision: PolicyDecisionResult;
  reason: string;
  evaluated_at: string;
  // Context that was evaluated
  agent_id?: string;
  tool_name?: string;
  context?: Record<string, unknown>;
}

// Budget configuration
export interface Budget {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  budget_type: BudgetType;
  limit: number;
  period: BudgetPeriod;
  status: BudgetStatus;
  // Scope restrictions
  agent_ids?: string[]; // If set, only applies to these agents
  // Current usage
  current_usage: number;
  usage_percentage: number;
  // Reset timing
  period_start?: string;
  period_end?: string;
  // Metadata
  created_at: string;
  updated_at: string;
}

// Budget usage snapshot
export interface BudgetUsage {
  budget_id: string;
  budget_name: string;
  budget_type: BudgetType;
  limit: number;
  current_usage: number;
  usage_percentage: number;
  period: BudgetPeriod;
  period_start?: string;
  period_end?: string;
  status: BudgetStatus;
}

// Policy simulation request
export interface SimulatePolicyRequest {
  agent_id?: string;
  tool_name?: string;
  context?: Record<string, unknown>;
}

// Policy simulation response
export interface SimulatePolicyResponse {
  decision: PolicyDecisionResult;
  matched_policy?: {
    id: string;
    name: string;
    priority: number;
  };
  matched_rule?: {
    id: string;
    action: PolicyAction;
    condition: string;
    description?: string;
  };
  explanation: string;
  evaluated_policies: Array<{
    id: string;
    name: string;
    priority: number;
    result: PolicyDecisionResult | "not_matched";
  }>;
}

// Create policy request
export interface CreatePolicyRequest {
  name: string;
  slug: string;
  description?: string;
  priority?: number;
  status?: PolicyStatus;
  rules: Omit<PolicyRule, "id">[];
  agent_ids?: string[];
  tool_ids?: string[];
}

// Update policy request
export interface UpdatePolicyRequest {
  name?: string;
  description?: string;
  priority?: number;
  status?: PolicyStatus;
  rules?: Omit<PolicyRule, "id">[];
  agent_ids?: string[];
  tool_ids?: string[];
}

// Create budget request
export interface CreateBudgetRequest {
  name: string;
  description?: string;
  budget_type: BudgetType;
  limit: number;
  period: BudgetPeriod;
  status?: BudgetStatus;
  agent_ids?: string[];
}

// Update budget request
export interface UpdateBudgetRequest {
  name?: string;
  description?: string;
  limit?: number;
  status?: BudgetStatus;
  agent_ids?: string[];
}

// List policies response
export interface ListPoliciesResponse {
  policies: Policy[];
  total?: number;
  offset?: number;
  limit?: number;
}

// List budgets response
export interface ListBudgetsResponse {
  budgets: Budget[];
  total?: number;
  offset?: number;
  limit?: number;
}
