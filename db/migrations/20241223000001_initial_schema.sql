-- FerrumDeck Initial Schema
-- =============================================================================
-- Core tables for the Control Plane
-- =============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================================================
-- Tenants & Workspaces (Multi-tenancy foundation)
-- =============================================================================

CREATE TABLE tenants (
    id TEXT PRIMARY KEY,  -- ULID format: ten_xxxxx
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,  -- ULID format: wks_xxxxx
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, slug)
);

CREATE TABLE projects (
    id TEXT PRIMARY KEY,  -- ULID format: prj_xxxxx
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (workspace_id, slug)
);

-- =============================================================================
-- API Keys
-- =============================================================================

CREATE TABLE api_keys (
    id TEXT PRIMARY KEY,  -- ULID format: key_xxxxx
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,  -- SHA256 hash of the actual key
    key_prefix TEXT NOT NULL,        -- First 8 chars for identification
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

CREATE INDEX idx_api_keys_key_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_tenant_id ON api_keys(tenant_id);

-- =============================================================================
-- Agents & Versions
-- =============================================================================

CREATE TYPE agent_status AS ENUM ('draft', 'active', 'deprecated', 'archived');

CREATE TABLE agents (
    id TEXT PRIMARY KEY,  -- ULID format: agt_xxxxx
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    status agent_status NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, slug)
);

CREATE TABLE agent_versions (
    id TEXT PRIMARY KEY,  -- ULID format: agv_xxxxx
    agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    version TEXT NOT NULL,  -- Semantic version: 1.0.0

    -- Agent definition
    system_prompt TEXT NOT NULL,
    model TEXT NOT NULL,           -- e.g., claude-sonnet-4-20250514
    model_params JSONB NOT NULL DEFAULT '{}',  -- temperature, max_tokens, etc.

    -- Tool configuration
    allowed_tools TEXT[] NOT NULL DEFAULT '{}',
    tool_configs JSONB NOT NULL DEFAULT '{}',

    -- Budget limits
    max_tokens INTEGER,
    max_tool_calls INTEGER,
    max_wall_time_secs INTEGER,
    max_cost_cents INTEGER,

    -- Metadata
    changelog TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT,

    UNIQUE (agent_id, version)
);

CREATE INDEX idx_agent_versions_agent_id ON agent_versions(agent_id);

-- =============================================================================
-- Tools & Versions
-- =============================================================================

CREATE TYPE tool_status AS ENUM ('active', 'deprecated', 'disabled');
CREATE TYPE tool_risk_level AS ENUM ('read', 'write', 'destructive');

CREATE TABLE tools (
    id TEXT PRIMARY KEY,  -- ULID format: tol_xxxxx
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,  -- NULL = global tool
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    mcp_server TEXT NOT NULL,  -- MCP server identifier
    status tool_status NOT NULL DEFAULT 'active',
    risk_level tool_risk_level NOT NULL DEFAULT 'read',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tool_versions (
    id TEXT PRIMARY KEY,  -- ULID format: tlv_xxxxx
    tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    version TEXT NOT NULL,

    -- Tool schema
    input_schema JSONB NOT NULL,
    output_schema JSONB,

    -- Metadata
    changelog TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tool_id, version)
);

-- =============================================================================
-- Runs & Steps
-- =============================================================================

CREATE TYPE run_status AS ENUM (
    'created',
    'queued',
    'running',
    'waiting_approval',
    'completed',
    'failed',
    'cancelled',
    'timeout'
);

CREATE TABLE runs (
    id TEXT PRIMARY KEY,  -- ULID format: run_xxxxx
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    agent_version_id TEXT NOT NULL REFERENCES agent_versions(id),

    -- Run configuration
    input JSONB NOT NULL,
    config JSONB NOT NULL DEFAULT '{}',

    -- Status tracking
    status run_status NOT NULL DEFAULT 'created',
    status_reason TEXT,

    -- Budget tracking
    input_tokens INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    tool_calls INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Output
    output JSONB,
    error JSONB,

    -- Trace context
    trace_id TEXT,
    span_id TEXT
);

CREATE INDEX idx_runs_project_id ON runs(project_id);
CREATE INDEX idx_runs_status ON runs(status);
CREATE INDEX idx_runs_created_at ON runs(created_at DESC);
CREATE INDEX idx_runs_trace_id ON runs(trace_id);

CREATE TYPE step_type AS ENUM ('llm', 'tool', 'retrieval', 'human');
CREATE TYPE step_status AS ENUM (
    'pending',
    'running',
    'waiting_approval',
    'completed',
    'failed',
    'skipped'
);

CREATE TABLE steps (
    id TEXT PRIMARY KEY,  -- ULID format: stp_xxxxx
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    parent_step_id TEXT REFERENCES steps(id),

    -- Step definition
    step_number INTEGER NOT NULL,
    step_type step_type NOT NULL,

    -- Input/Output
    input JSONB NOT NULL,
    output JSONB,

    -- For tool steps
    tool_name TEXT,
    tool_version TEXT,

    -- For LLM steps
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,

    -- Status
    status step_status NOT NULL DEFAULT 'pending',
    error JSONB,

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    -- Trace context
    span_id TEXT
);

CREATE INDEX idx_steps_run_id ON steps(run_id);
CREATE INDEX idx_steps_status ON steps(status);

-- Step artifacts (files, images, etc.)
CREATE TABLE step_artifacts (
    id TEXT PRIMARY KEY,  -- ULID format: art_xxxxx
    step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    storage_path TEXT NOT NULL,  -- Path in object storage
    checksum TEXT NOT NULL,      -- SHA256
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_step_artifacts_step_id ON step_artifacts(step_id);

-- =============================================================================
-- Policy Rules
-- =============================================================================

CREATE TYPE policy_effect AS ENUM ('allow', 'deny', 'require_approval');

CREATE TABLE policy_rules (
    id TEXT PRIMARY KEY,  -- ULID format: pol_xxxxx
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,  -- NULL = global

    -- Rule definition
    name TEXT NOT NULL,
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 100,  -- Lower = higher priority

    -- Conditions (JSONB for flexibility)
    conditions JSONB NOT NULL,
    -- Example: {"tool_name": {"in": ["git_push", "github_create_pr"]}}

    effect policy_effect NOT NULL,

    -- Metadata
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by TEXT
);

CREATE INDEX idx_policy_rules_project_id ON policy_rules(project_id);
CREATE INDEX idx_policy_rules_enabled ON policy_rules(enabled);

-- Policy decisions log
CREATE TABLE policy_decisions (
    id TEXT PRIMARY KEY,  -- ULID format: pdc_xxxxx
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
    step_id TEXT REFERENCES steps(id) ON DELETE SET NULL,

    -- What was evaluated
    action_type TEXT NOT NULL,  -- 'tool_call', 'budget_check', etc.
    action_details JSONB NOT NULL,

    -- Decision
    decision policy_effect NOT NULL,
    matched_rule_id TEXT REFERENCES policy_rules(id),
    reason TEXT NOT NULL,

    -- Timing
    evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evaluation_time_ms INTEGER
);

CREATE INDEX idx_policy_decisions_run_id ON policy_decisions(run_id);
CREATE INDEX idx_policy_decisions_step_id ON policy_decisions(step_id);

-- =============================================================================
-- Approval Requests
-- =============================================================================

CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE approval_requests (
    id TEXT PRIMARY KEY,  -- ULID format: apr_xxxxx
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    policy_decision_id TEXT NOT NULL REFERENCES policy_decisions(id),

    -- Request details
    action_type TEXT NOT NULL,
    action_details JSONB NOT NULL,
    reason TEXT NOT NULL,

    -- Status
    status approval_status NOT NULL DEFAULT 'pending',

    -- Resolution
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT,

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX idx_approval_requests_run_id ON approval_requests(run_id);
CREATE INDEX idx_approval_requests_status ON approval_requests(status);

-- =============================================================================
-- Audit Events
-- =============================================================================

CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,  -- ULID format: aud_xxxxx

    -- Actor
    actor_type TEXT NOT NULL,  -- 'user', 'api_key', 'system', 'agent'
    actor_id TEXT,

    -- Action
    action TEXT NOT NULL,  -- 'run.created', 'step.completed', 'policy.denied', etc.
    resource_type TEXT NOT NULL,
    resource_id TEXT,

    -- Details
    details JSONB NOT NULL DEFAULT '{}',

    -- Context
    tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,

    -- Request context
    request_id TEXT,
    ip_address INET,
    user_agent TEXT,

    -- Trace context
    trace_id TEXT,
    span_id TEXT,

    -- Timing
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partition by month for efficient querying and archival
CREATE INDEX idx_audit_events_occurred_at ON audit_events(occurred_at DESC);
CREATE INDEX idx_audit_events_actor ON audit_events(actor_type, actor_id);
CREATE INDEX idx_audit_events_action ON audit_events(action);
CREATE INDEX idx_audit_events_resource ON audit_events(resource_type, resource_id);
CREATE INDEX idx_audit_events_tenant_id ON audit_events(tenant_id);
CREATE INDEX idx_audit_events_run_id ON audit_events(run_id);

-- =============================================================================
-- Updated At Triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_workspaces_updated_at
    BEFORE UPDATE ON workspaces
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_tools_updated_at
    BEFORE UPDATE ON tools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_policy_rules_updated_at
    BEFORE UPDATE ON policy_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
