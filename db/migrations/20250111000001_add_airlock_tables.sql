-- FerrumDeck Airlock Security Schema
-- =============================================================================
-- Tables for threat tracking, velocity monitoring, and circuit breaker support
-- Airlock provides Runtime Application Self-Protection (RASP) for AI agents
-- =============================================================================

-- =============================================================================
-- 1. ADD NEW RUN STATUS FOR AIRLOCK BLOCKS
-- =============================================================================

-- Add airlock_blocked status to run_status enum
ALTER TYPE run_status ADD VALUE IF NOT EXISTS 'airlock_blocked';

-- Add same status to workflow_run_status for consistency
ALTER TYPE workflow_run_status ADD VALUE IF NOT EXISTS 'airlock_blocked';

-- =============================================================================
-- 2. THREATS TABLE - Records detected security threats
-- =============================================================================

CREATE TABLE IF NOT EXISTS threats (
    id TEXT PRIMARY KEY,  -- ULID format: thr_xxxxx
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    step_id TEXT REFERENCES steps(id) ON DELETE SET NULL,

    -- Tool context
    tool_name TEXT NOT NULL,

    -- Threat assessment
    risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    violation_type TEXT NOT NULL,
    violation_details TEXT,

    -- Blocked payload (sanitized - no secrets, truncated if large)
    blocked_payload JSONB,

    -- Pattern/rule that triggered detection
    trigger_pattern TEXT,

    -- Action taken
    action TEXT NOT NULL CHECK (action IN ('blocked', 'logged')),
    shadow_mode BOOLEAN NOT NULL DEFAULT FALSE,

    -- Context for filtering and analytics
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_threats_run_id ON threats(run_id);
CREATE INDEX IF NOT EXISTS idx_threats_step_id ON threats(step_id) WHERE step_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_threats_project_id ON threats(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_threats_tenant_id ON threats(tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_threats_risk_level ON threats(risk_level);
CREATE INDEX IF NOT EXISTS idx_threats_violation_type ON threats(violation_type);
CREATE INDEX IF NOT EXISTS idx_threats_created_at ON threats(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_threats_action ON threats(action);

-- Composite index for dashboard queries (threats by project, sorted by time)
CREATE INDEX IF NOT EXISTS idx_threats_project_created ON threats(project_id, created_at DESC)
    WHERE project_id IS NOT NULL;

-- Partial index for critical threats (most urgent)
CREATE INDEX IF NOT EXISTS idx_threats_critical ON threats(created_at DESC)
    WHERE risk_level = 'critical';

-- =============================================================================
-- 3. VELOCITY_EVENTS TABLE - For circuit breaker and loop detection
-- =============================================================================

CREATE TABLE IF NOT EXISTS velocity_events (
    id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,

    -- Tool call identification
    tool_name TEXT NOT NULL,
    tool_input_hash TEXT NOT NULL,  -- SHA256 of normalized/sorted input JSON

    -- Cost tracking for budget-aware velocity limiting
    cost_cents INTEGER NOT NULL DEFAULT 0,

    -- Timing
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Primary index for velocity queries: "recent calls in this run"
CREATE INDEX IF NOT EXISTS idx_velocity_run_created ON velocity_events(run_id, created_at DESC);

-- Index for detecting repeated identical calls (loop detection)
CREATE INDEX IF NOT EXISTS idx_velocity_run_tool_hash ON velocity_events(run_id, tool_name, tool_input_hash);

-- Composite index for efficient "recent calls by tool" queries
CREATE INDEX IF NOT EXISTS idx_velocity_run_tool_created ON velocity_events(run_id, tool_name, created_at DESC);

-- Index for cleanup queries (delete old records)
CREATE INDEX IF NOT EXISTS idx_velocity_created ON velocity_events(created_at);

-- =============================================================================
-- 4. STEPS TABLE EXTENSIONS - Add Airlock columns
-- =============================================================================

-- Add Airlock-specific columns to steps table
ALTER TABLE steps
    ADD COLUMN IF NOT EXISTS airlock_risk_score INTEGER
        CHECK (airlock_risk_score IS NULL OR (airlock_risk_score >= 0 AND airlock_risk_score <= 100)),
    ADD COLUMN IF NOT EXISTS airlock_violation_type TEXT,
    ADD COLUMN IF NOT EXISTS airlock_blocked BOOLEAN NOT NULL DEFAULT FALSE;

-- Index for finding steps with Airlock violations
CREATE INDEX IF NOT EXISTS idx_steps_airlock_blocked ON steps(airlock_blocked)
    WHERE airlock_blocked = TRUE;

-- Index for steps by risk score (for analytics)
CREATE INDEX IF NOT EXISTS idx_steps_airlock_risk ON steps(airlock_risk_score)
    WHERE airlock_risk_score IS NOT NULL;

-- =============================================================================
-- 5. RUNS TABLE EXTENSIONS - Add threat aggregation columns
-- =============================================================================

-- Add threat tracking columns to runs table
ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS threat_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS highest_threat_level TEXT CHECK (
        highest_threat_level IS NULL OR
        highest_threat_level IN ('low', 'medium', 'high', 'critical')
    );

-- Index for finding runs with threats
CREATE INDEX IF NOT EXISTS idx_runs_threat_count ON runs(threat_count)
    WHERE threat_count > 0;

-- Index for finding runs by threat level
CREATE INDEX IF NOT EXISTS idx_runs_highest_threat ON runs(highest_threat_level)
    WHERE highest_threat_level IS NOT NULL;

-- =============================================================================
-- 6. TRIGGER: Update threat_count on runs when threat is created
-- =============================================================================

-- Function to update run threat count and highest level
CREATE OR REPLACE FUNCTION update_run_threat_count()
RETURNS TRIGGER AS $$
DECLARE
    threat_level_priority INTEGER;
    current_level_priority INTEGER;
BEGIN
    -- Define threat level priority (higher = more severe)
    threat_level_priority := CASE NEW.risk_level
        WHEN 'critical' THEN 4
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 1
        ELSE 0
    END;

    -- Get current highest level priority
    SELECT CASE highest_threat_level
        WHEN 'critical' THEN 4
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        WHEN 'low' THEN 1
        ELSE 0
    END INTO current_level_priority
    FROM runs WHERE id = NEW.run_id;

    -- Update the threat count and highest level on the run
    UPDATE runs
    SET
        threat_count = threat_count + 1,
        highest_threat_level = CASE
            WHEN threat_level_priority > COALESCE(current_level_priority, 0) THEN NEW.risk_level
            ELSE highest_threat_level
        END
    WHERE id = NEW.run_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to update run threat count on threat insert
DROP TRIGGER IF EXISTS trigger_threat_count ON threats;
CREATE TRIGGER trigger_threat_count
    AFTER INSERT ON threats
    FOR EACH ROW EXECUTE FUNCTION update_run_threat_count();

-- =============================================================================
-- 7. FUNCTION: Cleanup old velocity events (for maintenance)
-- =============================================================================

-- Function to cleanup old velocity events (call periodically or via cron)
CREATE OR REPLACE FUNCTION cleanup_old_velocity_events(retention_hours INTEGER DEFAULT 24)
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM velocity_events
    WHERE created_at < NOW() - (retention_hours || ' hours')::INTERVAL;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 8. AUDIT EVENT ACTIONS FOR AIRLOCK (documentation)
-- =============================================================================

-- Document new audit actions (these are string constants used in application code)
COMMENT ON TABLE threats IS
'Security threats detected by Airlock. Each record represents a potential security violation
detected during tool call inspection. Related audit actions:
- airlock.threat_detected: Threat detected (may be logged or blocked based on shadow_mode)
- airlock.blocked: Tool call blocked by Airlock (enforce mode)
- airlock.velocity_limit: Velocity/cost limit triggered
- airlock.loop_detected: Identical call loop detected';

COMMENT ON TABLE velocity_events IS
'Tracks tool call velocity for circuit breaker and loop detection.
tool_input_hash should be SHA256 of JSON-serialized, sorted input.
Application code computes: SHA256(json.dumps(tool_input, sort_keys=True))
Records are automatically cleaned up by cleanup_old_velocity_events()';

COMMENT ON COLUMN steps.airlock_risk_score IS
'Risk score (0-100) assigned by Airlock during tool call inspection. NULL if no inspection.';

COMMENT ON COLUMN steps.airlock_violation_type IS
'Type of violation detected (e.g., rce_pattern, velocity_breach, exfiltration_attempt). NULL if clean.';

COMMENT ON COLUMN steps.airlock_blocked IS
'TRUE if this step was blocked by Airlock. FALSE otherwise.';

COMMENT ON COLUMN runs.threat_count IS
'Number of security threats detected during this run. Updated by trigger.';

COMMENT ON COLUMN runs.highest_threat_level IS
'Highest severity threat level detected (low/medium/high/critical). Updated by trigger.';
