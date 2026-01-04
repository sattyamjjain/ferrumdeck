-- Performance optimization indexes
-- These composite indexes optimize common query patterns

-- =============================================================================
-- Runs table - optimized for dashboard list queries
-- =============================================================================

-- Composite index for listing runs by project with status filter
-- Covers: GET /v1/runs?project_id=X&status=Y (sorted by created_at DESC)
CREATE INDEX IF NOT EXISTS idx_runs_project_status_created
    ON runs(project_id, status, created_at DESC);

-- =============================================================================
-- Steps table - optimized for run detail queries
-- =============================================================================

-- Composite index for listing steps by run with ordering
-- Covers: GET /v1/runs/:id/steps
CREATE INDEX IF NOT EXISTS idx_steps_run_number
    ON steps(run_id, step_number);

-- Composite index for finding pending steps
CREATE INDEX IF NOT EXISTS idx_steps_run_status
    ON steps(run_id, status);

-- =============================================================================
-- Audit events - optimized for tenant audit log queries
-- =============================================================================

-- Composite index for tenant audit timeline
CREATE INDEX IF NOT EXISTS idx_audit_tenant_occurred
    ON audit_events(tenant_id, occurred_at DESC);

-- Composite index for run-specific audit events
CREATE INDEX IF NOT EXISTS idx_audit_run_occurred
    ON audit_events(run_id, occurred_at DESC)
    WHERE run_id IS NOT NULL;

-- =============================================================================
-- Approval requests - optimized for approval queue
-- =============================================================================

-- Partial index for pending approvals (most frequently queried)
CREATE INDEX IF NOT EXISTS idx_approval_pending_created
    ON approval_requests(created_at DESC)
    WHERE status = 'pending';

-- =============================================================================
-- Agent versions - optimized for version lookup
-- =============================================================================

-- Composite index for listing versions by agent
CREATE INDEX IF NOT EXISTS idx_agent_versions_agent_created
    ON agent_versions(agent_id, created_at DESC);

-- =============================================================================
-- Workflow runs - optimized for workflow history
-- =============================================================================

-- Composite index for workflow run history
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_created
    ON workflow_runs(workflow_id, created_at DESC);

-- Partial index for active workflow runs
CREATE INDEX IF NOT EXISTS idx_workflow_runs_active
    ON workflow_runs(workflow_id, created_at DESC)
    WHERE status IN ('created', 'running');
