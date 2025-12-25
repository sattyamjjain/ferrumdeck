-- Add workflow tables for structured workflow execution
-- Migration: 20241224000001_add_workflows.sql

-- Workflow status enum
CREATE TYPE workflow_status AS ENUM ('draft', 'active', 'deprecated', 'archived');

-- Workflow step type enum
CREATE TYPE workflow_step_type AS ENUM ('llm', 'tool', 'condition', 'loop', 'parallel', 'approval');

-- Workflow run status enum
CREATE TYPE workflow_run_status AS ENUM ('created', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled');

-- Workflow step execution status enum
CREATE TYPE workflow_step_execution_status AS ENUM ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'skipped', 'retrying');

-- Workflow definitions table
CREATE TABLE workflows (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    description TEXT,
    version TEXT NOT NULL,
    status workflow_status NOT NULL DEFAULT 'active',
    definition JSONB NOT NULL,
    max_iterations INT NOT NULL DEFAULT 10,
    on_error TEXT NOT NULL DEFAULT 'fail',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(project_id, name, version)
);

CREATE INDEX idx_workflows_project_id ON workflows(project_id);
CREATE INDEX idx_workflows_name ON workflows(name);
CREATE INDEX idx_workflows_status ON workflows(status);

-- Workflow runs table
CREATE TABLE workflow_runs (
    id TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    status workflow_run_status NOT NULL DEFAULT 'created',
    input JSONB NOT NULL DEFAULT '{}',
    context JSONB NOT NULL DEFAULT '{}',
    output JSONB,
    error JSONB,
    current_step_id TEXT,
    step_results JSONB NOT NULL DEFAULT '{}',
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    tool_calls INT NOT NULL DEFAULT 0,
    cost_cents INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    trace_id TEXT
);

CREATE INDEX idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX idx_workflow_runs_project_id ON workflow_runs(project_id);
CREATE INDEX idx_workflow_runs_status ON workflow_runs(status);
CREATE INDEX idx_workflow_runs_created_at ON workflow_runs(created_at DESC);

-- Workflow step executions table
CREATE TABLE workflow_step_executions (
    id TEXT PRIMARY KEY,
    workflow_run_id TEXT NOT NULL REFERENCES workflow_runs(id),
    step_id TEXT NOT NULL,
    step_type workflow_step_type NOT NULL,
    status workflow_step_execution_status NOT NULL DEFAULT 'pending',
    input JSONB NOT NULL DEFAULT '{}',
    output JSONB,
    error JSONB,
    attempt INT NOT NULL DEFAULT 1,
    input_tokens INT,
    output_tokens INT,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    span_id TEXT
);

CREATE INDEX idx_workflow_step_executions_run_id ON workflow_step_executions(workflow_run_id);
CREATE INDEX idx_workflow_step_executions_step_id ON workflow_step_executions(step_id);
CREATE INDEX idx_workflow_step_executions_status ON workflow_step_executions(status);
