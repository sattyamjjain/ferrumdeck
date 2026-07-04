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

## Graduated response — R1–R3 (shadow default, opt-in enforce)

A divergence is not just logged: it is mapped onto the existing **reversibility
ladder** ([`fd_policy::reversibility`](graduated-response-levels.md)) via
[`CoherenceSpan::response_level`], reusing the R1–R3 `ResponseLevel` rather than
inventing a new shape. Severity → rung:

| Severity (`risk_level`) | Rung | `ResponseLevel` |
|---|---|---|
| Critical / High (default `risk_score` 70 → High) | **R3** | `require_approval` |
| Medium | **R2** | `allow_under_budget` |
| Low | **R1** | `allow_and_log` |

Two modes, mirroring the Airlock shadow/enforce convention:

- **`shadow` (default)** — the chosen rung is **recorded + surfaced** (audit
  details, SSE, the run's `response_level`), but the run is **never gated**.
  Safe for the heuristic's false-positive rate.
- **`enforce`** (`FERRUMDECK_COHERENCE_MODE=enforce`) — an **R3** divergence
  **gates the run**: its status is set to `WaitingApproval` for human review
  instead of `Completed`. R1/R2 are recorded but not gated.

The deny-by-default posture for *tool permissions* is unchanged; this adds a
graduated response for a *trajectory* signal.

## Operating at R3 vs R1 — when to flip `enforce`

The `shadow`/`enforce` switch is exactly the DeepMind **AI Control Roadmap**
(2026-06-18) Response-tier choice applied to the coherence signal:

- **`shadow` (default) ≈ R1 (asynchronous).** The divergence and its R-tier are
  recorded to the audit trail + surfaced (SSE, the Coherence card), and a human
  reviews after the fact. The roadmap deems R1 acceptable for **low-risk,
  easily reversible** actions — which is the right default here because the
  detector is a lexical heuristic with a non-zero false-positive rate, so you
  do not want it halting runs unattended.
- **`enforce` ≈ R3 (synchronous).** An R3 divergence (default severity → R3)
  **blocks before the run proceeds**: the run is set to `WaitingApproval` for
  human review instead of `Completed`. The roadmap's guidance is that **R1 async
  review is insufficient for critical-infrastructure agents** — a harmful,
  irreversible action (a deploy, a spend, an external send) cannot be undone
  after the fact, so it must be gated *synchronously*.

**Rule of thumb.** Flip `FERRUMDECK_COHERENCE_MODE=enforce` for agents that can
take irreversible, high-consequence actions (prod deploys, payments, data
deletion, external comms) and where a false-positive gate (a run parked at
`WaitingApproval` until a human clears it) is an acceptable cost. Keep the
default `shadow` for exploratory / reversible workloads where you want the
signal recorded but not the friction. Coverage and time-to-response are
unchanged by the mode — only the *response* (record vs gate) differs.

Reference: DeepMind, *An Approach to Technical AGI Safety — AI Control Roadmap*
([blog](https://deepmind.google/blog/securing-the-future-of-ai-agents/),
[PDF](https://storage.googleapis.com/deepmind-media/DeepMind.com/Blog/securing-the-future-of-ai-agents/gdm-ai-control-roadmap.pdf)).
The response ladder is anchored in `fd_policy::reversibility`
(`deepmind-ai-control-roadmap-r1-r3`).

## Where it surfaces

- **Audit**: an `airlock.violation_detected` event with
  `details.violation_type = coherence_divergence` — the **same**
  `audit_events.details` path every other Airlock layer uses (no parallel
  store). `details` also carries `response_level` / `response_rung`, `mode`
  (`shadow` | `enforce`), and `gated`; `details.coherence` is the full
  `CoherenceSpan`. `details.blocked` equals `gated`.
- **SSE**: a `coherence.divergence.detected` event on the run stream
  (`run:{run_id}`) carrying the category, confidence, `response_level` /
  `response_rung`, `gated`, and the stated-fact / contradicting-action quotes.
  Gateway→BFF push is deferred (same pattern as `run.forecast.updated` /
  `routing.decision.recorded`); the BFF locks the wire shape and the console
  reads the persisted flag + rung on the next poll.
- **Run row**: `runs.coherence_divergence_flagged` (`true` when a divergence
  fired, `false` for a coherent completed run, `NULL` for legacy runs) and
  `runs.response_level` (the selected rung), returned on `GET /v1/runs/{id}`.
- **Span**: `ferrumdeck.reliability.coherence_divergence` (boolean) on the
  run-completion span.
- **Dashboard**: a "Coherence" stat card on the run header — amber "Divergent"
  when flagged, green "Coherent" otherwise, hidden (null-for-legacy) when the
  field is absent; the R-rung shows on the existing `ResponseLevelBadge`.

## Configuration

`CoherenceConfig` (separate from the per-call `AirlockConfig`) — `enabled`,
`lookahead` (default 8), `risk_score` (70), `min_confidence` (0.5). Env toggles:

- `FERRUMDECK_COHERENCE_ENABLED=false` — disable the monitor entirely.
- `FERRUMDECK_COHERENCE_MODE=enforce` — gate R3 divergences (default `shadow`,
  which records + surfaces but never gates).

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

## Reproducible demo

`examples/demo/coherence-drift.py` (section 8 of `examples/demo/run-demo.sh`)
feeds a deliberately drifting trajectory through the same detection core and
prints each divergence + its R-tier + the shadow/enforce action + the SSE shape.
Pure, no stack, self-verifying (exits non-zero if the drift is not caught):

```
uv run python examples/demo/coherence-drift.py
```

## Verifying

- Rust unit + parity: `cargo test -p fd-policy coherence` (incl.
  `response_level_maps_severity_to_r_tier`).
- Rust live-consumer integration:
  `cargo test -p gateway coherence_live_consumer` (incl.
  `enforce_mode_gates_r3_divergence`).
- Demo: `uv run python examples/demo/coherence-drift.py`.
- Python (CI-gated):
  `uv run pytest python/packages/fd-evals/tests/test_coherence.py`.
- Cross-plane: the Rust `golden_fixture_matches_python` and Python
  `TestGoldenParity` assert the same divergence categories on the shared
  fixture.
