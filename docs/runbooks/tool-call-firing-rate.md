# Tool-call firing-rate metric

## What it measures

The **tool-call firing rate** is a derived observability signal:

```
firing_rate = reasoning_steps_that_invoked_a_tool / total_reasoning_steps
```

In the FerrumDeck step schema (`rust/crates/fd-storage/src/models/steps.rs`):

- **Reasoning step** = `StepType::Llm` — the model is reasoning / planning.
- **Tool-invoking** = the reasoning step has at least one child
  `StepType::Tool` step (linked via `parent_step_id`), or equivalently the
  recorded GenAI finish-reason is `tool_calls`.

The signal is computed per run by the gateway and aggregated per agent
(optionally per agent version) over a sliding time window. It is not
persisted into a dedicated table — it is recomputed from the existing run /
step rows on demand, and tagged onto the existing GenAI / FerrumDeck OTel
span attributes.

## Where it lives

| Plane | Module | Role |
| --- | --- | --- |
| Rust | `fd_otel::firing_rate` | Canonical `FiringRate` struct, pure compute, span-tagging helper, attribute constants. |
| Rust | `fd_otel::genai::attrs::FERRUMDECK_TOOL_FIRING_*` | The five OTel attribute keys this metric ships. |
| Python | `fd_runtime.tracing.FD_TOOL_FIRING_*` | Mirror constants for the worker / eval plane. |
| Python | `fd_evals.firing_rate` | Pure compute used by the eval golden-trace test and any replay fixture. |
| Dashboard | `nextjs/src/components/agents/tool-call-firing-rate-panel.tsx` | Recharts trend panel on the agent overview tab. |
| Dashboard | `nextjs/src/app/api/v1/registry/agents/[agentId]/tool-call-firing-rate/route.ts` | BFF route — proxies to the gateway when available, falls through to a deterministic mock so the dashboard ships ahead of the upstream compute (same pattern as `run.forecast.updated`, `policy.decision.explained`). |

## OTel attribute keys

All five are extensions under the existing `ferrumdeck.*` semconv namespace;
no new telemetry backend, no new exporter, no new collector pipeline:

| Key | Type | Semantics |
| --- | --- | --- |
| `ferrumdeck.metrics.tool_call_firing_rate` | `double ∈ [0, 1]` | The rate itself. |
| `ferrumdeck.metrics.tool_call_reasoning_steps` | `int ≥ 0` | LLM-step count in the window. |
| `ferrumdeck.metrics.tool_call_invoking_steps` | `int ≥ 0` | LLM steps that invoked ≥1 tool. |
| `ferrumdeck.metrics.tool_call_firing_low_breached` | `bool` | `rate < threshold && reasoning_steps > 0`. |
| `ferrumdeck.metrics.tool_call_firing_low_threshold` | `double ∈ [0, 1]` | Threshold used for the breach decision. |

## Default low-firing-rate threshold

The dashboard flags an agent window when the firing rate drops **below
40%** (`DEFAULT_LOW_FIRING_RATE_THRESHOLD = 0.40` in Rust;
`FD_TOOL_FIRING_DEFAULT_THRESHOLD = 0.40` in Python). A reasoning-heavy
agent that fires tools less than 40% of the time is usually either
over-thinking simple tasks (model regression / prompt drift) or has a
broken tool registry. The dashboard exposes a threshold dropdown
(`20% / 30% / 40% / 50% / 60%`) for ad-hoc tuning per agent.

The threshold is intentionally strict-`<`: a rate exactly equal to the
threshold sits on the line and does **not** breach.

## Tuning

| Symptom | First-cut interpretation | Where to look |
| --- | --- | --- |
| Sudden drop in firing rate across all agents | Tool-registry mis-config (allowlist regression, MCP server down). | `/threats` (Airlock denials), `fd_audit` events with `action = "policy.denied"`. |
| Single agent below floor, others healthy | Prompt drift, model swap, or agent-version regression. | Compare against the previous agent version on the same panel; check the eval gate score from `bench_audit`. |
| Firing rate ≈ 100% | Agent is short-circuiting reasoning and calling tools reflexively — investigate hallucinated tool args. | `/threats` + per-step `Airlock` violations. |
| Empty window ("no data") | No completed runs in the configured window. | Lengthen the window dropdown (default 24h → 72h / 168h). |

## How drift is detected

The shape of `FiringRate` (Rust struct + Python dataclass + TypeScript
interface) is gated by a golden-trace regression in
`python/packages/fd-evals/tests/test_tool_call_firing_rate_golden.py`. A
synthetic step list flows through the same compute path used by the
gateway and the worker; the JSON output (struct + OTel attribute set) is
diffed against `tests/fixtures/tool_call_firing_rate.golden.json`. Any
schema change must:

1. Update the Rust struct + Python dataclass + TypeScript interface in
   lockstep.
2. Update this runbook to describe the new shape.
3. Re-bless the golden with
   `BLESS=1 uv run pytest python/packages/fd-evals/tests/test_tool_call_firing_rate_golden.py`.
4. Commit all three diffs together.

## Anti-pivot notes

- **Stays on the existing telemetry backend.** Both planes write OTel span
  attributes — nothing else. No new collector, no new exporter, no parallel
  metrics pipeline.
- **No new state store.** The aggregate is recomputed from the existing
  `runs` + `steps` rows; no `agent_firing_rate` table, no Redis cache.
- **Dashboard reuses existing primitives.** TanStack Query for state,
  Recharts for the trend, shadcn `Card` / `Badge` / `DropdownMenu` for the
  shell. No new dependency lands with this metric.
