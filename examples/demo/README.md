# FerrumDeck — 5-minute reproducible governance demo

One command. It boots the local stack and proves, against the **real gateway
API**, the four control-plane guarantees that make FerrumDeck an AgentOps
control plane rather than a wrapper:

| # | Guarantee | How the demo proves it |
|---|---|---|
| 1 | **Deny-by-default tool policy** | an un-allowlisted tool returns `allowed=false` |
| 2 | **Approval gate (human-in-the-loop)** | a write tool returns `requires_approval=true` |
| 3 | **Immutable audit trail** | every decision is read back from `audit_events` (append-only; the repo exposes no `UPDATE`/`DELETE`) |
| 4 | **OTel / GenAI spans** | the `check-tool` spans land in Jaeger |
| 5 | **Coherence-divergence caught mid-run** | a deliberately drifting run fires a divergence + an R1–R3 response (pure, no stack) |
| + | **Golden-trace replay** | a deterministic metric wire-contract regression (pure, no stack) |

## Run it

```bash
# prerequisites: docker, jq, uv  (an Anthropic key is only needed for Part B)
./examples/demo/run-demo.sh
# teardown:
make dev-down
```

The script is **self-verifying**: it asserts each governance property with
`jq` and **exits non-zero if any assertion fails** (so CI or a skeptical reader
gets a hard pass/fail, not a screenshot to trust).

### What it does (against the real interface)

- `make dev-up` → postgres · redis · gateway (`:8080`) · jaeger (`:16686`) · worker · dashboard (`:8000`). The gateway auto-migrates and seeds the dev key + "Safe PR Agent".
- Registers a demo agent version via `POST /v1/registry/agents/{id}/versions` with a deny-by-default allowlist, an `approval_required_tools` gate, an explicit `denied_tools` entry, and a hard `max_cost_cents` budget.
- Creates a run (`POST /v1/runs`) and drives the policy engine directly via `POST /v1/runs/{id}/check-tool` for an **ALLOW / APPROVAL / DENY** tool — the deterministic governance proof, **no LLM key required**.
- Reads the run's `audit_events` straight from Postgres (the immutable trail).
- Prints the Jaeger + dashboard URLs and runs the golden-trace replay.

**Part B (optional, needs `ANTHROPIC_API_KEY`):** the full agentic loop —
`ANTHROPIC_API_KEY=sk-... make eval-run` runs the seeded Safe PR Agent through
the fd-evals smoke suite, exercising live **budget auto-kill** (the worker's
`submit_step_result` → `check_budget` → `RunStatus::BudgetKilled` + a
`budget.exceeded` audit event) and the approval queue.

## Captured output

> **Live transcript (CI-generated, not hand-pasted).** The `check-tool` /
> `audit_events` transcript from an actual boot of the stack is produced by CI, not
> written by hand: the [`demo-quickstart`](../../.github/workflows/demo-quickstart.yml)
> workflow runs this script on a schedule against the **published GHCR images** and
> commits the dated output to [`TRANSCRIPT.md`](TRANSCRIPT.md). (This supersedes the
> earlier note that no stack had been booted here.) The **golden-trace replay below
> is real output** and needs no stack. If `TRANSCRIPT.md` still says "pending", the
> first post-release run has not landed yet — run the script yourself (see the top of
> [QUICKSTART.md](../../QUICKSTART.md)) for the same `✓`/`✗` output live.

**Golden-trace replay — actually run (`uv run pytest …test_tool_call_firing_rate_golden.py`):**

```
python/.../test_tool_call_firing_rate_golden.py::test_synthetic_workflow_export_matches_golden PASSED [ 25%]
python/.../test_tool_call_firing_rate_golden.py::test_compute_matches_compute_from_steps      PASSED [ 50%]
python/.../test_tool_call_firing_rate_golden.py::test_empty_step_list_does_not_breach          PASSED [ 75%]
python/.../test_tool_call_firing_rate_golden.py::test_low_rate_breaches_default_threshold      PASSED [100%]
============================== 4 passed in 0.27s ===============================
```

It replays a synthetic agent trace through `fd_evals.firing_rate.compute_from_steps`
and diffs the export-shape JSON against the pinned golden
(`tests/fixtures/tool_call_firing_rate.golden.json`) — the same wire contract
the Rust gateway tags onto the OTel span via `fd_otel::firing_rate::record_on_span`.

**What the live governance assertions check** (the `jq` predicates in the
script — your transcript will show `✓`/`✗` for each):

```
ALLOW    read_file_…           → allowed=true   requires_approval=false
APPROVAL write_file_…          → requires_approval=true
DENY     exfiltrate_secrets_…  → allowed=false
DEMO OK ✓  3 governance assertions passed.
```

## Coherence-divergence live-fire

Section 8 of the demo runs [`coherence-drift.py`](./coherence-drift.py) — a
**pure, no-stack, self-verifying** proof that a deliberately drifting run (states
"tests failing" / "permission denied", then commits / deploys anyway) is caught
by the **same detection core the live gateway runs on each step**, and mapped
onto the reversibility ladder (R1–R3). It exits non-zero if the drift is *not*
caught, and asserts the coherent control run does **not** fire.

Against the live gateway (Part B, a real agentic run) the same divergence:
- writes an `audit_events` row with `violation_type=coherence_divergence` (the
  identical Airlock `details` path),
- emits the `coherence.divergence.detected` SSE event on the run stream, and
- surfaces on the run's **Coherence** card.

It runs **shadow by default** (records + surfaces, never blocks). Set
`FERRUMDECK_COHERENCE_MODE=enforce` to gate an R3 divergence — the run halts at
`WaitingApproval` for human review instead of being marked complete.

## Files

- [`run-demo.sh`](./run-demo.sh) — the one-command, self-verifying demo.
- [`coherence-drift.py`](./coherence-drift.py) — the pure coherence-divergence live-fire proof (section 8).
- The example agent it governs: [`../safe-pr-agent/agent.yaml`](../safe-pr-agent/agent.yaml) (deny-by-default `allowed_tools`, `approval_required_tools: [write_file, create_pr]`, a per-agent `budget`).
