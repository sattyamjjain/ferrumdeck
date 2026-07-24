# FerrumDeck

**FerrumDeck is a deterministic Rust *enforcement* plane for AI agents — it blocks the tool call in-process, it doesn't just chart it after the fact.** Deny-by-default tool policy, per-run budget enforcement, runtime (Airlock) inspection, approval gates, and an append-only audit trail — all in the request path, returning an allow/deny/approve decision *before* the agent acts.

> **Enforce, don't just observe.** LangSmith, Phoenix, Galileo, and Fiddler *watch* your agent and tell you afterward what it did. FerrumDeck sits in the call path and *enforces* — it returns `allowed=false` and the tool never fires. Observability is a dashboard you read after the incident; enforcement is the gate that prevents it. And because the gate sits in the trace, **every decision it makes is itself a queryable OTel GenAI span** (`ferrumdeck.decision = allow|deny|approval|kill`) — you enforce and observe in one pass, not two tools.

**See the blind spot for yourself.** [`docs/benchmarks/enforce-vs-observe.md`](docs/benchmarks/enforce-vs-observe.md) runs one AgentDojo-style injection trace two ways over the *same* governance profile: a record-only stack that emits a span *after* the unsafe `send_email` already ran, versus the in-path gate that emits `ferrumdeck.decision=deny` on the same span and the call never fires. Deterministic, offline, no LLM — spans captured with an in-memory exporter so the output is real telemetry, not a mock. Reproduce with `make bench-enforce-vs-observe`.

**"But won't in-path enforcement slow my agent down?"** No — the decision is sub-millisecond. Measured CPU cost of the governance decision itself (Apple M4, `--release`, decision path only — excludes DB / queue / LLM):

| Enforcement layer | p50 | p95 |
|---|---|---|
| Deny-by-default allowlist check | **183 ns** | 192 ns |
| Airlock RASP inspection (benign call) | **437 ns** | 503 ns |
| R1–R3 reversibility ladder | **0.54 ns** | 0.63 ns |
| EU AI Act Art. 50 transparency rule | **222 ns** | 257 ns |

An LLM step costs hundreds of ms to seconds; ~1 µs of in-path governance is ~6 orders of magnitude smaller than the call it gates. Reproduce with `make bench-enforcement`; methodology + full table (incl. deny / RCE-blocked cases) in [`docs/benchmarks/enforcement-latency.md`](docs/benchmarks/enforcement-latency.md). This is the added decision cost, not end-to-end latency — no "fastest"/"first" claim.

**Governed vs ungoverned — the number the closed platforms don't publish.** One fixed safe-PR-agent workload, run with the policy engine ON and OFF: **governed blocked 100% of injected unsafe tool actions (4/4 — RCE write, raw-IP exfil, denied tool, over-budget loop) vs 0% ungoverned, while adding ≈1 µs of decision latency per call and costing 54% *less* to run** (85¢ vs 184¢ — stopping the unsafe + runaway calls saved more than the decisions cost). Deterministic, offline, no LLM; blocked-% pinned to the real Rust engine by `cargo test -p ferrumdeck-policy --test governed_benchmark`; traces carry a W3C `traceparent` (MCP SEP-414). Reproduce with `make bench-governed`; method + numbers in [`docs/BENCHMARK.md`](docs/BENCHMARK.md).

**x402 spend gate — budget enforcement for autonomous payments.** The [x402 protocol](https://x402.org) (Coinbase-contributed, now stewarded by the [x402 Foundation under the Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications), 2026-07-14; [Cloudflare's Monetization Gateway](https://blog.cloudflare.com/monetization-gateway/) began charging agents per access over it 2026-07-01) lets an agent pay for a paywalled resource inline — the server answers with **HTTP `402 Payment Required`** and a stablecoin quote, and the agent pays and retries. FerrumDeck extends the *same* per-agent budget that caps token spend to that new category: it prices the 402 quote in cents (a first-class cost event on the same ledger as inference), checks it against the **remaining** budget **before** the payment is authorized, and **hard-stops** (deny + one alert) if paying would breach the ceiling. It moves no money — a `simulate → gate → record` demo only. This is the same posture platform vendors are converging on ([Databricks Unity AI Gateway](https://www.databricks.com/blog/ai-governance-data-ai-summit-2026-whats-new-unity-ai-gateway) hard spend caps over any model/agent/MCP service; [FinOps FOCUS 1.4](https://siliconangle.com/2026/06/08/focus-specification-ai-cost-accountability-finopsx/) extending cost accounting to AI token/agent economics), done deny-by-default in-path. Run it: `cargo run -p ferrumdeck --example x402_spend_gate` — [examples/x402-spend-gate](examples/x402-spend-gate/README.md) (`fd_policy::x402`).

▶ **[Run the 5-minute reproducible demo →](examples/demo/README.md)** — one command boots the local stack and, against the **real gateway API**, you watch a **budget-breach auto-kill** and a **denied tool call** happen in-process. It's self-verifying: each guarantee is asserted with `jq` and the script exits non-zero on failure, so you get a hard pass/fail, not a screenshot to trust.

> **Status: early / alpha, built primarily by one maintainer.** The governance core — per-agent deny-by-default tool allowlists, per-run/per-agent budget enforcement, DB-backed tenant isolation, and Airlock RASP at the gateway tool-policy check — is implemented and tested. Several advertised layers are still being wired end-to-end. See **[Project Status & Limitations](#project-status--limitations)** for an honest map of what enforces today vs. what's on the roadmap before you rely on it.

[![CI](https://github.com/sattyamjjain/ferrumdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/sattyamjjain/ferrumdeck/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.80+-orange.svg)](https://www.rust-lang.org/)
[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/next.js-16.1-black.svg)](https://nextjs.org/)

---

## Install from crates.io

The enforcement engine is published — you can depend on it, not just clone it. One dependency via the umbrella crate:

```bash
cargo add ferrumdeck
```

```rust
use ferrumdeck::{PolicyEngine, ToolAllowlist};

let engine = PolicyEngine::default();
let allowlist = ToolAllowlist { allowed_tools: vec!["read_file".into()], approval_required: vec![], denied_tools: vec!["delete_repo".into()] };
assert!(engine.evaluate_tool_call_with(&allowlist, "read_file").is_allowed()); // allowed
assert!(engine.evaluate_tool_call_with(&allowlist, "delete_repo").is_denied()); // denied
assert!(engine.evaluate_tool_call_with(&allowlist, "unknown").is_denied());     // deny-by-default
```

Prefer the engine directly (no umbrella)? `cargo add ferrumdeck-policy` — the import path is still `use fd_policy::…`. Primitives only: `ferrumdeck-core` (`use fd_core::…`). All three are Apache-2.0. (Published as `ferrumdeck*` because the bare `fd-core` name is taken on crates.io by an unrelated crate; the Rust import paths are unchanged.)

---

## What this proves

FerrumDeck is the **control plane, not the agent** — the production layer that makes an autonomous agent safe to run: it decides which tools a run may call, kills runs that blow their budget, gates risky actions on a human, and records every decision in an immutable trail. It's built as a credibility artifact for an **AgentOps / AI-infrastructure** audience.

▶ **[Run the 5-minute reproducible demo →](examples/demo/README.md)** — one command boots the local stack and verifies, against the real gateway API, the four guarantees below:

- **Deny-by-default tool policy** — a run may only call tools on its per-agent allowlist; everything else is denied. (`POST /v1/runs/{id}/check-tool`)
- **Budget auto-kill** — every run carries a hard token / cost / tool-call / wall-time budget; a breach kills the run and appends a `budget.exceeded` event. (`fd_policy::budget` → `RunStatus::BudgetKilled`)
- **Coherence-divergence caught mid-run** — when an agent states a blocking fact ("tests failing", "permission denied") and then advances as if it were untrue, the live monitor catches it on the run stream and applies the reversibility ladder (R1–R3). (`fd_policy::airlock::coherence`)
- **Immutable audit trail** — every policy, budget, and approval decision is appended to `audit_events`; the repository exposes no `UPDATE`/`DELETE`.
- **OTel GenAI spans — and every enforce decision is one** — every LLM/tool step emits OpenTelemetry GenAI-semconv spans to Jaeger, and so does every enforcement decision: the tool-policy check writes a `gen_ai.tool.call` span carrying `ferrumdeck.decision = allow|deny|approval|kill`, `ferrumdeck.reason`, `ferrumdeck.rung` (R1–R3), and `ferrumdeck.budget_remaining`, so the allow/deny you enforce is the span you query. Naming follows the GenAI-semconv stability opt-in (`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental` → `execute_tool` + `gen_ai.operation.name`); Rust gateway and Python worker write one schema. (`fd_otel::decision` · `fd_runtime.tracing`)

The demo is **self-verifying** — it asserts each property with `jq` and exits non-zero on failure, so it works as a smoke test, not a screenshot. For an honest map of what enforces today vs. what's still being wired, see **[Project Status & Limitations](#project-status--limitations)**.

### Reproduced: indirect-prompt-injection defense-path coverage

Against a vendored **AgentDojo-style** ([arXiv:2406.13352](https://arxiv.org/abs/2406.13352)) indirect-injection corpus (25 cases: 17 attacks — off-allowlist tools, RCE payloads, data-exfil destinations — and 8 benign controls), FerrumDeck's deny-by-default tool allowlist + Airlock RASP block:

| Metric | Value | 95% CI (Wilson) |
|---|---|---|
| **Block-rate under attack** | **100.0%** (17/17) | **[81.6%, 100%]** |
| **Benign-task utility preserved** | 100.0% (8/8) | [67.6%, 100%] |

One-command repro (deterministic, offline, **no LLM required**):

```bash
uv run python -m fd_evals injection-defense --suite injection_defense   # or: make eval-injection-defense
```

**Honest framing:** this measures **defense-path coverage on a fixed governance profile** — the fraction of injected malicious *tool calls* the policy/RASP layer blocks — **not** model robustness, and not a general "injection-proof" claim. The corpus is **pinned to the real Rust `fd_policy` RASP** by `cargo test -p fd-policy --test injection_defense` (which runs the actual `AirlockInspector` over every case), and the fd-evals mirror must agree with it. Small vendored corpus ⇒ a wide CI; the number moves as the corpus grows. No "first"/"best" claim.

### Second axis: Agent Security Bench (ASB) + an EU AI Act Art. 50 transparency rule

The `injection_defense` axis above is AgentDojo (*indirect* injection). The **`asb`** axis adds a second, complementary set: attack classes from **Agent Security Bench** ([arXiv:2410.02644](https://arxiv.org/abs/2410.02644)) that AgentDojo does **not** cover — the **Plan-of-Thought (PoT) backdoor**, **memory poisoning**, and **direct prompt injection** — run through the same governance path **plus the R1–R3 reversibility ladder**. The point of difference: a backdoored plan that reaches an *allowlisted-but-irreversible* action (a `deploy`, an `apply_migration`) is stopped not by the allowlist but by the **R3 rung** (`irreversible → require_approval`, so it never auto-executes). That is graduated enforcement catching an attack a static allowlist would wave through.

| Metric | Value | 95% CI (Wilson) |
|---|---|---|
| **ASB block-rate under attack** | **100.0%** (13/13) | **[77.2%, 100%]** |
| **Benign-task utility preserved** | 100.0% (8/8) | [67.6%, 100%] |
| **Art. 50: non-compliant responses denied** | 100.0% (6/6) | [61.0%, 100%] |
| **Art. 50: compliant responses preserved** | 100.0% (4/4) | [51.0%, 100%] |

Of the 13 ASB attacks, **4 are stopped specifically by the R3 reversibility rung** (the PoT-backdoor class), the rest by deny-by-default, the anti-RCE matcher, and the exfiltration shield.

The **EU AI Act Article 50** rule (`fd_policy::transparency_art50`) is a transparency *enforcement* rule on the same R1–R3 ladder: a governed generative response must carry a human-readable **AI disclosure** *and* a **machine-readable** synthetic-content marker; in `enforce` mode a response missing either is **denied before release** (R3), in `shadow` it is logged (R1).

One-command repro (deterministic, offline, **seeded, no LLM**):

```bash
uv run python -m fd_evals asb --suite asb --seed 0   # or: make eval-asb
```

**Honest framing:** the ASB number measures whether the malicious *action* is stopped from auto-executing on a fixed governance profile — **not** that FerrumDeck detects the backdoor *trigger* or the poisoned *memory* semantically, and **not** model robustness (no LLM). The Art. 50 rule is a **structural** check (presence of a disclosure phrase + a machine-readable marker), not a truthfulness or standard-conformance (C2PA/SynthID) judgement. Both are **pinned to the real Rust enforcement** by `cargo test -p fd-policy --test asb_defense` — which runs the actual `ToolAllowlist` + `AirlockInspector` + reversibility ladder and the real `transparency_art50` rule over every case, and asserts the R3 rung is the *decisive* layer for the PoT class — and the `fd_evals.asb` mirror must agree. Small vendored corpus ⇒ wide CIs. No "first"/"best" claim.

### Live-fire: a drifting run is caught and R-tiered (deterministic, no stack)

`examples/demo/coherence-drift.py` feeds a deliberately drifting trajectory through the **same detection core the live gateway runs on each step**, and is self-verifying (exits non-zero if the drift is *not* caught). Real captured output:

```
▸ Drifting run — states a blocking fact, then advances as if it were untrue
  ✗ DIVERGENCE [test_failure] confidence=1.00
      stated:       '2 tests failed: assertion error in auth flow'
      then did:     'git_commit: commit: fix auth flow'
      response:     R3 (require_approval)   shadow → record + surface   enforce → GATE run → WaitingApproval
      sse coherence.divergence.detected {category:test_failure, response_rung:R3, gated(enforce):True}
  ✗ DIVERGENCE [permission_denied] confidence=1.00
      stated:       'deploy blocked: permission denied on prod'
      then did:     'deploy: shipping to production, reporting success'
      response:     R3 (require_approval)   shadow → record + surface   enforce → GATE run → WaitingApproval

▸ Coherent control — resolves the fact before advancing (must NOT fire)
  ✓ no divergence — the resolved run is clean

COHERENCE OK ✓  2 divergences fired (both R3), control clean. In enforce mode each R3 gates the run for review.
```

Against the live gateway the same divergence writes an `audit_events` row with `violation_type=coherence_divergence`, emits the `coherence.divergence.detected` SSE event, and surfaces on the run's **Coherence** card. It runs **shadow by default** (records + surfaces, never blocks); set `FERRUMDECK_COHERENCE_MODE=enforce` to gate an R3 divergence (run → `WaitingApproval`). This is the **enforce-not-observe** wedge: FerrumDeck acts on the drift, it doesn't just chart it.

### Mapping to the DeepMind AI Control Roadmap (D1–D4 / R1–R3)

Google DeepMind's [**AI Control Roadmap**](https://storage.googleapis.com/deepmind-media/DeepMind.com/Blog/securing-the-future-of-ai-agents/gdm-ai-control-roadmap.pdf) (2026-06-18, [blog](https://deepmind.google/blog/securing-the-future-of-ai-agents/)) frames agent security on two axes: **Detection tiers D1–D4** (set by the *model's detection-evasion capability* — how hard a misaligned agent is to catch) and **Prevention & Response tiers R1–R3** (set by the *model's attack-execution capability* — how strong the response must be). FerrumDeck already names this ladder in `fd_policy::reversibility` (anchor `deepmind-ai-control-roadmap-r1-r3`). To be precise and avoid overclaiming: **D1–D4 is an adversary-capability rating, not something a defense tool "is"** — FerrumDeck maps onto the **R-tier response axis** and the roadmap's operational **metrics**, not onto a self-assigned detection tier.

**Response tier → FerrumDeck mechanism** (R3 = synchronous *block-before-execute*; R1 = asynchronous *review-after-the-fact*):

| Roadmap tier | What the roadmap requires | FerrumDeck mechanism (today) |
|---|---|---|
| **R3 — synchronous** | block a harmful action *before* it executes | Deny-by-default tool-policy check (`POST /v1/runs/{id}/check-tool` returns `allowed=false`, tool never fires); budget auto-kill (`RunStatus::BudgetKilled`); **coherence divergence in `enforce` mode** — an R3 divergence gates the run → `WaitingApproval` |
| **R2 — conditional** | proceed only while it stays within bounds | Reversibility ladder `allow_under_budget` — a costly action proceeds while the budget gate has headroom, else escalates to R3 |
| **R1 — asynchronous** | record + review the transcript, remediate after | **coherence divergence in `shadow` mode** (default) records + surfaces the R-tier but does not gate; post-hoc `CoherenceMonitor::scan_trajectory`; the append-only `audit_events` trail |

**Detection → the roadmap's live metrics.** DeepMind measures a control system by **coverage** (fraction of agent traffic monitored), **recall** (fraction of misaligned behaviors caught), and **time-to-response**:

- **Coverage** — the `CoherenceMonitor` observes the run's trajectory event stream (each submitted step), so coverage is the fraction of the run stream it sees. (Honest limit: today it is fed at the gateway step-submission choke point, not the in-loop agentic executor — see [Project Status & Limitations](#project-status--limitations).)
- **Recall** — the divergence pattern is the Strained-Coherence signal (`arxiv:2606.07889`); the shared cross-plane golden fixture pins detection so recall doesn't silently regress.
- **Time-to-response** — `CoherenceMonitor::observe_event` fires **mid-run**, the instant a divergence completes, *before the run finishes* — not only in a post-hoc autopsy. That is what moves the same signal from R1 (async) to R3 (synchronous) when `enforce` is on.

**Honest scope.** R3 enforcement of a coherence divergence is **opt-in** (`FERRUMDECK_COHERENCE_MODE=enforce`) and **shadow-by-default** — the heuristic is a lexical matcher with a non-zero false-positive rate, so gating is a deliberate choice for high-consequence agents (the roadmap's own point: R1 async review is insufficient for critical-infrastructure agents where a harmful action can't be undone after the fact). The mapping above is **machine-checked**: `examples/demo/coherence-drift.py` prints and asserts the `R3 → "DeepMind R3: synchronous block-before-execute"` label and that the `enforce` path gates it, exiting non-zero if that ever stops holding. Several advertised layers remain in-progress — see **[Project Status & Limitations](#project-status--limitations)** before relying on any tier.

---

## Table of Contents

- [What This Proves](#what-this-proves)
  - [Mapping to the DeepMind AI Control Roadmap (D1–D4 / R1–R3)](#mapping-to-the-deepmind-ai-control-roadmap-d1d4--r1r3)
- [Overview](#overview)
- [Project Status & Limitations](#project-status--limitations)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Components](#components)
  - [Control Plane (Rust)](#control-plane-rust)
  - [Data Plane (Python)](#data-plane-python)
  - [Dashboard (Next.js)](#dashboard-nextjs)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Security Model](#security-model)
- [Observability](#observability)
- [Evaluation Framework](#evaluation-framework)
- [Development](#development)
- [Deployment](#deployment)
- [License](#license)

---

## Overview

FerrumDeck solves the critical challenge of running AI agents safely in production. While LLMs are probabilistic and unpredictable, production systems require deterministic governance, audit trails, and budget controls.

### The Problem

- AI agents can make costly mistakes (token spend, wrong tool calls)
- Prompt injection attacks can bypass safety measures
- No visibility into what agents are doing in production
- Difficult to reproduce and debug agent failures
- Compliance requirements demand audit trails

### The Solution

FerrumDeck provides a **dual-plane architecture**:

| Control Plane (Rust) | Data Plane (Python) |
|---------------------|---------------------|
| Deterministic state | Probabilistic execution |
| Policy enforcement | LLM interactions |
| Budget tracking | Tool calls via MCP |
| Audit logging | Step execution |
| Approval gates | Artifact storage |

---

## Project Status & Limitations

FerrumDeck is an **early-stage / alpha** project, built primarily by a single
maintainer. It is a real, working control plane — but it is not yet
production-hardened. This is an honest map of what enforces **today** vs. what is
**scaffolded or on the roadmap**, so you can evaluate it without surprises.

**Implemented and enforced (covered by the Rust test suite):**

- **Deny-by-default tool policy, per agent.** The gateway evaluates every tool
  call against the run's *agent* allowlist (allowed / approval-required / denied
  tiers) — not a process-global default.
- **Budget enforcement, per run / per agent.** The auto-kill and the cost
  forecast evaluate against the run's effective budget (per-run `config.budget`
  override → agent-version caps → engine default).
- **Tenant isolation.** Project-scoped access is gated by a DB-backed
  `project → workspace → tenant` ownership check; unknown project or tenant
  mismatch is denied.
- **Airlock RASP at the gateway tool-policy check** (`POST /v1/runs/{id}/check-tool`):
  the anti-RCE pattern matcher, the financial/velocity circuit breaker, and the
  data-exfiltration + credential-DLP shield run here, in `shadow` or `enforce`
  mode.
- **Append-only audit trail** for policy, budget, approval, routing, and
  promotion decisions (the repository exposes no `UPDATE`/`DELETE`).
- **Coherence-divergence monitor**, wired live at the gateway run stream. As
  each step is submitted, the run's trajectory is fed to the `CoherenceMonitor`;
  a stated-blocking-fact → contradicting-closure-action divergence surfaces
  mid-run through the same `airlock.violation_detected` audit path, is persisted
  on the run row (`coherence_divergence_flagged`), and emitted on the completion
  span. A reliability **signal** — it never blocks a tool or kills a run.

**Scaffolded / not yet wired end-to-end — do not rely on these yet:**

- **Airlock on the agentic execution path.** The Python worker's *agentic
  LLM-loop* executor does not yet call back to the control-plane `check-tool`
  endpoint, so Airlock and approval gates are enforced on the explicit
  `StepType.TOOL` path but **not** inside an in-loop agentic run. Wiring this is
  the top roadmap item; until then, run agentic workloads only in trusted
  contexts.
- **Schema-drift and behavioral-drift Airlock layers** are implemented and
  unit-tested but are **not activated** in the running gateway (they need
  `tool_version_id` / `agent_id` plumbed into the inspection context).
- **Trace→signal loop (HarnessX).** The harness-suggestion governance
  endpoints (`/v1/harness-suggestions*`) and the training-signal export
  (`POST /v1/runs/{id}/training-signal`, redacted server-side via the audit
  redaction path) are implemented, unit-tested, and wired into the dashboard.
  But the **evals dashboard data is still BFF-stubbed** (`/api/v1/evals/*`
  returns empty until a gateway eval backend lands), so the full
  eval→gateway→dashboard round-trip is demonstrable only with a live stack and
  a non-stub eval feed. Approving a suggestion **records** the decision; it
  never auto-applies a policy/allowlist/budget change.
- **Audit tamper-evidence.** The log is append-only at the application layer,
  but there is **no cryptographic hash-chain or DB-level write-once enforcement
  yet** — so it is not tamper-*evident* against a privileged database actor. A
  hash-chain is on the roadmap; please don't represent the trail as
  immutable/tamper-proof for compliance until it ships.
- **Multi-tenant SaaS hardening.** Tenant isolation is enforced, but there is no
  dashboard auth/session layer, no SSO/RBAC, and no API-key self-service — treat
  the dashboard + gateway as a **trusted-operator** deployment for now.

**Testing caveat.** The unit/lint suites (`cargo test --workspace`, clippy,
`ruff`, jest) pass and gate CI. The `tests/security`, `tests/chaos`, and
`tests/e2e` suites require a live stack (`make dev-up`) and currently assert
liveness more than behaviour — do not read them as proof that a given attack is
blocked. Hardening them is in progress.

Found a gap not listed here? Please open an issue — accurate status is a feature.

---

## Key Features

### Governance
- **Deny-by-Default Tools**: Only explicitly allowed tools can be called
- **Approval Gates**: High-risk actions require human approval before execution
- **Budget Enforcement**: Automatic run termination when limits exceeded (tokens, cost, time)
- **Predictive Budget Forecast**: Deterministic linear + EWMA projection of end-of-run cost after every step, surfacing a `budget_breach_projected` flag on the run API + SSE event (`run.forecast.updated`) before the auto-kill fires. See [`docs/runbooks/budget-forecast.md`](docs/runbooks/budget-forecast.md).
- **Policy Engine**: Configurable rules for tool access and risk management
- **[Airlock RASP](#airlock-rasp)**: Five runtime self-protection layers on every tool call — anti-RCE pattern matcher, financial circuit breaker, data-exfiltration shield, schema-drift guard, behavioral-drift monitor. Shadow or enforce modes.
- **Explicit Conflict Resolution + Decision Traces**: When multiple policies match a tool call, a named precedence function (`Deny > RequiresApproval > BudgetCap > Allow`) picks the winner deterministically, and every decision carries an audit-grade trace of matched verdicts and overrides surfaced on the run API + `policy.decision.explained` SSE event. See [`docs/runbooks/policy-conflict-resolution.md`](docs/runbooks/policy-conflict-resolution.md).
- **Routing-Decision Audit (multi-agent coordination)**: Every time the orchestrator binds a subtask to a concrete agent / role / model, a `RoutingDecision` record (candidates considered, chosen binding, reason code, SHA-256 content hash) is written through the existing immutable audit trail and surfaced on `GET /v1/runs/{id}/routing` plus the `routing.decision.recorded` SSE event. fd-evals replays compare the content hash to detect coordination drift. Anchor: AgensFlow ([arXiv:2605.27466](https://arxiv.org/abs/2605.27466)). See [`docs/runbooks/routing-decision-audit.md`](docs/runbooks/routing-decision-audit.md).
- **Champion-Challenger Promotion Gate**: A registered challenger version cannot replace the live champion until it clears a deterministic gate — configurable metric thresholds (inclusive floors) **plus** a required human approval. Deny-by-default: the challenger stays in shadow until explicitly promoted. The decision + metric evidence (SHA-256 content hash for tamper-evidence) flow through the **same** `PolicyDecision` channel every gate uses and are written to the immutable audit trail. Exposed on `POST /v1/promotions/evaluate` (write scope) + `GET /v1/promotions/{agent_id}`, surfaced on the agent dashboard (champion vs challenger + gate status). See [`docs/runbooks/champion-challenger-promotion.md`](docs/runbooks/champion-challenger-promotion.md).
- **Reversibility-Aware Graduated Response (R1–R3 ladder)**: A `Reversibility { reversible, costly, irreversible }` dimension on the tool registry — **orthogonal** to the existing risk tiers — drives a graduated response at the gateway tool-policy check, modelled on the **DeepMind [AI Control Roadmap](https://deepmind.google/discover/blog/taking-a-responsible-path-to-agi/) R1–R3 ladder**: `reversible` → **R1** allow-and-log (monitor, no gate); `costly` → **R2** allow-under-budget while the run's cost budget has headroom, escalating to **R3** when exhausted; `irreversible` → **R3** require-approval (the existing human-in-the-loop gate). Deny-by-default: an unregistered tool defaults to `irreversible`. The chosen rung is folded into the allowlist decision **more-restrictive-wins** (it can only *add* friction, never loosen a `Deny`), emitted on the OTel span (`ferrumdeck.policy.response_level`) + the immutable audit log, returned from `POST /v1/runs/{id}/check-tool`, and surfaced on the run console as an R1/R2/R3 badge (read from the polled run endpoint; the realtime `policy.response.recorded` SSE shape is defined, with gateway→BFF push deferred). See [`docs/runbooks/graduated-response-levels.md`](docs/runbooks/graduated-response-levels.md).
- **Eval-Driven Harness Suggestions (trace→delta, HarnessX)**: fd-evals turns the aggregate signal across an eval run's trace into a *proposed* harness/policy delta — e.g. "run cost exceeded the cap on 7/10 runs → propose a tighter per-call cap" — and POSTs it to the control plane. The `HarnessSuggestion` is content-hashed and written to the immutable audit trail (same store as the promotion gate, no parallel channel), exposed on `POST /v1/harness-suggestions` + `GET /v1/harness-suggestions/agent/{agent_id}` + `POST /v1/harness-suggestions/{id}/resolve`, and surfaced on the eval-run dashboard with a **review/approve** panel. **Human-in-the-loop, deny-by-default**: approving *records* the decision in the audit trail and **never** auto-applies a change to a live policy, allowlist, or budget — applying remains a separate, explicit step.
- **Delegation-Aware Budget Leases**: The stateless budget gate compares an accumulated usage snapshot against a cap, which lets a parent task that delegates to N children collectively spend up to `N ×` the cap — every child checking the same cap believes it owns the whole budget (the Token-Budgets delegation-fanout class). A `BudgetLease` closes that gap: all leases in one delegation tree share a single atomic remaining-budget pool, a child is handed a sub-lease **carved from** (not copied alongside) the parent's authority, and every spend decrements the one shared pool — so total spend across parent + children can never exceed the root cap, even under concurrent fan-out. The lease is move-only (`!Copy`, `!Clone`): a lease moved into a delegated child is a compile error if the parent reuses it, runtime-rejected otherwise. Anchor: Token Budgets ([arXiv:2606.04056](https://arxiv.org/abs/2606.04056)).
- **x402 Pre-Call Spend Gate (autonomous payments)**: Extends the per-agent cost budget from token/model spend to **paid-API spend**. When an agent's outbound call hits an [x402](https://x402.org) `402 Payment Required` response, the gate parses the quoted price (`X402Challenge` — amount, asset, scheme), **normalizes it to cents** (a first-class `X402CostEvent` that folds into the same `cost_cents` ledger as inference, so a run's cost slope includes autonomous payments), and checks it against the **remaining** per-agent budget **before** the payment is authorized — reusing the exact `Budget::has_cost_headroom` primitive the R2 reversibility rung uses. A quote that would breach the ceiling is **hard-stopped** (deny + exactly one alert, mapped to a `PolicyDecision::deny`); a quote in an asset with no known USD peg is **denied by default** (you cannot check a cents budget against an unpriceable quote). It never moves money — a gate + cost model, not a wallet; settlement lives outside FerrumDeck. The paid call rides the existing OTel decision span (`ferrumdeck.cost.x402_cents` alongside token cost). Runnable, self-verifying demo: `cargo run -p ferrumdeck --example x402_spend_gate` ([examples/x402-spend-gate](examples/x402-spend-gate/README.md)). (`fd_policy::x402`)

### Observability
- **OpenTelemetry Integration**: Full distributed tracing with GenAI semantic conventions
- **Cross-MCP trace correlation (MCP SEP-414)**: When a caller propagates W3C trace context in the tool-call request `_meta` (`traceparent`/`tracestate`/`baggage`), ferrumdeck parents its enforcement decision span on that context — so the decision joins your trace end-to-end (host → client SDK → MCP server → ferrumdeck decision → downstream) and the trace-id lands on the persisted decision record. Malformed `traceparent` is rejected (never propagated); off unless the OTel semconv opt-in is set. **Targets** the 2026-07-28 MCP revision (a Release Candidate) and implements the SEP-414 conventions — *not* a conformance claim. See [`docs/mcp-trace-conformance.md`](docs/mcp-trace-conformance.md).
- **Cost Tracking**: Real-time token counting and cost calculation per run
- **Jaeger UI**: Visual trace exploration and debugging
- **Audit Trail**: Immutable logging of every action for compliance
- **Tool-call firing rate**: Derived OTel signal (`ferrumdeck.metrics.tool_call_firing_rate`) tracking the share of reasoning steps that invoked at least one tool, per run + per agent over a sliding window. Surfaced on the agent overview tab with a configurable low-firing-rate threshold (default 40%) that flags model regressions or broken tool registries before they propagate. See [`docs/runbooks/tool-call-firing-rate.md`](docs/runbooks/tool-call-firing-rate.md).
- **Debt-vs-tax cost decomposition (§2605.27320)**: Per-call `span_role ∈ {primary, retry, judge, guardrail, escalation, revalidation, monitor}` classification on every LLM/tool call, with two derived rollups per task/run — `agent.cost.token` (primary calls = debt) and `agent.cost.tax` (everything else). Dashboard panel ranks tasks by `tax / (token + tax)` descending so retry / escalation storms are visible at a glance. See [`docs/runbooks/cost-decomposition.md`](docs/runbooks/cost-decomposition.md).
- **Claim grounding rate — grounding rate _per VeriGraph_ ([arXiv:2606.16603](https://arxiv.org/abs/2606.16603))**: A per-run reliability metric (`ferrumdeck.reliability.claim_grounding_rate`, 0.0–1.0) — the fraction of the final agent output's claims that are **reachable from a raw-data / tool-output source node** via the run's evidence graph, per VeriGraph's claim-level grounding definition. This is a **lineage to the claim-level auditability literature, not a ferrumdeck-original metric**. Computed at run completion (Rust `fd_otel::claim_grounding`, mirrored by Python `fd_evals.claim_grounding` for the eval plane, with a shared golden fixture pinning cross-plane agreement), persisted on the run row next to cost/tokens, emitted on the run span, and rendered as a stat card on the run console. **Honest scope:** the "reachable evidence path" is operationalized as a **deterministic lexical-overlap reachability proxy** (sentence-split claims; a claim is grounded when enough of its significant tokens are covered by a source node) — pure and CI-stable, **not** an LLM judge or semantic-entailment model. It is a **reliability signal only**: a project may set an optional `min_claim_grounding_rate` in its settings to *flag* (never block or kill) a run below it — off by default, preserving the deny-by-default posture for *tool permissions*, not reliability scoring. See [`docs/runbooks/claim-grounding-rate.md`](docs/runbooks/claim-grounding-rate.md).

### Reproducibility
- **Versioned Registry**: Agents, tools, and prompts are version-controlled
- **Step-Level Replay**: Debug specific steps with exact inputs
- **Deterministic IDs**: ULID-based identifiers for time-ordered, collision-resistant tracking

### Quality
- **Evaluation Framework**: Deterministic test suites for agent workflows
- **Regression Gating**: CI blocks merges if agent quality degrades
- **Baseline Comparisons**: Track performance across versions
- **Per-harness eval dimension (Harness-Bench)**: fd-evals reports at the `(model × harness_config)` level — same model under different harness configs can produce different scores. Each run records its `tools_available`, `permission_tier`, `state_recovery`, and `tracing` config alongside the existing baseline, the dashboard groups results by `(model × harness)` with a side-by-side Recharts bar chart, and `DeltaReport` exposes a per-dimension diff (added/removed tools, tier change, recovery change). See [`docs/runbooks/harness-config.md`](docs/runbooks/harness-config.md).
- **Training-signal export (trace→signal, HarnessX)**: closes the eval loop the other way — projects a run's trace into a JSONL of `(state, action, observation, outcome_score)` tuples for downstream training/eval. Built **server-side** at `POST /v1/runs/{id}/training-signal`, where every `state`/`observation` is run through the **existing audit redaction path** (`fd_audit::redaction`) so PII/secrets are stripped before they ever leave the control plane; `outcome_score` is trace-intrinsic (step status) with an optional eval-supplied `run_score` override. The dashboard exposes a per-suite/per-run "Download training signal" action.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              Clients                                      │
│              (Dashboard / CLI / SDK / CI Pipelines)                      │
└─────────────────────────────────────────────────────────────────────────┘
        │                           │                           │
        ▼                           ▼                           ▼
┌─────────────────┐    ┌──────────────────────────────────────────────────┐
│    DASHBOARD    │    │                CONTROL PLANE (Rust)               │
│   (Next.js)     │    │                                                   │
│                 │    │  ┌───────────┐  ┌──────────┐  ┌──────────────┐   │
│ • Runs Monitor  │◀──▶│  │  Gateway  │  │  Policy  │  │   Registry   │   │
│ • Approvals     │    │  │  (Axum)   │  │  Engine  │  │  (Versioned) │   │
│ • Analytics     │    │  │           │  │          │  │              │   │
│ • Audit Trail   │    │  │ • REST    │  │ • Budget │  │ • Agents     │   │
│ • Evals UI      │    │  │ • SSE     │  │ • Rules  │  │ • Tools      │   │
│                 │    │  │ • Auth    │  │ • Gates  │  │ • Versions   │   │
└─────────────────┘    │  └───────────┘  └──────────┘  └──────────────┘   │
   :3001/:8000         │                                                   │
                       │  ┌───────────┐  ┌──────────┐  ┌──────────────┐   │
                       │  │   Audit   │  │   DAG    │  │    OTEL      │   │
                       │  │    Log    │  │Scheduler │  │    Setup     │   │
                       │  └───────────┘  └──────────┘  └──────────────┘   │
                       └──────────────────────────────────────────────────┘
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   ┌───────────────┐   ┌───────────────┐   ┌───────────┐
                   │   PostgreSQL  │   │     Redis     │   │   Jaeger  │
                   │   (pgvector)  │   │    Streams    │   │    UI     │
                   │               │   │               │   │           │
                   │ • runs/steps  │   │ • Job Queue   │   │ • Traces  │
                   │ • agents/tools│   │ • Pub/Sub     │   │ • GenAI   │
                   │ • audit_events│   │               │   │   Spans   │
                   └───────────────┘   └───────┬───────┘   └───────────┘
                        :5433                  │                :16686
                                               ▼
              ┌───────────────────────────────────────────────────────────┐
              │                      DATA PLANE (Python)                    │
              │                                                             │
              │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
              │  │    Worker    │  │     LLM      │  │    MCP Router    │  │
              │  │              │  │   Executor   │  │                  │  │
              │  │ • Poll Queue │  │              │  │ • GitHub MCP     │  │
              │  │ • Execute    │  │ • Claude     │  │ • Filesystem MCP │  │
              │  │ • Report     │  │ • GPT-4      │  │ • Custom Tools   │  │
              │  │ • Retry      │  │ • litellm    │  │ • Policy Checks  │  │
              │  └──────────────┘  └──────────────┘  └──────────────────┘  │
              └───────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Client** creates a run via `POST /v1/runs`
2. **Gateway** authenticates, validates, creates run in PostgreSQL
3. **Gateway** enqueues first step to Redis Stream
4. **Worker** polls Redis, fetches step details from Gateway
5. **Worker** executes step (LLM call, tool call, etc.) with tracing
6. **Worker** reports result back to Gateway
7. **Gateway** updates state, checks budget, enqueues next step
8. **Repeat** until run completes or fails

### Service Ports

| Service | Port | Description |
|---------|------|-------------|
| Gateway | `8080` | REST API (Rust control plane) |
| Dashboard | `3001` / `8000` | Next.js UI (dev) / Static server |
| PostgreSQL | `5433` | Database (pgvector enabled) |
| Redis | `6379` | Queue and cache |
| Jaeger UI | `16686` | Distributed tracing |
| OTel Collector | `4317` / `4318` | gRPC / HTTP endpoints |

### Receipts schema

The control plane's append-only audit log is documented as a stable receipts
substrate compatible with [Foundation Protocol](https://arxiv.org/abs/2605.23218)
(Mila + MetaGPT). See [`docs/receipts-schema.md`](docs/receipts-schema.md) for
the canonical `AuditEvent` shape, the FP event-substrate mapping
(metering / receipt / settlement / policy / provenance / audit), the
wrap-don't-replace stance on downstream consumers, and the per-call p95
budget. Drift is gated by the `audit_record_schema_drift` integration test
in `rust/crates/fd-audit/tests/`.

---

## Quick Start

> **Just want to see it work?** Run the one-command [reproducible demo](examples/demo/README.md) (`./examples/demo/run-demo.sh`) — it boots the stack and self-verifies deny-by-default policy, the approval gate, the immutable audit trail, and OTel spans in Jaeger.

### Prerequisites

- **Rust** 1.80+ ([rustup.rs](https://rustup.rs))
- **Python** 3.12+
- **Docker** & Docker Compose
- **uv** ([docs.astral.sh/uv](https://docs.astral.sh/uv)) - Fast Python package manager

### 1. Clone and Setup

```bash
git clone https://github.com/sattyamjjain/ferrumdeck.git
cd ferrumdeck

# Copy environment file
cp .env.example .env

# Start infrastructure (PostgreSQL, Redis, Jaeger)
make dev-up

# Install all dependencies
make install

# Run database migrations
make db-migrate

# Build everything
make build
```

### 2. Start Services

```bash
# Terminal 1: Start the Gateway (Rust)
make run-gateway
# Gateway running at http://localhost:8080

# Terminal 2: Start a Worker (Python)
make run-worker
```

### 3. Create Your First Run

```bash
# Create an API key (dev mode)
export API_KEY="fd_dev_key_abc123"

# Create a run
curl -X POST http://localhost:8080/v1/runs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agt_safe_pr_agent",
    "input": {
      "task": "Review the latest changes in the repository"
    }
  }'

# Check run status
curl http://localhost:8080/v1/runs/{run_id} \
  -H "Authorization: Bearer $API_KEY"
```

### 4. Open the Dashboard

```bash
# Start the dashboard (static server)
make run-dashboard
# Open http://localhost:8000

# Or run the Next.js development server
cd nextjs && npm run dev
# Open http://localhost:3001
```

The dashboard provides a complete UI for:
- Monitoring runs in real-time
- Approving/rejecting tool calls
- Managing agents and tools
- Viewing analytics and audit trails

### 5. View Traces

Open Jaeger UI at [http://localhost:16686](http://localhost:16686) to see distributed traces.

---

## Project Structure

```
ferrumdeck/
├── .github/
│   └── workflows/           # CI/CD pipelines
│       └── ci.yml          # Main CI (lint, test, build, eval gate)
│
├── contracts/               # API Contracts
│   ├── openapi/            # OpenAPI 3.1 specifications
│   │   └── control-plane.openapi.yaml
│   └── jsonschema/         # JSON Schema definitions
│       ├── run.schema.json
│       ├── policy.schema.json
│       ├── tool.schema.json
│       └── workflow.schema.json
│
├── rust/                    # Control Plane (Rust)
│   ├── crates/             # Shared libraries
│   │   ├── fd-core/        # IDs, errors, config, time utilities
│   │   ├── fd-policy/      # Policy engine, budgets, rules
│   │   ├── fd-registry/    # Agent/tool versioning
│   │   ├── fd-audit/       # Audit logging, redaction
│   │   ├── fd-storage/     # PostgreSQL repos + Redis queue
│   │   ├── fd-dag/         # DAG scheduler
│   │   └── fd-otel/        # OpenTelemetry setup
│   └── services/
│       └── gateway/        # Axum HTTP API service
│
├── python/                  # Data Plane (Python)
│   └── packages/
│       ├── fd-runtime/     # Workflow execution, tracing, client
│       ├── fd-worker/      # Queue consumer, step execution
│       ├── fd-mcp-router/  # MCP tool routing with policy checks
│       ├── fd-mcp-tools/   # MCP server implementations (git, test runner)
│       ├── fd-cli/         # Command-line interface
│       └── fd-evals/       # Evaluation framework with scorers
│
├── nextjs/                  # Dashboard (Next.js 16.1)
│   ├── src/
│   │   ├── app/            # App Router pages
│   │   │   └── (dashboard)/ # Dashboard route group
│   │   │       ├── runs/       # Run monitoring & detail
│   │   │       ├── approvals/  # Approval queue
│   │   │       ├── agents/     # Agent registry
│   │   │       ├── tools/      # Tool registry
│   │   │       ├── workflows/  # Workflow management
│   │   │       ├── analytics/  # Usage charts
│   │   │       ├── audit/      # Audit trail viewer
│   │   │       ├── evals/      # Evaluation results
│   │   │       ├── policies/   # Policy management
│   │   │       ├── logs/       # Container logs
│   │   │       └── settings/   # API keys & config
│   │   ├── components/     # React components (shadcn/ui)
│   │   ├── hooks/          # Custom React hooks
│   │   ├── lib/            # API client, utilities
│   │   └── types/          # TypeScript interfaces
│   └── Dockerfile          # Multi-stage production build
│
├── evals/                   # Evaluation Suite
│   ├── suites/             # Test suite definitions (YAML)
│   │   ├── smoke.yaml      # Quick smoke tests
│   │   └── regression.yaml # Full regression suite
│   ├── datasets/           # Test datasets
│   ├── agents/             # Agent configs for testing
│   ├── scorers/            # Scorer configurations
│   └── reports/            # Generated reports (gitignored)
│
├── examples/                # Example Agents
│   └── safe-pr-agent/      # PR review agent example
│       ├── agent.yaml      # Agent configuration
│       └── workflow.yaml   # Multi-step workflow
│
├── deploy/
│   └── docker/
│       ├── compose.dev.yaml    # Local development stack
│       ├── Dockerfile.gateway  # Gateway Docker build
│       └── Dockerfile.worker   # Worker Docker build
│
├── config/
│   └── mcp-config.json     # MCP server configuration
│
├── observability/
│   └── otel/
│       └── collector.yaml  # OTel Collector configuration
│
├── docs/                    # Documentation
│   ├── architecture/       # System design docs
│   ├── adr/                # Architecture decisions
│   ├── security/           # Security documentation
│   └── runbooks/           # Operational guides
│
├── Cargo.toml              # Rust workspace manifest
├── pyproject.toml          # Python workspace manifest (uv)
├── Makefile                # Development commands
└── .env.example            # Environment template
```

---

## Components

### Control Plane (Rust)

#### fd-core — Foundation Primitives

Type-safe IDs, error handling, and configuration.

**ID System** (ULID-based with prefixes):
```rust
TenantId     // ten_01ARZ3NDEKTSV4RRFFQ69G5FAV
AgentId      // agt_01ARZ3NDEKTSV4RRFFQ69G5FAV
RunId        // run_01ARZ3NDEKTSV4RRFFQ69G5FAV
StepId       // stp_01ARZ3NDEKTSV4RRFFQ69G5FAV
PolicyRuleId // pol_01ARZ3NDEKTSV4RRFFQ69G5FAV
```

**Error Types**:
- `NotFound`, `Validation`, `Unauthorized`, `Forbidden`
- `PolicyDenied`, `BudgetExceeded`, `ApprovalRequired`
- `Database`, `Queue`, `ExternalService`, `Internal`

#### fd-policy — Policy Engine

Governance rules enforcement with deny-by-default security.

**Tool Allowlist**:
```rust
pub struct ToolAllowlist {
    allowed_tools: Vec<String>,      // Explicitly allowed
    approval_required: Vec<String>,  // Require human approval
    denied_tools: Vec<String>,       // Explicitly denied
}
// Priority: Denied > Approval Required > Allowed > Default Deny
```

**Budget System**:
```rust
pub struct Budget {
    max_input_tokens: Option<u64>,   // Default: 100,000
    max_output_tokens: Option<u64>,  // Default: 50,000
    max_total_tokens: Option<u64>,   // Default: 150,000
    max_tool_calls: Option<u32>,     // Default: 50
    max_wall_time_ms: Option<u64>,   // Default: 5 minutes
    max_cost_cents: Option<u64>,     // Default: $5.00
}
```

**Tool Risk Levels**:
| Level | Description | Examples |
|-------|-------------|----------|
| Low | Read-only operations | read_file, list_directory |
| Medium | Limited mutations | write_file (with approval) |
| High | External communications | send_email, create_pr |
| Critical | Security-sensitive | deploy, payment, delete |

#### fd-registry — Versioned Registry

Immutable, version-controlled storage for agents and tools.

```rust
// Agent versions are immutable - changes require new versions
pub struct AgentVersion {
    id: AgentVersionId,
    agent_id: AgentId,
    version: String,           // Semantic version: "1.2.3"
    system_prompt: String,
    model: String,             // "claude-sonnet-4-20250514"
    allowed_tools: Vec<String>,
    model_params: Value,       // temperature, max_tokens, etc.
    changelog: String,
}
```

#### fd-storage — Database & Queue

PostgreSQL repositories with SQLx compile-time checked queries:
- `RunsRepo`, `StepsRepo`, `AgentsRepo`, `ToolsRepo`
- `PoliciesRepo`, `ApiKeysRepo`, `AuditRepo`, `WorkflowsRepo`

Redis Streams for reliable job queuing:
- Consumer groups for horizontal scaling
- Automatic acknowledgment and retry
- Message format: `StepJob` with context

#### fd-audit — Audit Trail

Append-only, immutable event logging:
- Run creation/completion
- Tool calls (allowed/denied)
- Policy decisions
- Approval resolutions
- API key usage

#### Gateway Service

Axum-based HTTP API with middleware:
- **Authentication**: API keys (SHA256 hashed) or OAuth2 JWT
- **Rate Limiting**: Per-tenant request limiting
- **Request ID**: X-Request-ID for distributed tracing

---

### Data Plane (Python)

#### fd-runtime — Runtime Primitives

**Models**:
```python
class RunStatus(Enum):
    CREATED, QUEUED, RUNNING, WAITING_APPROVAL,
    COMPLETED, FAILED, BUDGET_KILLED, POLICY_BLOCKED

class StepType(Enum):
    LLM, TOOL, RETRIEVAL, SANDBOX, APPROVAL

class Budget(BaseModel):
    max_input_tokens: int = 100_000
    max_output_tokens: int = 50_000
    max_total_tokens: int = 150_000
    max_tool_calls: int = 50
    max_wall_time_ms: int = 300_000  # 5 minutes
    max_cost_cents: int = 500        # $5.00
```

**Control Plane Client**:
```python
client = ControlPlaneClient(base_url, api_key)
run = await client.create_run(agent_id, input_data)
await client.submit_step_result(run_id, step_id, output, status)
```

**Tracing** (GenAI Semantic Conventions):
```python
with trace_llm_call(model="claude-sonnet-4", run_id=run.id) as span:
    response = await llm.complete(messages)
    set_llm_response_attributes(span, response)
    # Automatically tracks: tokens, cost, latency
```

#### fd-worker — Step Executor

Queue consumer that executes individual steps:

```python
async def run_worker():
    consumer = RedisQueueConsumer(redis_url)
    executor = StepExecutor(
        control_plane_url,
        api_key,
        mcp_servers=load_mcp_config(),
        tool_allowlist=allowlist,
    )

    while running:
        job = await consumer.poll()
        if job:
            await executor.execute(job)
```

**Retry Strategy** (exponential backoff):
```python
@retry(
    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
    stop=stop_after_attempt(3),
    wait=wait_exponential(min=1000, max=30000)
)
async def execute_with_retry(step):
    ...
```

#### fd-mcp-router — Tool Router

Deny-by-default MCP tool routing:

```python
class MCPRouter:
    async def call_tool(self, tool_name: str, args: dict) -> ToolResult:
        # 1. Check allowlist (deny-by-default)
        status = self.allowlist.check(tool_name)
        if status == "denied":
            return ToolResult(success=False, error="Tool not allowed")
        if status == "requires_approval":
            # Pause and wait for human approval
            ...

        # 2. Find server and execute
        server = self.find_server(tool_name)
        return await server.call(tool_name, args)
```

**Supported MCP Servers**:
- GitHub (`@modelcontextprotocol/server-github`)
- Filesystem (`@modelcontextprotocol/server-filesystem`)
- Custom servers (stdio or HTTP-based)

#### fd-cli — Command Line Interface

```bash
# Runs
fd run create --agent agt_xxx --input '{"task": "..."}'
fd run status <run_id>
fd run logs <run_id> --follow

# Registry
fd agent list
fd agent get <agent_id>
fd tool list

# Approvals
fd approval list
fd approval approve <approval_id>
fd approval reject <approval_id> --reason "..."

# Evaluations
fd eval run --dataset evals/datasets/safe-pr-agent.jsonl
fd eval report --output reports/latest.html
```

#### fd-evals — Evaluation Framework

Deterministic testing for agent workflows:

```python
runner = EvalRunner(
    scorers=[
        FilesChangedScorer(),
        PRCreatedScorer(),
        TestPassScorer(),
        LintScorer(),
    ],
    control_plane_url=url,
)

summary = runner.run_eval(
    dataset_path="evals/datasets/safe-pr-agent.jsonl",
    agent_id="agt_safe_pr_agent",
    max_tasks=20,
)
# Returns: pass_rate, avg_score, cost_per_task, regressions
```

#### fd-mcp-tools — MCP Server Implementations

Built-in MCP tool servers for common operations:

```python
# Git operations server
from fd_mcp_tools import GitMCPServer

# Test runner server
from fd_mcp_tools import TestRunnerMCPServer
```

---

### Dashboard (Next.js)

A professional admin UI built with Next.js 16.1.1, React 19.2, and Tailwind CSS 4.

#### Key Pages

| Page | Description |
|------|-------------|
| `/overview` | Dashboard home with key metrics and recent activity |
| `/runs` | Real-time run monitoring with step timeline visualization |
| `/runs/{runId}` | Detailed run view with step-by-step execution trace |
| `/approvals` | Approval queue with approve/reject actions |
| `/agents` | Agent registry with version management |
| `/tools` | Tool registry and MCP server status |
| `/workflows` | Multi-step workflow definitions and runs |
| `/analytics` | Usage charts, cost tracking, performance metrics |
| `/audit` | Immutable audit trail viewer with filtering |
| `/evals` | Evaluation suite results and comparisons |
| `/policies` | Policy configuration and management |
| `/threats` | [Airlock RASP](#airlock-rasp) violations — RCE / velocity / exfil / schema-drift / behavioral-drift |
| `/logs` | Container and service logs viewer |
| `/settings` | API key management and configuration |

#### Technology Stack

```
Next.js 16.1.1      # App Router with standalone output
React 19.2.3        # Concurrent features, Server Components
Tailwind CSS 4      # Utility-first styling with dark theme
TanStack Query 5    # Server state with polling (2-3s intervals)
TanStack Table 8    # Data tables with sorting/filtering
Radix UI            # Accessible component primitives
shadcn/ui           # Pre-built component library
Recharts 3          # Analytics visualizations
nuqs 2              # URL state management
sonner 2            # Toast notifications
```

#### Running the Dashboard

```bash
# Development (hot reload)
cd nextjs && npm install && npm run dev
# Open http://localhost:3001

# Production build
npm run build
npm start  # Runs on port 3001

# Static dashboard (simple HTTP server)
make run-dashboard
# Open http://localhost:8000

# Docker
docker build -t ferrumdeck-dashboard nextjs/
docker run -p 3001:3001 \
  -e GATEWAY_URL=http://gateway:8080 \
  -e FD_API_KEY=fd_dev_key_abc123 \
  ferrumdeck-dashboard
```

#### Environment Variables

```bash
GATEWAY_URL=http://localhost:8080     # Control plane URL
FD_API_KEY=fd_dev_key_abc123          # API key for authentication
NEXT_PUBLIC_POLL_INTERVAL=2000        # Polling interval (ms)
```

#### API Proxy (BFF Pattern)

The dashboard proxies all API calls through `/api/v1/*` routes:

```typescript
// src/app/api/v1/[...path]/route.ts
// Forwards requests to GATEWAY_URL with authentication
```

---

## API Reference

### Authentication

All API requests require authentication via `Authorization` header:

```bash
# API Key
Authorization: Bearer fd_tenant_abc123xyz

# Or OAuth2 JWT
Authorization: Bearer eyJhbGciOiJSUzI1NiIs...
```

### Endpoints

#### Runs

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/runs` | Create a new run |
| GET | `/v1/runs` | List runs with filtering |
| GET | `/v1/runs/{runId}` | Get run details |
| POST | `/v1/runs/{runId}/cancel` | Cancel a running run |
| GET | `/v1/runs/{runId}/steps` | List steps in a run |
| POST | `/v1/runs/{runId}/steps/{stepId}` | Submit step result (worker) |
| POST | `/v1/runs/{runId}/check-tool` | Check tool policy before execution |

#### Registry

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/registry/agents` | List agents |
| POST | `/v1/registry/agents` | Create agent |
| GET | `/v1/registry/agents/{agentId}` | Get agent details |
| GET | `/v1/registry/agents/{agentId}/versions` | List agent versions |
| POST | `/v1/registry/agents/{agentId}/versions` | Create agent version |
| GET | `/v1/registry/agents/{agentId}/stats` | Get agent statistics |
| GET | `/v1/registry/tools` | List tools |
| POST | `/v1/registry/tools` | Create tool |
| GET | `/v1/registry/tools/{toolId}` | Get tool details |
| GET | `/v1/registry/mcp-servers` | List MCP servers |

#### Approvals

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/approvals` | List pending approvals |
| PUT | `/v1/approvals/{approvalId}` | Approve or reject |

#### Policies

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/policies` | List policies |
| POST | `/v1/policies` | Create policy |
| GET | `/v1/policies/{policyId}` | Get policy details |
| PATCH | `/v1/policies/{policyId}` | Update policy |
| DELETE | `/v1/policies/{policyId}` | Delete policy |

#### API Keys

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/v1/api-keys` | List API keys |
| GET | `/v1/api-keys/{keyId}` | Get API key details |
| POST | `/v1/api-keys/{keyId}/revoke` | Revoke an API key |

#### Workflows

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/workflows` | Create workflow |
| GET | `/v1/workflows` | List workflows |
| GET | `/v1/workflows/{workflowId}` | Get workflow |
| GET | `/v1/workflows/{workflowId}/runs` | List workflow runs |
| POST | `/v1/workflow-runs` | Execute workflow |
| GET | `/v1/workflow-runs/{runId}` | Get execution status |
| POST | `/v1/workflow-runs/{runId}/cancel` | Cancel workflow run |
| GET | `/v1/workflow-runs/{runId}/executions` | List step executions |
| POST | `/v1/workflow-runs/{runId}/executions` | Create step execution |
| POST | `/v1/workflow-runs/{runId}/executions/{executionId}` | Submit step result |

#### Health & Documentation

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Liveness probe |
| GET | `/ready` | Readiness probe |
| GET | `/docs` | Swagger UI documentation |
| GET | `/api-docs/openapi.json` | OpenAPI specification |

### Example: Create a Run

```bash
curl -X POST http://localhost:8080/v1/runs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agt_safe_pr_agent",
    "input": {
      "task": "Review PR #123 in repo owner/repo",
      "repository": "owner/repo",
      "pr_number": 123
    },
    "config": {
      "budget": {
        "max_total_tokens": 50000,
        "max_cost_cents": 100
      }
    }
  }'
```

Response:
```json
{
  "id": "run_01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "agent_id": "agt_safe_pr_agent",
  "status": "queued",
  "created_at": "2024-12-24T10:00:00Z"
}
```

---

## Configuration

### Environment Variables

Create a `.env` file from `.env.example`:

```bash
# ============================================
# Application
# ============================================
FERRUMDECK_ENV=development
FERRUMDECK_LOG_LEVEL=debug
FERRUMDECK_LOG_FORMAT=pretty  # or "json" for production

# ============================================
# Gateway
# ============================================
GATEWAY_HOST=0.0.0.0
GATEWAY_PORT=8080
GATEWAY_WORKERS=4

# ============================================
# Database (PostgreSQL)
# ============================================
DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck
DATABASE_MAX_CONNECTIONS=20
DATABASE_MIN_CONNECTIONS=5

# ============================================
# Queue (Redis)
# ============================================
REDIS_URL=redis://localhost:6379
REDIS_QUEUE_PREFIX=fd:queue:

# ============================================
# LLM Providers
# ============================================
ANTHROPIC_API_KEY=sk-ant-api03-xxx
OPENAI_API_KEY=sk-xxx
DEFAULT_MODEL=claude-sonnet-4-20250514

# ============================================
# OpenTelemetry
# ============================================
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
OTEL_SERVICE_NAME=ferrumdeck
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=1.0

# ============================================
# Worker
# ============================================
FD_API_KEY=fd_dev_key_abc123
CONTROL_PLANE_URL=http://localhost:8080
WORKER_CONCURRENCY=4
WORKER_MAX_RETRIES=3

# ============================================
# OAuth2 (Optional)
# ============================================
OAUTH2_ENABLED=false
OAUTH2_JWKS_URI=https://your-provider/.well-known/jwks.json
OAUTH2_ISSUER=https://your-provider/
OAUTH2_AUDIENCE=api://ferrumdeck
OAUTH2_TENANT_CLAIM=tenant_id
```

### MCP Server Configuration

Configure MCP servers in `config/mcp-servers.json`:

```json
{
  "servers": [
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"]
    }
  ],
  "allowlist": {
    "allowed": [
      "read_file", "list_directory", "search_files",
      "get_file_contents", "list_commits", "get_pull_request"
    ],
    "approval_required": [
      "write_file", "create_file", "create_pull_request",
      "create_issue", "push_files"
    ],
    "denied": [
      "delete_file", "delete_branch", "merge_pull_request"
    ]
  }
}
```

---

## Security Model

### Defense in Depth

FerrumDeck implements multiple security layers. The first five sit outside the
run; the sixth — **Airlock RASP** — runs inside every tool dispatch.

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Authentication                                  │
│   • API Keys (HMAC-SHA256 hashed, scoped)               │
│   • OAuth2/JWT with tenant claims                       │
├─────────────────────────────────────────────────────────┤
│ Layer 2: Deny-by-Default Tools                          │
│   • Explicit allowlist required                         │
│   • Risk level classification                           │
│   • Per-agent tool restrictions                         │
├─────────────────────────────────────────────────────────┤
│ Layer 3: Budget Enforcement                             │
│   • Token limits (input, output, total)                 │
│   • Cost limits (in cents)                              │
│   • Time limits (wall clock)                            │
│   • Automatic run termination                           │
├─────────────────────────────────────────────────────────┤
│ Layer 4: Approval Gates                                 │
│   • Human-in-the-loop for sensitive actions             │
│   • Configurable per tool                               │
│   • Timeout with auto-rejection                         │
├─────────────────────────────────────────────────────────┤
│ Layer 5: Audit Trail                                    │
│   • Immutable event logging                             │
│   • Every action recorded                               │
│   • Compliance-ready                                    │
├─────────────────────────────────────────────────────────┤
│ Layer 6: Airlock RASP — runtime self-protection         │
│   • Anti-RCE pattern matcher                            │
│   • Financial circuit breaker (velocity + loop guard)   │
│   • Data exfiltration shield                            │
│   • Schema-drift guard (per ToolVersion)                │
│   • Behavioral-drift monitor (per-agent z-score)        │
│   • Shadow vs Enforce modes                             │
└─────────────────────────────────────────────────────────┘
```

### Airlock RASP

Lives in `rust/crates/fd-policy/src/airlock/`. Inspects every tool call
in-process — five concrete checks composed on a single `AirlockInspector`,
no plugin chain. The inspector runs at the gateway boundary and surfaces
violations to the [`/threats` dashboard page](#dashboard-nextjs).

| # | Layer | Signal | Failure mode caught |
|---|-------|--------|---------------------|
| 1 | **RCE Pattern Matcher** (`patterns.rs`) | Regex over tool-call args | `eval()`, `exec()`, `os.system`, shell metacharacters, base64+eval obfuscation, path traversal |
| 2 | **Velocity / Circuit Breaker** (`velocity.rs`) | Per-run spend + identical-call counter | Runaway cost, infinite tool-call loops |
| 3 | **Exfiltration Shield** (`exfiltration.rs`) | URL extraction + domain allowlist | Outbound calls to non-whitelisted hosts, raw IP addresses (C2-style) |
| 4 | **Schema-Drift Guard** (`schema_drift.rs`) | JSON Schema compiled from `ToolVersion.input_schema` | LLM-constructed payloads that miss required fields, type-mismatch, unknown fields |
| 5 | **Behavioral-Drift Monitor** (`behavioral_drift.rs`) | Per-agent rolling z-score over `cost_cents` / `latency_ms` / `refused` / `schema_violation` | Single-axis exploitation — calls that deviate >3σ from the agent's own recent baseline after a warmup window |

**Modes**

- **`shadow`** (default): violations are logged + persisted as threats, but the
  call is allowed through. Use for rollout and rule tuning.
- **`enforce`**: violations block the call. Use in production once you've
  triaged the shadow-mode threat stream.

Configure via the gateway's `AirlockConfig` — each layer has independent
`enabled`, thresholds, and risk-score defaults. See
`rust/crates/fd-policy/src/airlock/config.rs`.

#### Coherence-Divergence Monitor — a trajectory-level signal

The five layers above each inspect a **single** tool call in isolation. The
coherence-divergence monitor (`rust/crates/fd-policy/src/airlock/coherence.rs`)
is different: it watches the agent run **trajectory** — the audit-trail event
stream — for a sequential failure no per-call check can see. The agent **states
a fact that should change its plan** ("tests still failing", "permission
denied", "the file does not exist") and the very next *advancing* action
proceeds **as if that fact were untrue** (marks the task done, commits, reports
success). Each divergence is emitted as a structured `CoherenceSpan` carrying
the stated-fact quote, the contradicting action, a confidence in `[0, 1]`, and
a severity — and `CoherenceSpan::to_violation()` projects it onto the same
`AirlockViolation` shape (`violation_type = coherence_divergence`) as every
other layer, so it lands in the identical `audit_events.details` path.

Motivation — **Strained Coherence**
([arXiv:2606.07889](https://arxiv.org/abs/2606.07889)): in that study, coding-
agent trajectories exhibiting this divergence failed **94%** of the time versus
**46%** for trajectories without it (Fisher's exact p = 0.003). That is a
pre-failure signal worth surfacing *before* the run finishes, so the monitor is
**streaming**: `CoherenceMonitor::observe_event` consumes one trajectory event
at a time and returns a span the instant a divergence appears, rather than only
in a post-hoc autopsy. A false-positive guard keeps it honest — a run that
**acknowledges and acts on** the blocking fact (remediates, states it resolved,
or disclaims success in the action itself) does not fire.

> **Status: wired live at the gateway run stream.** `submit_step_result`
> projects each submitted step into trajectory events (a Tool step is an
> advancing action followed by its observed output; a reasoning step is a
> statement) and feeds them to a process-wide `CoherenceMonitor` keyed per run.
> A divergence surfaces mid-run through the same `airlock.violation_detected`
> `audit_events` path, is persisted on the run row
> (`runs.coherence_divergence_flagged`, surfaced on `GET /v1/runs/{id}` and the
> run console's **Coherence** card), and is emitted on the run-completion span
> (`ferrumdeck.reliability.coherence_divergence`). At completion a synthetic
> "reports success" closure action is fed so a run that terminates with an
> unresolved blocking fact (and does not disclaim it) also flags. It is a
> reliability **signal** — it never blocks a tool or changes run status,
> mirroring the claim-grounding "flag, never block" posture. Toggle with
> `FERRUMDECK_COHERENCE_ENABLED=false`. Configured by `CoherenceConfig`
> (separate from the per-call `AirlockConfig`, since it is driven by
> `CoherenceMonitor` rather than `AirlockInspector::inspect`). Single-process
> today: the per-run trajectory state lives in gateway memory, so a
> multi-instance deployment would track each run only within the instance that
> receives its steps. See [`docs/runbooks/coherence-divergence.md`](docs/runbooks/coherence-divergence.md).

#### Exfiltration Shield — credential & data-budget detail

The data-exfiltration shield in `rust/crates/fd-policy/src/airlock/exfiltration.rs`
runs in-process on every network-tool dispatch and layers three checks
against the outbound payload:

1. **Credential DLP** (`credential_dlp.rs`) — scans for cloud keys
   (AWS access key id, GCP service-account JSON), PATs (GitHub, Slack
   bot tokens, Stripe live keys, Anthropic and OpenAI keys), and
   financial account numbers. False positives on PAN and IBAN are
   suppressed with **Luhn** (mod-10) and **mod-97** checksum gates
   respectively, so a random 16-digit correlation id is not flagged
   as a credit card. Matches are recorded with a redacted form
   (first-4 + last-4 only) — the raw secret never reaches audit
   storage.
2. **Domain allowlist + raw-IP block** — deny-by-default, with subdomain
   matching and IP-literal rejection to prevent C2-style direct dialing.
3. **Per-domain data budget** — configurable `data_budget_per_domain_bytes`
   caps cumulative outbound bytes per `(run, domain)` tuple. Further
   dispatches that would exceed the budget are denied; the violation
   reuses the existing audit and shadow/enforce-mode plumbing, so an
   exceedance kills the run the same way a budget-exceeded policy
   decision does.

### Threat Model

**Assumption**: Prompt injection cannot be fully prevented.

**Strategy**: Containment, not prevention.

| Threat | Mitigation |
|--------|-----------|
| Malicious tool calls | Deny-by-default allowlist |
| Token exhaustion | Budget limits with auto-kill |
| Data exfiltration (destination) | Domain allowlist + raw-IP block (Airlock RASP) |
| Credential exfiltration (payload) | Airlock credential DLP — cloud keys, PATs, Luhn-valid PANs, mod-97 IBANs (redacted in audit) |
| Slow-leak exfil to allowed host | Airlock per-domain data budget per run |
| Tool-call payload drift | Airlock schema-drift guard against the registered `ToolVersion` JSON Schema |
| Single-axis exploitation | Airlock behavioral-drift monitor — rolling z-score per agent |
| Privilege escalation | Scoped API keys, tenant isolation |
| Audit tampering | Append-only logging (app-layer; no `UPDATE`/`DELETE` in the repo API). Cryptographic hash-chaining + DB-level write-once are on the roadmap — see [Project Status](#project-status--limitations) |

---

## Observability

### OpenTelemetry Integration

FerrumDeck uses OpenTelemetry with GenAI semantic conventions:

**Tracked Attributes**:
```
gen_ai.system              = "anthropic" | "openai"
gen_ai.request.model       = "claude-sonnet-4-20250514"
gen_ai.usage.input_tokens  = 1234
gen_ai.usage.output_tokens = 5678
gen_ai.usage.cost_usd      = 0.0234

ferrumdeck.run.id          = "run_xxx"
ferrumdeck.step.id         = "stp_xxx"
ferrumdeck.agent.id        = "agt_xxx"
ferrumdeck.tenant.id       = "ten_xxx"
```

### Receiver Attestation (optional, off by default)

FerrumDeck spans are **agent-self-reported**: the agent (or the worker on its
behalf) describes what it did. That is useful, but a self-reported span is an
*assertion*, not a *proof* — nothing independently confirms the call happened
as described.

Receiver attestation is an **optional** cross-check. When enabled, a tool/
service call may carry a minimal, Sello-style **receiver-signed receipt**
(`receiver_id`, `tool_name`, a per-call `call_token` binding, an
owner-encrypted `payload_ref`, and a signature). The trace plane
(`fd_runtime.attestation`) verifies that the receipt (a) has a valid receiver
signature and (b) binds to the *same call* the span claims (same tool name +
same `call_token`), then annotates the span:

```
ferrumdeck.attestation.attested                  = true | false
ferrumdeck.attestation.status                    = "attested"
                                                 | "unverified_no_receipt"
                                                 | "unverified_signature_invalid"
                                                 | "unverified_mismatch"
                                                 | "unverified_unknown_receiver"
ferrumdeck.attestation.self_reported_unverified  = true | false
ferrumdeck.attestation.receiver_id               = "github-mcp"
ferrumdeck.attestation.call_token                = "call_tok_xxx"
```

**Enable it** with the environment switch (off unless explicitly set):

```bash
export FD_ATTESTATION_ENABLED=true   # default: false (existing pipelines unaffected)
```

and supply a `ReceiptVerifier` (keyed per receiver) + the per-call receipt to
`trace_tool_call(...)`. When disabled, the verification path is skipped
entirely and spans are byte-for-byte identical to before.

**Trust model — what attestation DOES and does NOT prove.** Be honest about
this; it is deliberately narrow:

- ✅ **Does** prove that *a party holding the receiver's key* issued a receipt
  that binds to this specific call (same tool + same `call_token`), and that
  the receipt was not altered after signing.
- ✅ **Does** give you an honest, additive signal: a span without a verified
  receipt is flagged `self_reported_unverified = true` instead of being
  silently trusted.
- ❌ Does **not** prove the call's *contents* or *results* are correct — the
  `payload_ref` is owner-encrypted and the trace plane never decrypts it.
  Attestation proves *binding*, not *semantics*.
- ❌ Does **not** provide third-party non-repudiation with the default scheme.
  The default is **HMAC-SHA256** (a symmetric, shared-secret signature): a
  valid signature proves the holder of the receiver key produced it, not that
  *only* the receiver could have. The `ReceiptVerifier` interface is
  scheme-agnostic so an asymmetric scheme (e.g. Ed25519) can replace HMAC
  later without changing callers.
- ❌ Does **not** enforce anything. Unattested spans are **never dropped** —
  most spans are unattested today. This is signal for the trace view, not a
  gate. There is no "attestation required" mode.

### Jaeger UI

Access traces at [http://localhost:16686](http://localhost:16686):

- Search by run ID, agent ID, or error status
- View step execution timeline
- Analyze token usage and costs
- Debug failures with full context

### Cost Tracking

Automatic cost calculation based on model pricing:

| Model | Input ($/1M) | Output ($/1M) |
|-------|-------------|---------------|
| claude-opus-4 | $15.00 | $75.00 |
| claude-sonnet-4 | $3.00 | $15.00 |
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |

---

## Example Agents

### Safe PR Agent

A flagship example demonstrating FerrumDeck's governance features. Located in `examples/safe-pr-agent/`.

**Agent Configuration** (`agent.yaml`):
```yaml
name: safe-pr-agent
description: |
  Reads a repository, analyzes code, proposes changes,
  runs tests in sandbox, and creates a pull request.
  Every action is permissioned, traced, and cost-accounted.

default_model: claude-sonnet-4-20250514

# Read-only tools allowed by default
allowed_tools:
  - read_file
  - list_files
  - search_code

# These require human approval
approval_required_tools:
  - write_file
  - create_pr

# Governance limits
budget:
  max_input_tokens: 50000
  max_output_tokens: 20000
  max_tool_calls: 30
  max_wall_time_ms: 180000  # 3 minutes
  max_cost_cents: 100       # $1
```

**Create Your Own Agent**:
```bash
# Copy the example
cp -r examples/safe-pr-agent examples/my-agent

# Edit the configuration
vim examples/my-agent/agent.yaml

# Register with the control plane
curl -X POST http://localhost:8080/v1/registry/agents \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d @examples/my-agent/agent.yaml
```

---

## Evaluation Framework

### Running Evaluations

```bash
# Run full evaluation suite
./scripts/run-evals.sh

# Run specific dataset
fd eval run \
  --dataset evals/datasets/safe-pr-agent.jsonl \
  --agent agt_safe_pr_agent \
  --output evals/reports/latest.json

# Compare against baseline
fd eval compare \
  --baseline evals/reports/baseline.json \
  --current evals/reports/latest.json
```

### Evaluation Dataset Format

```jsonl
{"task_id": "pr-review-001", "input": {"task": "Review PR #1"}, "expected": {"files_changed": true}}
{"task_id": "pr-review-002", "input": {"task": "Review PR #2"}, "expected": {"files_changed": true}}
```

### CI Integration

Evaluations run automatically on PRs to `main`:

```yaml
# .github/workflows/evals.yml
- name: Run evaluations
  run: fd eval run --suite smoke --parallel 4

- name: Check for regressions
  run: |
    if [ $(jq '.pass_rate' report.json) -lt 80 ]; then
      echo "Eval gate FAILED: Pass rate below 80%"
      exit 1
    fi
```

---

## Development

### Prerequisites

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install uv (Python package manager)
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install Docker
# See: https://docs.docker.com/get-docker/
```

### Common Commands

```bash
# Start development infrastructure
make dev-up

# Stop infrastructure
make dev-down

# Install all dependencies
make install

# Build everything
make build

# Run all tests
make test

# Format code
make fmt

# Lint code
make lint

# Run full CI checks locally
make check

# Run database migrations
make db-migrate

# Start gateway
make run-gateway

# Start worker
make run-worker
```

### Running Tests

```bash
# All tests
make test

# Rust tests
cargo test --workspace

# Python tests
uv run pytest python/packages/fd-evals/tests/ -v
uv run pytest python/packages/fd-worker/tests/ -v

# Specific package
cargo test -p fd-policy
uv run pytest python/packages/fd-runtime

# With coverage
cargo tarpaulin --out Html
uv run pytest --cov=fd_runtime --cov-report=html

# Next.js type checking
cd nextjs && npx tsc --noEmit
```

### Code Quality

```bash
# All checks
make check

# Rust
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings

# Python
uv run ruff check python/
uv run ruff format --check python/
uv run pyright python/

# Next.js
cd nextjs && npm run lint
```

---

## Deployment

### Production Checklist

- [ ] **Database**: Use managed PostgreSQL with pgvector (RDS, Cloud SQL, etc.)
- [ ] **Redis**: Use managed Redis (ElastiCache, Redis Cloud, etc.)
- [ ] **TLS**: Enable HTTPS for all API endpoints
- [ ] **Secrets**: Use secrets manager for API keys and LLM tokens
- [ ] **Monitoring**: Set up CloudWatch/Datadog metrics
- [ ] **Logging**: Centralized logging (ELK, CloudWatch Logs)
- [ ] **Backups**: Daily PostgreSQL snapshots
- [ ] **Rate Limiting**: Configure per-tenant limits
- [ ] **OAuth2**: Enable for production authentication
- [ ] **Dashboard**: Deploy behind CDN with proper CORS settings
- [ ] **Workers**: Scale horizontally with multiple instances

### Docker Deployment

```bash
# Build all images
docker build -t ferrumdeck-gateway -f deploy/docker/Dockerfile.gateway .
docker build -t ferrumdeck-worker -f deploy/docker/Dockerfile.worker .
docker build -t ferrumdeck-dashboard nextjs/

# Run with Docker Compose (development)
docker compose --env-file .env -f deploy/docker/compose.dev.yaml up -d

# Services will be available at:
#   Gateway:   http://localhost:8080
#   Dashboard: http://localhost:3001
#   Jaeger:    http://localhost:16686
```

### Kubernetes

A Helm chart ships at `deploy/helm/ferrumdeck/`. It packages the gateway,
worker, Next.js dashboard, and (optionally) bundled Postgres (pgvector)
and Redis. Kustomize manifests at `deploy/k8s/` are retained for parity —
use whichever fits your tooling.

```bash
# Pull bundled deps (Bitnami postgresql + redis)
helm dependency update deploy/helm/ferrumdeck

# Demo install with bundled Postgres + Redis
helm install ferrumdeck deploy/helm/ferrumdeck \
  --namespace ferrumdeck --create-namespace \
  --set secrets.data.anthropicApiKey=sk-ant-...

# Port-forward and verify
kubectl -n ferrumdeck port-forward svc/ferrumdeck-gateway 8080:8080
curl http://localhost:8080/health
```

For production, disable the bundled deps and point at managed Postgres
(pgvector ≥ 0.7) and managed Redis (Streams support required); set
`secrets.create=false` and reference an externally-managed Secret from
External Secrets Operator or sealed-secrets. See
[`deploy/helm/README.md`](deploy/helm/README.md) for the full production
checklist. CI runs `helm lint` + `kubeconform` on every change under
`deploy/helm/`.

**Minimum resources per service:**
- Gateway: 512MB RAM, 0.5 CPU
- Worker: 1GB RAM, 1 CPU (scales horizontally)
- Dashboard: 256MB RAM, 0.25 CPU

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`make check`)
5. Commit (`git commit -m 'Add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Code Style

- **Rust**: Follow `rustfmt` defaults, clippy warnings as errors
- **Python**: Follow `ruff` rules (see `pyproject.toml`), pyright type checking
- **TypeScript**: ESLint with Next.js config
- **Commits**: Use conventional commits (`feat:`, `fix:`, `docs:`, etc.)

See [AGENTS.md](AGENTS.md) for detailed coding guidelines and single-test commands.

---

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.

---

## Acknowledgments

**Rust Control Plane:**
- [Axum](https://github.com/tokio-rs/axum) — Web framework
- [SQLx](https://github.com/launchbadge/sqlx) — Async SQL with compile-time checks
- [Tower](https://github.com/tower-rs/tower) — Middleware framework
- [Tokio](https://github.com/tokio-rs/tokio) — Async runtime

**Python Data Plane:**
- [litellm](https://github.com/BerriAI/litellm) — Unified LLM interface
- [MCP](https://modelcontextprotocol.io/) — Model Context Protocol
- [Pydantic](https://github.com/pydantic/pydantic) — Data validation
- [Tenacity](https://github.com/jd/tenacity) — Retry with backoff

**Dashboard:**
- [Next.js](https://nextjs.org/) — React framework
- [Tailwind CSS](https://tailwindcss.com/) — Utility-first CSS
- [shadcn/ui](https://ui.shadcn.com/) — Component library
- [TanStack Query](https://tanstack.com/query) — Server state management
- [Radix UI](https://www.radix-ui.com/) — Accessible primitives
- [Recharts](https://recharts.org/) — Chart library

**Observability:**
- [OpenTelemetry](https://opentelemetry.io/) — Tracing framework
- [Jaeger](https://www.jaegertracing.io/) — Distributed tracing UI
