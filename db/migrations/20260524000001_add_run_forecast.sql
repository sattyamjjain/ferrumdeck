-- FerrumDeck — Predictive run-budget forecast
-- =============================================================================
-- After each step is recorded, the governance plane projects the run's
-- end-of-run cost (linear + EWMA), and flags `budget_breach_projected` when
-- any axis is on track to exceed its cap. These columns hold the latest
-- snapshot per run; SSE consumers see the history as it evolves.
-- All columns are nullable so historical runs need no backfill.
-- =============================================================================

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS projected_cost_cents BIGINT,
    ADD COLUMN IF NOT EXISTS ewma_cost_cents BIGINT,
    ADD COLUMN IF NOT EXISTS ewma_step_cost_cents BIGINT,
    ADD COLUMN IF NOT EXISTS budget_breach_projected BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS breach_kind TEXT,
    ADD COLUMN IF NOT EXISTS forecast_at TIMESTAMPTZ;

-- Partial index for the dashboard's "active runs projected to breach" query.
CREATE INDEX IF NOT EXISTS runs_budget_breach_projected_idx
    ON runs (forecast_at DESC)
    WHERE budget_breach_projected = TRUE;
