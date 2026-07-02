# Coherence-Divergence Monitor (Strained Coherence)

## What it is

A per-run **trajectory-level** reliability signal. Every other Airlock layer
inspects a *single* tool call in isolation; this monitor watches the whole run
**trajectory** for a sequential failure no per-call check can see: the agent
**states a blocking fact** that should change its plan ("tests still failing",
"permission denied", "the file does not exist") and the very next *advancing*
action proceeds **as if that fact were untrue** (marks the task done, commits,
reports success).

Anchored on **Strained Coherence**
([arXiv:2606.07889](https://arxiv.org/abs/2606.07889)): trajectories exhibiting
this divergence failed **94%** of the time versus **46%** without it (Fisher's
exact p = 0.003) — a pre-failure signal worth surfacing *before* the run
finishes, not only in a post-hoc autopsy.

## Honest scope — a deterministic keyword matcher

Detection is a **deterministic lexical matcher**, not an LLM judge: a statement
is a *blocking fact* when it contains a category keyword (test failure /
permission denied / missing resource / build error / generic error); an action
is a *closure* when it contains an advancing keyword (commit, mark complete,
deploy, report success…). It is pure and CI-stable — same trajectory → same
verdict on every machine. False-positive guards keep it honest: a run that
**resolves** the fact (states tests pass, file created, build succeeded), a
**generic resolution** ("issue resolved"), or an action that **disclaims**
success ("cannot mark complete: permission denied") does **not** fire, and a
`min_confidence` floor + a `lookahead` staleness window bound spurious pairings.

## Wired live at the gateway run stream

As each step is submitted (`submit_step_result`), the run's step is projected
into trajectory events and fed to a process-wide `CoherenceMonitor` keyed per
run:

- a **Tool** step → an advancing **action** (the invocation, e.g. `git_commit`)
  followed by a **statement** (its observed output/error, e.g. "tests failed");
- a **reasoning / other** step → statements only.

Feeding action-before-statement means a later step's closure action is checked
against blocking facts opened by earlier steps' outputs — the sequential
pattern the monitor detects. `observe_event` returns a `CoherenceSpan` the
instant a divergence completes, mid-run. At **completion**, a synthetic
"reports success" closure action carrying the final output is fed, so a run that
terminates with an unresolved blocking fact (and does not disclaim it) also
flags; an honest disclaimer in the final output suppresses it.

## Reliability signal, not a gate

A divergence **surfaces**; it never blocks a tool or changes run status —
mirroring the claim-grounding "flag, never block" posture. The deny-by-default
posture is for *tool permissions*, not for reliability scoring.

## Where it surfaces

- **Audit**: an `airlock.violation_detected` event with
  `details.violation_type = coherence_divergence` — the **same**
  `audit_events.details` path every other Airlock layer uses (no parallel
  store). `details.coherence` carries the full `CoherenceSpan` (stated fact,
  category, contradicting action, confidence, gap, anchor); `details.blocked`
  is always `false`.
- **Run row**: `runs.coherence_divergence_flagged` (`true` when a divergence
  fired, `false` for a coherent completed run, `NULL` for legacy runs that
  predate the live consumer), returned on `GET /v1/runs/{id}`.
- **Span**: `ferrumdeck.reliability.coherence_divergence` (boolean) on the
  run-completion span.
- **Dashboard**: a "Coherence" stat card on the run header — amber "Divergent"
  when flagged, green "Coherent" otherwise, hidden (null-for-legacy) when the
  field is absent.

## Configuration

`CoherenceConfig` (separate from the per-call `AirlockConfig`) — `enabled`,
`lookahead` (default 8), `risk_score` (70), `min_confidence` (0.5). The gateway
enables it by default; disable with `FERRUMDECK_COHERENCE_ENABLED=false`.

## Limitation — single-process trajectory state

The per-run trajectory state lives in gateway memory (`CoherenceMonitor`'s
per-run map). In a multi-instance gateway deployment, a run is tracked only
within the instance that receives its steps; steps routed to a different
instance would not share the open-fact window. The completion-time synthetic
closure still flags the common "reports success despite an in-step blocker"
case within the completing instance. A shared/replayed-from-DB trajectory
source is the follow-up for multi-instance parity.

## Dual implementation, one contract

| Plane | Module | Role |
|---|---|---|
| Rust | `fd_policy::airlock::coherence` | the live gateway monitor (`observe_event`) + stateless `scan_trajectory` |
| Python | `fd_evals.coherence` | eval-plane mirror — replays a trajectory offline with the identical detection core |

A shared golden fixture
(`fd-evals/tests/fixtures/coherence_divergence.golden.json`) is asserted by
**both** the Rust `golden_fixture_matches_python` test and the Python
`TestGoldenParity` test, pinning that the two planes classify an identical
trajectory identically.

## Verifying

- Rust unit + parity: `cargo test -p fd-policy coherence`.
- Rust live-consumer integration:
  `cargo test -p gateway coherence_live_consumer`.
- Python (CI-gated):
  `uv run pytest python/packages/fd-evals/tests/test_coherence.py`.
- Cross-plane: the Rust `golden_fixture_matches_python` and Python
  `TestGoldenParity` assert the same divergence categories on the shared
  fixture.
