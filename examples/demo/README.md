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

> **Honesty note.** This README was authored in an environment **without a
> running Docker daemon**, so I did **not** boot the live stack here. The script
> was statically validated (`bash -n` + `shellcheck`, both clean) and every
> request shape is taken from the real handlers (`handlers::runs::check_tool_policy`,
> `handlers::registry::create_agent_version`). The **golden-trace replay below
> is real output I ran** (it needs no stack); the live `check-tool` /
> `audit_events` transcript is produced when *you* run the script. I have not
> pasted a fabricated stack transcript.

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

## Files

- [`run-demo.sh`](./run-demo.sh) — the one-command, self-verifying demo.
- The example agent it governs: [`../safe-pr-agent/agent.yaml`](../safe-pr-agent/agent.yaml) (deny-by-default `allowed_tools`, `approval_required_tools: [write_file, create_pr]`, a per-agent `budget`).
