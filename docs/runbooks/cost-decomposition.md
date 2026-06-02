# Debt-vs-tax cost decomposition (§2605.27320)

## What it solves

An agent run's total `cost_cents` is **not** all forward progress. A naive
read of cost-per-task hides the difference between two failure modes:

- A task that finished cheaply because the agent picked the right tool and
  the first primary call succeeded.
- A task that cost the same total but only because retries, judges,
  guardrails, escalations, revalidations, and monitors all fired and
  eventually unblocked the same single primary call.

The §2605.27320 cost-decomposition distinguishes:

- **debt** (= `agent.cost.token`) — sum of *primary* LLM / tool calls
  that actually move a task forward.
- **tax** (= `agent.cost.tax`) — sum of every call that exists to service
  the agent's own machinery: retry, judge, guardrail, escalation,
  revalidation, monitor.

> *Tax remains positive even when debt is minimised.* — §2605.27320

## Existing API (verified by grep) — what was extended

```python
# python/packages/fd-evals/src/fd_evals/task.py — EvalResult
@dataclass
class EvalResult:
    task_id: str
    task_name: str
    run_id: str | None
    passed: bool
    total_score: float
    scorer_results: list[ScorerResult]
    execution_time_ms: int
    input_tokens: int
    output_tokens: int
    cost_cents: float          # ← aggregate per-task; left untouched
    error: str | None = None
    trace_id: str | None = None
    timestamp: datetime = field(default_factory=_utc_now)
```

Two additive Optional fields were appended (both default-`None`), and
`to_dict` emits them only when present so legacy readers + reports are
byte-identical:

```python
call_records: list[CallRecord] | None = None
cost_breakdown: CostBreakdown | None = None
```

`EvalRunSummary` gained one additive Optional field plus a derivation
helper (`derive_cost_breakdown`) that aggregates per-task breakdowns into
the run-level rollup:

```python
cost_breakdown: CostBreakdown | None = None
```

The Rust side adds new attribute constants on `fd_otel::genai::attrs`:

```rust
pub const FERRUMDECK_COST_ROLE: &str = "ferrumdeck.cost.role";
pub const FERRUMDECK_COST_TOKEN_CENTS: &str = "ferrumdeck.cost.token_cents";
pub const FERRUMDECK_COST_TAX_CENTS: &str = "ferrumdeck.cost.tax_cents";
pub const FERRUMDECK_COST_TAX_SHARE: &str = "ferrumdeck.cost.tax_share";
```

Plus a new `fd_otel::cost_decomposition` module providing the `SpanRole`
enum + `CostBreakdown::from_calls` aggregator + `record_call_role` /
`record_cost_breakdown` span helpers. The Python side mirrors the same
attribute keys via `fd_runtime.tracing.FD_COST_*`.

## The seven canonical span roles

`fd_evals.cost_decomposition.SpanRole` (and `fd_otel::SpanRole`):

| Role | Bucket | Examples |
| --- | --- | --- |
| `primary` | **debt** (token) | first LLM call on a step; the tool call that succeeds |
| `retry` | tax | re-issued LLM/tool call after a transient failure |
| `judge` | tax | LLM-as-judge scoring of a primary output |
| `guardrail` | tax | content-safety / policy gate |
| `escalation` | tax | hand-off to a stronger model or human reviewer |
| `revalidation` | tax | re-run after schema-drift / output-format failure |
| `monitor` | tax | background sampling / drift detection |

`SpanRole.parse(raw)` is lenient — unknown or missing roles classify as
`primary` so a legacy trace without the role tag still produces an honest
debt-side reading (and the dashboard surfaces the breakdown's
source-confidence via the count of explicit roles).

## Derived values

- `token_cost_cents` = sum of every `primary` call's cost.
- `tax_cost_cents` = sum of every non-`primary` call's cost.
- `total_cost_cents` = `token + tax`.
- `tax_share` = `tax / (token + tax)`, in `[0, 1]`. **Returns `0.0` for
  an empty breakdown** — absence of data must never read as 100% tax.
- `is_tax_dominant` = `tax_share > 0.5`.

## OTel attribute keys (mirrored both planes)

| Key | Where written | Semantics |
| --- | --- | --- |
| `ferrumdeck.cost.role` | per LLM/tool span | one of `primary / retry / judge / guardrail / escalation / revalidation / monitor` |
| `ferrumdeck.cost.token_cents` | run-completion span | sum of primary-call costs |
| `ferrumdeck.cost.tax_cents` | run-completion span | sum of non-primary-call costs |
| `ferrumdeck.cost.tax_share` | run-completion span | `tax / (token + tax)` ∈ `[0, 1]` |

All four keys sit under the existing `ferrumdeck.*` semconv extension —
no new collector, no new exporter, no new backend.

## Tax-dominance fixture

`python/packages/fd-evals/tests/fixtures/tax_dominance.json` ships the
canonical demonstration: three tasks under the same model. `task_002`
exercises a flaky-network retry storm — its primary call costs `~$0.001`
but four retries + a judge + a revalidation push tax to `~$0.0095`,
giving `tax_share ≥ 0.85`. The other two tasks are inverse / balanced.

Verified by `test_demo_task_has_tax_dwarfing_token` (asserts `tax > token`
and `tax_share ≥ 0.85`) and `test_ranking_places_tax_dominant_task_first`
(asserts `task_002` sits at the top of the tax-share ranking).

## Dashboard surface

`/evals/runs/[evalRunId]` renders a `CostDecompositionPanel` above the
existing run-results table when `evalRun.cost_breakdown` is present (or
when any task carries a per-task breakdown). The panel surfaces three
layers:

1. **Run summary** — three KPI cards: token cost, tax cost (red when
   dominant), tax-share percentage.
2. **Top-10 ranked stacked-bar chart** (Recharts) — token vs tax per
   task, ordered by `tax_share` descending. The first bar is the
   tax-dominance signal at a glance.
3. **Per-task table** — every task with a breakdown, with `tax-heavy`
   badge on rows where `tax_share > 0.5`.

Runs without `cost_breakdown` on either the run or any task render the
panel as `null`, so the legacy run-detail layout stays byte-identical.

## Anti-pivot guarantees

- **No new store, no new exporter, no new backend.** The role tag lives
  on the existing span; the breakdown lives inside the existing
  `EvalResult` / `EvalRunSummary` JSON shape.
- **Dual-plane split preserved.** Python eval plane produces; Rust
  control plane mirrors the attr keys + offers a span-tagging helper;
  Next.js dashboard consumes.
- **MCP and GenAI semconv intact.** The role tag is a sibling of
  `gen_ai.tool.name`, not a replacement for it.
- **Backward-compatible.** Every new field is `Optional`; `to_dict`
  emits only when present; `SpanRole.parse` falls back to `primary` for
  unknown / missing tags. Legacy reports load and round-trip unchanged.
