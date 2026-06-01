# Per-harness eval dimension (Harness-Bench)

## What it solves

An fd-evals score is **not** a property of the model alone. The same model
under two different harnesses can produce different scores: a strict
permission tier denies a tool the agent needs, an aggressive `on_error:
stop` policy turns a recoverable failure into a regression, a low tracing
sample rate hides the silent fault that caused the drop. Reporting at the
*model* level alone obscures these signals — Harness-Bench calls this an
**execution-alignment failure**.

This runbook describes the per-harness dimension fd-evals now records,
how the baseline comparison surfaces it, and how the dashboard renders
the `(model × harness_config)` grouping.

## Existing API (verified by grep) — what was extended

```python
# python/packages/fd-evals/src/fd_evals/task.py — EvalRunSummary (12 fields)
@dataclass
class EvalRunSummary:
    run_id: str
    dataset_name: str
    total_tasks: int
    passed_tasks: int
    failed_tasks: int
    average_score: float
    total_cost_cents: float
    total_input_tokens: int
    total_output_tokens: int
    total_execution_time_ms: int
    results: list[EvalResult]
    started_at: datetime
    completed_at: datetime | None = None
```

Two backward-compatible fields were added at the **end** of the dataclass
(both `Optional` / default-`None`), and `to_dict` emits them only when
present so any legacy reader that doesn't know the keys is unaffected:

```python
model: str | None = None
harness_config: HarnessConfig | None = None
```

`DeltaReport` (`fd_evals.delta`) gained four backward-compatible fields
(`baseline_model`, `current_model`, `baseline_harness_config`,
`current_harness_config`) plus three computed properties
(`harness_diff`, `baseline_group_label`, `current_group_label`).
`DeltaReporter.compare_runs` reads these straight from the input
result dicts; reports written before this PR have `None` on every new
field and still load through `DeltaReport.from_dict`.

## The four Harness-Bench dimensions

`fd_evals.harness.HarnessConfig` records the dimensions Harness-Bench
names, each as a typed sub-shape:

| Dimension | Field | Shape |
| --- | --- | --- |
| Tools available | `tools_available: tuple[ToolBinding, ...]` | `{name, version?}` per binding |
| Permission / policy tier | `permission_tier: str` | Tier label (`deny_by_default`, `deny_by_default_strict`, `permissive_with_net`, …) |
| State / recovery | `state_recovery: StateRecoveryConfig` | `{max_retries, max_iterations, on_error, replay_seed?}` |
| Tracing | `tracing: TracingConfig` | `{exporter, sample_rate, gen_ai_semconv_version?}` |

Plus two metadata fields:

- `harness_id`: stable id used for grouping
- `label`: human-readable display string (relabelling does **not** change `content_hash`)

## Content hash

`HarnessConfig.content_hash()` produces a SHA-256 over a stable JSON
projection of the four dimensions plus `harness_id`. **Label is excluded** so
a rename is not structural drift. **Tool list is sorted by `name`** so an
evaluator that reports tools in a different order hashes to the same
harness. Two runs that share a `content_hash` share a harness for
comparison purposes — the dashboard renders that case as
`shared_harness = true`.

## Diff between two harnesses

`fd_evals.harness.diff_harness_configs(baseline, current) ->
HarnessConfigDiff` returns:

- `shared_harness: bool` — true when both content hashes match.
- `delta: HarnessConfigDelta | None` — `None` when shared; otherwise
  enumerates `permission_tier_changed`, `added_tools`, `removed_tools`,
  `version_changed_tools`, `state_recovery_changed`, `tracing_changed`.

If either side is `None`, `delta` is `None` and `shared_harness` is
`False`. The dashboard panel renders the per-dimension diff list only
when `delta` is populated.

## Group labels

`label_for_model_harness(model, harness) -> str` produces the canonical
`(model × harness)` display string the dashboard groups by:

```
claude-opus-4-7 × strict-policy-no-net
gpt-4o × (no harness)
```

## Execution-alignment failure fixture

`python/packages/fd-evals/tests/fixtures/harness_alignment_failure.json`
ships a minimal demonstration: the same model
(`claude-opus-4-7`) under two harnesses (`strict-no-net` vs
`permissive-with-net`) produces 1/3 vs 3/3 passing tasks on the same
dataset. The strict harness denies `http_request`, which task 2 ("Update
dependencies") and task 3 ("Add webhook handler") both require. The fixture
is verified by
`tests/test_harness_dimension.py::test_execution_alignment_failure_score_gap`.

## Dashboard surface

`/evals/runs/[evalRunId]` renders a `HarnessConfigPanel` above the
existing run-results table when `evalRun.harness_config` is present (or
`baseline_harness_config` is, for legacy single-harness baselines). The
panel shows:

1. A `(model × harness)` badge row, with the baseline → current arrow
   when the two sides differ.
2. A Recharts `BarChart` of the per-side aggregate score (only when both
   sides exist).
3. A 2×2 grid of the four Harness-Bench dimensions for the current side.
4. A per-dimension change list (added / removed / version-changed tools,
   tier change, recovery change, tracing change) — emitted only when the
   structural diff is non-empty.

Runs without `harness_config` and without `baseline_harness_config` render
the panel as `null` so the legacy run-detail layout is byte-identical for
older runs.

## Anti-pivot guarantees

- **Persisted next to the existing baseline record**, not in a parallel
  store. `EvalRunSummary` carries it; `DeltaReport` projects it; old
  reports load unchanged.
- **No new exporter, no new collector, no new telemetry plane** —
  tracing config is *recorded* alongside the run, not imposed by it.
- **Dual-plane split preserved.** Python data plane produces; Rust
  governance plane is untouched; Next.js dashboard consumes.
- **MCP and OTel/Jaeger GenAI semconv intact** — the harness record
  pins which semconv version a run was produced under, but does not
  alter span emission.
