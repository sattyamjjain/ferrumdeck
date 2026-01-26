import type { Run, RunWithStats, Step, Budget, BudgetUsage } from "@/types/run";
import type { ApprovalRequest } from "@/types/approval";
import type { Agent, AgentVersion } from "@/types/agent";
import type { Tool } from "@/types/tool";

// =============================================================================
// Run Fixtures
// =============================================================================

export const mockBudget: Budget = {
  max_input_tokens: 100000,
  max_output_tokens: 50000,
  max_total_tokens: 150000,
  max_tool_calls: 50,
  max_wall_time_ms: 300000,
  max_cost_cents: 500,
};

export const mockBudgetUsage: BudgetUsage = {
  input_tokens: 5000,
  output_tokens: 2500,
  tool_calls: 3,
  wall_time_ms: 15000,
  cost_cents: 25,
};

export const mockRunCreated: Run = {
  id: "run_01J5EXAMPLE0001",
  project_id: "prj_01J5EXAMPLE0001",
  agent_version_id: "agv_01J5EXAMPLE0001",
  agent_id: "agt_01J5EXAMPLE0001",
  status: "created",
  input: { task: "Test task" },
  input_tokens: 0,
  output_tokens: 0,
  tool_calls: 0,
  cost_cents: 0,
  created_at: "2024-01-15T10:00:00Z",
};

export const mockRunRunning: Run = {
  id: "run_01J5EXAMPLE0002",
  project_id: "prj_01J5EXAMPLE0001",
  agent_version_id: "agv_01J5EXAMPLE0001",
  agent_id: "agt_01J5EXAMPLE0001",
  status: "running",
  input: { task: "Process documents" },
  usage: mockBudgetUsage,
  input_tokens: 5000,
  output_tokens: 2500,
  tool_calls: 3,
  cost_cents: 25,
  created_at: "2024-01-15T10:00:00Z",
  started_at: "2024-01-15T10:00:05Z",
};

export const mockRunCompleted: Run = {
  id: "run_01J5EXAMPLE0003",
  project_id: "prj_01J5EXAMPLE0001",
  agent_version_id: "agv_01J5EXAMPLE0001",
  agent_id: "agt_01J5EXAMPLE0001",
  status: "completed",
  input: { task: "Review PR #123" },
  output: { response: "PR looks good!", iterations: 3 },
  usage: mockBudgetUsage,
  budget: mockBudget,
  input_tokens: 10000,
  output_tokens: 5000,
  tool_calls: 8,
  cost_cents: 75,
  created_at: "2024-01-15T09:00:00Z",
  started_at: "2024-01-15T09:00:02Z",
  completed_at: "2024-01-15T09:05:00Z",
};

export const mockRunFailed: Run = {
  id: "run_01J5EXAMPLE0004",
  project_id: "prj_01J5EXAMPLE0001",
  agent_version_id: "agv_01J5EXAMPLE0001",
  agent_id: "agt_01J5EXAMPLE0001",
  status: "failed",
  status_reason: "Tool execution failed",
  input: { task: "Deploy to production" },
  error: { message: "Permission denied", code: "PERMISSION_DENIED" },
  input_tokens: 3000,
  output_tokens: 500,
  tool_calls: 2,
  cost_cents: 15,
  created_at: "2024-01-15T08:00:00Z",
  started_at: "2024-01-15T08:00:01Z",
  completed_at: "2024-01-15T08:01:00Z",
};

export const mockRunWaitingApproval: Run = {
  id: "run_01J5EXAMPLE0005",
  project_id: "prj_01J5EXAMPLE0001",
  agent_version_id: "agv_01J5EXAMPLE0001",
  agent_id: "agt_01J5EXAMPLE0001",
  status: "waiting_approval",
  input: { task: "Delete user data" },
  input_tokens: 2000,
  output_tokens: 500,
  tool_calls: 1,
  cost_cents: 10,
  created_at: "2024-01-15T10:30:00Z",
  started_at: "2024-01-15T10:30:01Z",
};

export const mockRunBudgetKilled: Run = {
  id: "run_01J5EXAMPLE0006",
  project_id: "prj_01J5EXAMPLE0001",
  agent_version_id: "agv_01J5EXAMPLE0001",
  agent_id: "agt_01J5EXAMPLE0001",
  status: "budget_killed",
  status_reason: "Exceeded max_cost_cents limit",
  input: { task: "Generate report" },
  budget: mockBudget,
  input_tokens: 200000,
  output_tokens: 100000,
  tool_calls: 100,
  cost_cents: 550,
  created_at: "2024-01-15T07:00:00Z",
  started_at: "2024-01-15T07:00:01Z",
  completed_at: "2024-01-15T07:10:00Z",
};

export const mockRunWithStats: RunWithStats = {
  ...mockRunRunning,
  step_count: 5,
  pending_steps: 1,
  completed_steps: 3,
  failed_steps: 1,
};

// =============================================================================
// Step Fixtures
// =============================================================================

export const mockStepLLMPending: Step = {
  id: "stp_01J5EXAMPLE0001",
  run_id: "run_01J5EXAMPLE0002",
  step_number: 1,
  step_type: "llm",
  status: "pending",
  model: "claude-3-opus",
  input: { prompt: "Analyze the codebase" },
  created_at: "2024-01-15T10:00:05Z",
};

export const mockStepLLMRunning: Step = {
  id: "stp_01J5EXAMPLE0002",
  run_id: "run_01J5EXAMPLE0002",
  step_number: 2,
  step_type: "llm",
  status: "running",
  model: "claude-3-opus",
  input: { prompt: "Generate solution" },
  input_tokens: 1500,
  created_at: "2024-01-15T10:00:10Z",
  started_at: "2024-01-15T10:00:11Z",
};

export const mockStepLLMCompleted: Step = {
  id: "stp_01J5EXAMPLE0003",
  run_id: "run_01J5EXAMPLE0002",
  step_number: 3,
  step_type: "llm",
  status: "completed",
  model: "claude-3-sonnet",
  input: { prompt: "Review changes" },
  output: { response: "Changes look good" },
  input_tokens: 2000,
  output_tokens: 500,
  created_at: "2024-01-15T10:00:15Z",
  started_at: "2024-01-15T10:00:16Z",
  completed_at: "2024-01-15T10:00:20Z",
};

export const mockStepToolCompleted: Step = {
  id: "stp_01J5EXAMPLE0004",
  run_id: "run_01J5EXAMPLE0002",
  step_number: 4,
  step_type: "tool",
  status: "completed",
  tool_name: "read_file",
  tool_version: "1.0.0",
  input: { path: "/src/main.rs" },
  output: { content: "fn main() { ... }" },
  created_at: "2024-01-15T10:00:21Z",
  started_at: "2024-01-15T10:00:22Z",
  completed_at: "2024-01-15T10:00:23Z",
};

export const mockStepToolFailed: Step = {
  id: "stp_01J5EXAMPLE0005",
  run_id: "run_01J5EXAMPLE0002",
  step_number: 5,
  step_type: "tool",
  status: "failed",
  tool_name: "write_file",
  input: { path: "/etc/passwd", content: "hack" },
  error: { message: "Permission denied by policy" },
  airlock_risk_score: 95,
  airlock_violation_type: "path_traversal",
  airlock_blocked: true,
  created_at: "2024-01-15T10:00:25Z",
  started_at: "2024-01-15T10:00:26Z",
  completed_at: "2024-01-15T10:00:27Z",
};

export const mockStepApprovalWaiting: Step = {
  id: "stp_01J5EXAMPLE0006",
  run_id: "run_01J5EXAMPLE0005",
  step_number: 1,
  step_type: "approval",
  status: "waiting_approval",
  tool_name: "delete_user",
  input: { user_id: "user_123" },
  created_at: "2024-01-15T10:30:02Z",
};

export const mockSteps: Step[] = [
  mockStepLLMCompleted,
  mockStepToolCompleted,
  mockStepLLMRunning,
  mockStepLLMPending,
];

// =============================================================================
// Approval Fixtures
// =============================================================================

// Use dynamic dates for pending approvals to avoid expiry issues in tests
const now = new Date();
const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

export const mockApprovalPending: ApprovalRequest = {
  id: "apr_01J5EXAMPLE0001",
  run_id: "run_01J5EXAMPLE0005",
  step_id: "stp_01J5EXAMPLE0006",
  policy_decision_id: "pdc_01J5EXAMPLE0001",
  action_type: "tool_call",
  action_details: {
    tool_name: "delete_user",
    arguments: { user_id: "user_123" },
  },
  tool_name: "delete_user",
  reason: "Tool requires approval before execution",
  status: "pending",
  risk_level: "high",
  policy_name: "default_policy",
  agent_id: "agt_01J5EXAMPLE0001",
  agent_name: "PR Review Agent",
  step_number: 1,
  created_at: oneHourAgo,
  expires_at: oneDayFromNow,
};

export const mockApprovalApproved: ApprovalRequest = {
  id: "apr_01J5EXAMPLE0002",
  run_id: "run_01J5EXAMPLE0003",
  step_id: "stp_01J5EXAMPLE0010",
  policy_decision_id: "pdc_01J5EXAMPLE0002",
  action_type: "tool_call",
  action_details: {
    tool_name: "write_file",
    arguments: { path: "/src/fix.rs" },
  },
  tool_name: "write_file",
  reason: "Write operation requires approval",
  status: "approved",
  risk_level: "medium",
  created_at: "2024-01-15T09:00:30Z",
  resolved_by: "admin@example.com",
  resolved_at: "2024-01-15T09:01:00Z",
  resolution_note: "Approved for bug fix",
};

export const mockApprovalRejected: ApprovalRequest = {
  id: "apr_01J5EXAMPLE0003",
  run_id: "run_01J5EXAMPLE0004",
  step_id: "stp_01J5EXAMPLE0011",
  policy_decision_id: "pdc_01J5EXAMPLE0003",
  action_type: "tool_call",
  action_details: {
    tool_name: "exec_shell",
    arguments: { command: "rm -rf /" },
  },
  tool_name: "exec_shell",
  reason: "Shell execution requires approval",
  status: "rejected",
  risk_level: "critical",
  created_at: "2024-01-15T08:00:30Z",
  resolved_by: "admin@example.com",
  resolved_at: "2024-01-15T08:00:45Z",
  resolution_note: "Dangerous command rejected",
};

export const mockApprovals: ApprovalRequest[] = [
  mockApprovalPending,
  mockApprovalApproved,
  mockApprovalRejected,
];

// =============================================================================
// Agent Fixtures
// =============================================================================

export const mockAgentVersion: AgentVersion = {
  id: "agv_01J5EXAMPLE0001",
  agent_id: "agt_01J5EXAMPLE0001",
  version: "1.0.0",
  model: "claude-3-opus",
  system_prompt: "You are a helpful PR review assistant.",
  allowed_tools: ["read_file", "list_directory", "search_code"],
  approval_tools: ["write_file", "create_pr"],
  denied_tools: ["exec_shell", "delete_file"],
  budget: {
    max_input_tokens: 100000,
    max_output_tokens: 50000,
    max_total_tokens: 150000,
    max_tool_calls: 50,
    max_cost_cents: 500,
  },
  created_at: "2024-01-01T00:00:00Z",
  created_by: "admin@example.com",
  deployed_environments: ["development", "production"],
};

export const mockAgent: Agent = {
  id: "agt_01J5EXAMPLE0001",
  project_id: "prj_01J5EXAMPLE0001",
  name: "PR Review Agent",
  slug: "pr-review-agent",
  description: "Reviews pull requests and suggests improvements",
  status: "active",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T00:00:00Z",
  latest_version: mockAgentVersion,
};

export const mockAgentDraft: Agent = {
  id: "agt_01J5EXAMPLE0002",
  project_id: "prj_01J5EXAMPLE0001",
  name: "Code Generator",
  slug: "code-generator",
  description: "Generates code based on specifications",
  status: "draft",
  created_at: "2024-01-10T00:00:00Z",
  updated_at: "2024-01-10T00:00:00Z",
};

export const mockAgentDeprecated: Agent = {
  id: "agt_01J5EXAMPLE0003",
  project_id: "prj_01J5EXAMPLE0001",
  name: "Legacy Assistant",
  slug: "legacy-assistant",
  description: "Deprecated agent",
  status: "deprecated",
  created_at: "2023-06-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

export const mockAgents: Agent[] = [mockAgent, mockAgentDraft, mockAgentDeprecated];

// =============================================================================
// Tool Fixtures
// =============================================================================

export const mockToolReadFile: Tool = {
  id: "tool_01J5EXAMPLE0001",
  project_id: "prj_01J5EXAMPLE0001",
  name: "read_file",
  slug: "read-file",
  description: "Read the contents of a file",
  mcp_server: "filesystem",
  status: "active",
  risk_level: "low",
  health_status: "ok",
  used_by_count: 5,
  last_called: "2024-01-15T10:00:00Z",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T00:00:00Z",
};

export const mockToolWriteFile: Tool = {
  id: "tool_01J5EXAMPLE0002",
  project_id: "prj_01J5EXAMPLE0001",
  name: "write_file",
  slug: "write-file",
  description: "Write content to a file",
  mcp_server: "filesystem",
  status: "active",
  risk_level: "medium",
  health_status: "ok",
  used_by_count: 3,
  last_called: "2024-01-15T09:00:00Z",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-15T00:00:00Z",
};

export const mockToolExecShell: Tool = {
  id: "tool_01J5EXAMPLE0003",
  project_id: "prj_01J5EXAMPLE0001",
  name: "exec_shell",
  slug: "exec-shell",
  description: "Execute shell commands",
  mcp_server: "system",
  status: "disabled",
  risk_level: "critical",
  health_status: "unknown",
  used_by_count: 0,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
};

export const mockTools: Tool[] = [mockToolReadFile, mockToolWriteFile, mockToolExecShell];

// =============================================================================
// List Response Fixtures
// =============================================================================

export const mockRunsListResponse = {
  runs: [mockRunCompleted, mockRunRunning, mockRunFailed, mockRunWaitingApproval],
  total: 4,
  offset: 0,
  limit: 20,
};

export const mockApprovalsListResponse = {
  approvals: mockApprovals,
  total: 3,
};

export const mockAgentsListResponse = {
  agents: mockAgents,
  total: 3,
  offset: 0,
  limit: 20,
};
