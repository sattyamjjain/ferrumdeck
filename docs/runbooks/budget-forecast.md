# Runbook — Predictive Run-Budget Forecast

## Purpose

After each step is recorded, the Rust governance plane projects the run's
end-of-run cost (and tool-call / wall-time consumption) and flags
`budget_breach_projected = true` when any axis is on track to exceed its
configured cap before the run can terminate. The forecast is a
**non-blocking signal** — it surfaces in the dashboard and audit log; the
existing budget auto-kill is what actually terminates a run.

## Where the forecast comes from

- Module: `rust/crates/fd-policy/src/forecast.rs` (`compute_forecast`).
- Call site: `rust/services/gateway/src/handlers/runs.rs` in
  `submit_step_result`, right after `increment_usage` writes the step cost.
- The forecast uses `PolicyEngine::default_budget()` so it is always
  evaluated against the same caps the auto-kill enforces.
- Persisted on `runs` via `RunsRepo::update_forecast` (one UPDATE, no joins).
  See migration `db/migrations/20260524000001_add_run_forecast.sql`.

## Projections

Two projections are produced per snapshot. Both are deterministic
(`rust_decimal`) — there is no ML dependency at this layer.

| Projection | Method | When to trust |
| --- | --- | --- |
| `projected_cost_cents` | **Linear**: extrapolates current cost against the most-burned axis (cost ratio, tool-call ratio, wall-time ratio). | Conservative — good early-warning. |
| `ewma_cost_cents` | **EWMA** of per-step cost, projected over remaining tool-calls. α = 0.3. | Better mid-run signal once the per-step cost rate stabilises. |

The breach flag fires when either projection (or the wall-time already-exceeded
fact) crosses a cap. Precedence: wall-time → cost → tool-calls.

## API contract

`GET /v1/runs/{run_id}` (additive fields, all optional):

```json
{
  "id": "run_…",
  "cost_cents": 230,
  "tool_calls": 4,
  "projected_cost_cents": 712,
  "ewma_cost_cents": 690,
  "budget_breach_projected": true,
  "breach_kind": "cost_cents",
  "forecast_at": "2026-05-24T08:42:11.214Z"
}
```

`breach_kind` is `null` when no breach is projected. Allowed values:
`cost_cents`, `tool_calls`, `wall_time`.

## SSE contract

Event type: **`run.forecast.updated`** on the per-run channel `run:{run_id}`.

```json
{
  "id": "evt_…",
  "type": "run.forecast.updated",
  "channel": "run:run_…",
  "timestamp": "2026-05-24T08:42:11.214Z",
  "payload": {
    "run_id": "run_…",
    "projected_cost_cents": 712,
    "ewma_cost_cents": 690,
    "budget_breach_projected": true,
    "breach_kind": "cost_cents",
    "at": "2026-05-24T08:42:11.214Z"
  }
}
```

**Status — gateway push wiring is deferred.** The BFF SSE endpoint
(`nextjs/src/app/api/sse/[channel]/route.ts`) currently emits this event
shape via the mock generator so dashboard consumers and the schema are
locked in. The gateway→BFF push path uses the same pattern as the
`SchemaDriftGuard` activation note — to be wired in a follow-up. Polling on
`GET /v1/runs/{run_id}` (default 2 s) picks up forecast updates immediately.

## What to do when the badge fires

1. Open the run-detail page; the **"Projected to exceed …"** badge appears
   next to the status badge with a tooltip showing both projections.
2. Compare `projected_cost_cents` vs. `cost_cents` and the configured cap.
   If the projection is climbing across consecutive snapshots, the run is
   accelerating — likely a runaway tool loop.
3. If acceleration is suspected, cancel via `POST /v1/runs/{run_id}/cancel`.
   The auto-kill will still trigger on the actual cap; the forecast just
   gives you an earlier hand on the kill switch.
4. For repeated false positives on the EWMA projection at the start of a
   run, the EWMA seeds from the first step's cost — short, expensive
   bootstrap steps can over-project. Wait one or two more snapshots before
   intervening.

## Dashboard surfaces

- **Daily cost chart** (`nextjs/src/components/charts/cost-chart.tsx`) shows
  a dashed yellow segment stacked on top of today's actual bar representing
  the projected additional cost from currently-active runs that have been
  flagged.
- **Run header badge**
  (`nextjs/src/components/runs/budget-projection-badge.tsx`) hidden by
  default; surfaces with a pulsing critical badge when
  `budget_breach_projected` is `true`.

## Operations checklist

- The `runs.budget_breach_projected` column ships with `DEFAULT FALSE`, so
  pre-existing runs need no backfill.
- A partial index
  (`runs_budget_breach_projected_idx WHERE budget_breach_projected = TRUE`)
  supports the dashboard's "active runs projected to breach" query.
- The forecast snapshot write is **best-effort** — if the UPDATE fails, the
  step result still returns success and the failure is logged via `tracing`
  at `warn`. This is intentional; the forecast must not gate run progress.

## Related links

- Module: `rust/crates/fd-policy/src/forecast.rs`
- Handler: `rust/services/gateway/src/handlers/runs.rs:submit_step_result`
- Migration: `db/migrations/20260524000001_add_run_forecast.sql`
- Dashboard badge: `nextjs/src/components/runs/budget-projection-badge.tsx`
- Cost chart: `nextjs/src/components/charts/cost-chart.tsx`
