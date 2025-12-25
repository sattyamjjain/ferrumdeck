-- Migration: Add tenant quota tracking and aggregation
-- Enables usage tracking and quota enforcement per tenant

-- Table for tenant quota definitions
CREATE TABLE IF NOT EXISTS tenant_quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Token quotas (monthly)
    monthly_input_token_limit BIGINT DEFAULT NULL,  -- NULL = unlimited
    monthly_output_token_limit BIGINT DEFAULT NULL,
    
    -- Cost quotas (monthly, in cents)
    monthly_cost_limit_cents BIGINT DEFAULT NULL,
    
    -- Run quotas
    daily_run_limit INT DEFAULT NULL,
    concurrent_run_limit INT DEFAULT 10,
    
    -- API rate limits
    requests_per_minute INT DEFAULT 1000,
    requests_per_hour INT DEFAULT 50000,
    
    -- Budget per run
    max_cost_per_run_cents INT DEFAULT 500,  -- $5 default
    max_tokens_per_run INT DEFAULT 100000,
    
    -- Metadata
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id)
);

-- Table for aggregated usage tracking (daily rollups)
CREATE TABLE IF NOT EXISTS tenant_usage_daily (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    usage_date DATE NOT NULL,
    
    -- Token usage
    input_tokens BIGINT NOT NULL DEFAULT 0,
    output_tokens BIGINT NOT NULL DEFAULT 0,
    
    -- Cost (in cents, calculated)
    cost_cents NUMERIC(12, 4) NOT NULL DEFAULT 0,
    
    -- Run counts
    runs_started INT NOT NULL DEFAULT 0,
    runs_completed INT NOT NULL DEFAULT 0,
    runs_failed INT NOT NULL DEFAULT 0,
    
    -- Step counts
    llm_steps INT NOT NULL DEFAULT 0,
    tool_steps INT NOT NULL DEFAULT 0,
    
    -- Tool call breakdown (JSONB for flexibility)
    tool_usage JSONB DEFAULT '{}',  -- {"git_status": 10, "read_file": 25}
    
    -- API calls
    api_requests INT NOT NULL DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(tenant_id, usage_date)
);

-- Table for real-time usage tracking (current period)
CREATE TABLE IF NOT EXISTS tenant_usage_current (
    tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Current month totals
    month_start DATE NOT NULL,
    month_input_tokens BIGINT NOT NULL DEFAULT 0,
    month_output_tokens BIGINT NOT NULL DEFAULT 0,
    month_cost_cents NUMERIC(12, 4) NOT NULL DEFAULT 0,
    month_runs INT NOT NULL DEFAULT 0,
    
    -- Current day totals
    day_start DATE NOT NULL,
    day_runs INT NOT NULL DEFAULT 0,
    day_api_requests INT NOT NULL DEFAULT 0,
    
    -- Current concurrent runs
    concurrent_runs INT NOT NULL DEFAULT 0,
    
    -- Rate limiting (sliding window)
    minute_window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    minute_requests INT NOT NULL DEFAULT 0,
    hour_window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    hour_requests INT NOT NULL DEFAULT 0,
    
    -- Last updated
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_tenant_usage_daily_tenant_date 
    ON tenant_usage_daily(tenant_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS idx_tenant_usage_daily_date 
    ON tenant_usage_daily(usage_date);

-- Function to update current usage atomically
CREATE OR REPLACE FUNCTION update_tenant_usage(
    p_tenant_id TEXT,
    p_input_tokens BIGINT DEFAULT 0,
    p_output_tokens BIGINT DEFAULT 0,
    p_cost_cents NUMERIC DEFAULT 0,
    p_is_run_start BOOLEAN DEFAULT FALSE,
    p_is_run_complete BOOLEAN DEFAULT FALSE,
    p_is_api_request BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
    quota_exceeded BOOLEAN,
    exceeded_reason TEXT,
    current_month_cost NUMERIC,
    month_limit BIGINT
) AS $$
DECLARE
    v_today DATE := CURRENT_DATE;
    v_month_start DATE := DATE_TRUNC('month', CURRENT_DATE)::DATE;
    v_quota RECORD;
    v_current RECORD;
BEGIN
    -- Get quota for tenant
    SELECT * INTO v_quota FROM tenant_quotas WHERE tenant_id = p_tenant_id;
    
    -- Upsert current usage
    INSERT INTO tenant_usage_current (
        tenant_id, month_start, day_start,
        minute_window_start, hour_window_start
    )
    VALUES (
        p_tenant_id, v_month_start, v_today,
        NOW(), NOW()
    )
    ON CONFLICT (tenant_id) DO UPDATE SET
        -- Reset month if new month
        month_start = CASE 
            WHEN tenant_usage_current.month_start < v_month_start 
            THEN v_month_start 
            ELSE tenant_usage_current.month_start 
        END,
        month_input_tokens = CASE 
            WHEN tenant_usage_current.month_start < v_month_start 
            THEN p_input_tokens 
            ELSE tenant_usage_current.month_input_tokens + p_input_tokens 
        END,
        month_output_tokens = CASE 
            WHEN tenant_usage_current.month_start < v_month_start 
            THEN p_output_tokens 
            ELSE tenant_usage_current.month_output_tokens + p_output_tokens 
        END,
        month_cost_cents = CASE 
            WHEN tenant_usage_current.month_start < v_month_start 
            THEN p_cost_cents 
            ELSE tenant_usage_current.month_cost_cents + p_cost_cents 
        END,
        month_runs = CASE 
            WHEN tenant_usage_current.month_start < v_month_start 
            THEN (CASE WHEN p_is_run_start THEN 1 ELSE 0 END)
            ELSE tenant_usage_current.month_runs + (CASE WHEN p_is_run_start THEN 1 ELSE 0 END)
        END,
        -- Reset day if new day
        day_start = CASE 
            WHEN tenant_usage_current.day_start < v_today 
            THEN v_today 
            ELSE tenant_usage_current.day_start 
        END,
        day_runs = CASE 
            WHEN tenant_usage_current.day_start < v_today 
            THEN (CASE WHEN p_is_run_start THEN 1 ELSE 0 END)
            ELSE tenant_usage_current.day_runs + (CASE WHEN p_is_run_start THEN 1 ELSE 0 END)
        END,
        day_api_requests = CASE 
            WHEN tenant_usage_current.day_start < v_today 
            THEN (CASE WHEN p_is_api_request THEN 1 ELSE 0 END)
            ELSE tenant_usage_current.day_api_requests + (CASE WHEN p_is_api_request THEN 1 ELSE 0 END)
        END,
        -- Update concurrent runs
        concurrent_runs = tenant_usage_current.concurrent_runs + 
            (CASE WHEN p_is_run_start THEN 1 ELSE 0 END) -
            (CASE WHEN p_is_run_complete THEN 1 ELSE 0 END),
        -- Rate limiting windows
        minute_window_start = CASE 
            WHEN tenant_usage_current.minute_window_start < NOW() - INTERVAL '1 minute'
            THEN NOW()
            ELSE tenant_usage_current.minute_window_start
        END,
        minute_requests = CASE 
            WHEN tenant_usage_current.minute_window_start < NOW() - INTERVAL '1 minute'
            THEN (CASE WHEN p_is_api_request THEN 1 ELSE 0 END)
            ELSE tenant_usage_current.minute_requests + (CASE WHEN p_is_api_request THEN 1 ELSE 0 END)
        END,
        hour_window_start = CASE 
            WHEN tenant_usage_current.hour_window_start < NOW() - INTERVAL '1 hour'
            THEN NOW()
            ELSE tenant_usage_current.hour_window_start
        END,
        hour_requests = CASE 
            WHEN tenant_usage_current.hour_window_start < NOW() - INTERVAL '1 hour'
            THEN (CASE WHEN p_is_api_request THEN 1 ELSE 0 END)
            ELSE tenant_usage_current.hour_requests + (CASE WHEN p_is_api_request THEN 1 ELSE 0 END)
        END,
        updated_at = NOW();
    
    -- Get updated current usage
    SELECT * INTO v_current FROM tenant_usage_current WHERE tenant_id = p_tenant_id;
    
    -- Check quotas
    IF v_quota IS NOT NULL THEN
        -- Check monthly cost limit
        IF v_quota.monthly_cost_limit_cents IS NOT NULL AND 
           v_current.month_cost_cents > v_quota.monthly_cost_limit_cents THEN
            RETURN QUERY SELECT TRUE, 'Monthly cost limit exceeded'::TEXT, 
                v_current.month_cost_cents, v_quota.monthly_cost_limit_cents;
            RETURN;
        END IF;
        
        -- Check daily run limit
        IF v_quota.daily_run_limit IS NOT NULL AND 
           v_current.day_runs > v_quota.daily_run_limit THEN
            RETURN QUERY SELECT TRUE, 'Daily run limit exceeded'::TEXT,
                v_current.month_cost_cents, v_quota.monthly_cost_limit_cents;
            RETURN;
        END IF;
        
        -- Check concurrent run limit
        IF v_current.concurrent_runs > v_quota.concurrent_run_limit THEN
            RETURN QUERY SELECT TRUE, 'Concurrent run limit exceeded'::TEXT,
                v_current.month_cost_cents, v_quota.monthly_cost_limit_cents;
            RETURN;
        END IF;
        
        -- Check rate limits
        IF v_current.minute_requests > v_quota.requests_per_minute THEN
            RETURN QUERY SELECT TRUE, 'Rate limit exceeded (requests per minute)'::TEXT,
                v_current.month_cost_cents, v_quota.monthly_cost_limit_cents;
            RETURN;
        END IF;
    END IF;
    
    -- No quota exceeded
    RETURN QUERY SELECT FALSE, NULL::TEXT, 
        v_current.month_cost_cents, 
        COALESCE(v_quota.monthly_cost_limit_cents, 0)::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- Function to rollup daily usage (run via cron/scheduler)
CREATE OR REPLACE FUNCTION rollup_daily_usage(p_date DATE DEFAULT CURRENT_DATE - 1)
RETURNS INT AS $$
DECLARE
    v_count INT := 0;
BEGIN
    INSERT INTO tenant_usage_daily (
        tenant_id, usage_date,
        input_tokens, output_tokens, cost_cents,
        runs_started, runs_completed, runs_failed,
        llm_steps, tool_steps, api_requests
    )
    SELECT
        w.tenant_id,
        p_date,
        COALESCE(SUM(r.input_tokens), 0),
        COALESCE(SUM(r.output_tokens), 0),
        COALESCE(SUM(r.cost_cents), 0),
        COUNT(*) FILTER (WHERE r.created_at::DATE = p_date),
        COUNT(*) FILTER (WHERE r.status = 'completed'),
        COUNT(*) FILTER (WHERE r.status = 'failed'),
        COALESCE(SUM((SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.step_type = 'llm')), 0),
        COALESCE(SUM((SELECT COUNT(*) FROM steps s WHERE s.run_id = r.id AND s.step_type = 'tool')), 0),
        0  -- API requests tracked separately
    FROM runs r
    JOIN projects p ON r.project_id = p.id
    JOIN workspaces w ON p.workspace_id = w.id
    WHERE r.created_at::DATE = p_date
    GROUP BY w.tenant_id
    ON CONFLICT (tenant_id, usage_date) DO UPDATE SET
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cost_cents = EXCLUDED.cost_cents,
        runs_started = EXCLUDED.runs_started,
        runs_completed = EXCLUDED.runs_completed,
        runs_failed = EXCLUDED.runs_failed,
        llm_steps = EXCLUDED.llm_steps,
        tool_steps = EXCLUDED.tool_steps,
        updated_at = NOW();

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- View for monthly aggregation
CREATE OR REPLACE VIEW tenant_usage_monthly AS
SELECT 
    tenant_id,
    DATE_TRUNC('month', usage_date)::DATE as month,
    SUM(input_tokens) as input_tokens,
    SUM(output_tokens) as output_tokens,
    SUM(cost_cents) as cost_cents,
    SUM(runs_started) as runs,
    SUM(llm_steps) as llm_steps,
    SUM(tool_steps) as tool_steps,
    SUM(api_requests) as api_requests
FROM tenant_usage_daily
GROUP BY tenant_id, DATE_TRUNC('month', usage_date);

-- Trigger to update updated_at
CREATE TRIGGER update_tenant_quotas_updated_at
    BEFORE UPDATE ON tenant_quotas
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_tenant_usage_daily_updated_at
    BEFORE UPDATE ON tenant_usage_daily
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at();

-- Insert default quotas for existing tenants
INSERT INTO tenant_quotas (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- Comments
COMMENT ON TABLE tenant_quotas IS 'Quota definitions per tenant';
COMMENT ON TABLE tenant_usage_daily IS 'Daily aggregated usage per tenant';
COMMENT ON TABLE tenant_usage_current IS 'Real-time usage tracking for quota enforcement';
COMMENT ON FUNCTION update_tenant_usage IS 'Atomically update usage and check quotas';
COMMENT ON FUNCTION rollup_daily_usage IS 'Aggregate daily usage from runs table';
