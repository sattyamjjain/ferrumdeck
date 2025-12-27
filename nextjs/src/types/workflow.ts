// Workflow step types - matches Rust WorkflowStepType enum
export type WorkflowStepType =
  | "llm"
  | "tool"
  | "condition"
  | "loop"
  | "parallel"
  | "approval";

// Workflow run status - matches Rust WorkflowRunStatus enum
export type WorkflowRunStatus =
  | "created"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";

// Workflow step definition
export interface WorkflowStepDefinition {
  id: string;
  name: string;
  type: WorkflowStepType;
  config: Record<string, unknown>;
  depends_on?: string[];
  timeout_secs?: number;
  retry_count?: number;
}

// Workflow model - matches Rust Workflow struct
export interface Workflow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  description?: string;
  version: string;
  steps: WorkflowStepDefinition[];
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  status: "draft" | "active" | "deprecated" | "archived";
  created_at: string;
  updated_at: string;
  created_by?: string;
}

// Workflow run model - matches Rust WorkflowRun struct
export interface WorkflowRun {
  id: string;
  workflow_id: string;
  workflow_version: string;
  project_id: string;
  status: WorkflowRunStatus;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  // Metrics
  total_steps: number;
  completed_steps: number;
  failed_steps: number;
}

// Workflow step execution - matches Rust WorkflowStepExecution struct
export interface WorkflowStepExecution {
  id: string;
  workflow_run_id: string;
  step_id: string;
  step_name: string;
  step_type: WorkflowStepType;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: Record<string, unknown>;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

// Create workflow request
export interface CreateWorkflowRequest {
  name: string;
  slug: string;
  description?: string;
  version?: string;
  steps: WorkflowStepDefinition[];
  input_schema?: Record<string, unknown>;
}

// Create workflow run request
export interface CreateWorkflowRunRequest {
  workflow_id: string;
  input: Record<string, unknown>;
}

// List workflows response
export interface ListWorkflowsResponse {
  workflows: Workflow[];
  total?: number;
  offset?: number;
  limit?: number;
}

// List workflow runs response
export interface ListWorkflowRunsResponse {
  runs: WorkflowRun[];
  total?: number;
}

// List step executions response
export interface ListStepExecutionsResponse {
  executions: WorkflowStepExecution[];
}
