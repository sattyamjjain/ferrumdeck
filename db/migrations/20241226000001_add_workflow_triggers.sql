-- Add updated_at triggers for workflow tables
-- Migration: 20241226000001_add_workflow_triggers.sql

-- Note: The update_updated_at() function already exists from initial_schema migration

-- Add updated_at column to workflow_runs if it doesn't exist
-- (workflow_runs only has created_at, but we need updated_at for trigger consistency)
ALTER TABLE workflow_runs
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Add updated_at column to workflow_step_executions if it doesn't exist
ALTER TABLE workflow_step_executions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Workflows table already has updated_at, add trigger
CREATE TRIGGER trigger_workflows_updated_at
    BEFORE UPDATE ON workflows
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Workflow runs trigger
CREATE TRIGGER trigger_workflow_runs_updated_at
    BEFORE UPDATE ON workflow_runs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Workflow step executions trigger
CREATE TRIGGER trigger_workflow_step_executions_updated_at
    BEFORE UPDATE ON workflow_step_executions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Also add trigger for runs table (was missing from initial schema)
CREATE TRIGGER trigger_runs_updated_at
    BEFORE UPDATE ON runs
    FOR EACH ROW
    WHEN (OLD.* IS DISTINCT FROM NEW.*)
    EXECUTE FUNCTION update_updated_at();

-- Add updated_at column to runs if it doesn't exist
ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Update existing rows to have updated_at match created_at
UPDATE runs SET updated_at = created_at WHERE updated_at = NOW();
UPDATE workflow_runs SET updated_at = created_at WHERE updated_at = NOW();
UPDATE workflow_step_executions SET updated_at = COALESCE(started_at, NOW()) WHERE updated_at = NOW();

-- Add index on updated_at for efficient polling/sync
CREATE INDEX IF NOT EXISTS idx_runs_updated_at ON runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_updated_at ON workflow_runs(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_updated_at ON workflow_step_executions(updated_at DESC);
