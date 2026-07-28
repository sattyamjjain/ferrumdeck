# Changelog

All notable changes to FerrumDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Release/tag reconciliation (2026-07-19).** Earlier entries had accumulated in
> a single `[Unreleased]` block while six version bumps shipped, so the history
> below was reconstructed from `git log` between the tags that actually exist:
> **v0.7.2, v0.7.3, v0.7.4, v0.7.6**. Versions **0.2.0–0.7.1** and **0.7.5** were
> bumped in `Cargo.toml` but **never tagged**; rather than invent release dates,
> those are called out explicitly and their changes folded into the nearest tag
> that captured them. Dates are the tag dates; entries are terse, one per merged
> change.

## [Unreleased]

## [0.7.12] - 2026-07-28

### Added
- **ROADMAP.md + open tracking issues, and a hardened version-parity guard.** Published [`ROADMAP.md`](ROADMAP.md) (Now / Next / Later) sourced verbatim from the README's "Project Status & Limitations" — each item names the file/endpoint it lives in and what *done* means — and filed the tracker's first issues, one per roadmap item under a new `roadmap` label ([#4](https://github.com/sattyamjjain/ferrumdeck/issues/4)–[#11](https://github.com/sattyamjjain/ferrumdeck/issues/11); [#4](https://github.com/sattyamjjain/ferrumdeck/issues/4) + [#5](https://github.com/sattyamjjain/ferrumdeck/issues/5) also `good first issue`). README + `CONTRIBUTING.md` now point contributors at the roadmap and the label. Extended the `version-parity` CI job (`.github/workflows/version-release-consistency.yml`) from a two-file comparison to a check across **every** version-bearing manifest against the root `Cargo.toml` `[workspace.package].version` — `pyproject.toml`, `src/ferrumdeck/__init__.py`, the six `python/packages/*/pyproject.toml`, and `nextjs/package.json` — plus an assertion that **no** `rust/crates/*` or `rust/services/*` `Cargo.toml` pins a literal `[package].version` (they must inherit `version.workspace = true`), which is what stops a future crate re-introducing the fd-dag bug. **No engine API change, no new policy rule — OSS-only, Apache-2.0.**

### Fixed
- **Enforce `check-tool` on the agentic execution path — closes a demo bypass** (`fd_worker.agentic`): the in-loop agentic executor previously checked only a **local allowlist** and, when a tool required approval, logged `"executing anyway for demo"` and ran it — so approval gates and Airlock were enforced on the explicit `StepType.TOOL` path but **not** inside an agentic run (the README's "top roadmap item"). Every agentic tool call is now authorized against the real control-plane **`POST /v1/runs/{run_id}/check-tool`** endpoint (via `ControlPlaneClient.check_tool_policy`) **before** it executes, with all three outcomes handled: `allow` → execute; `deny` → refuse (no execution); `requires_approval` → **do not execute**, the gateway gates the run pending approval (`PUT /v1/approvals/{id}`). The local allowlist remains only a cheap pre-filter (fast local deny) and is **never** the final authority. **Fails closed:** if the control plane is unreachable the call is **refused**, not executed — configurable via `AGENTIC_FAIL_CLOSED` (default on), with the fail-closed event logged. The enforcement decision (`allow`/`deny`/`requires_approval`/`fail_closed`) is surfaced on each tool call in the run record. Tests (`test_agentic_enforcement.py`): deny blocks execution, requires_approval does not execute before approval, gateway-down refuses (fail-closed), plus allow-executes, local-deny-short-circuits, no-run_id-fails-closed, and the explicit fail-open escape hatch. The governed-benchmark / `CONTROLS_CROSSWALK.md` "wired vs library" caveat and the README status section are corrected to reflect that the controls now hold on the agentic loop, not only the Rust policy path.
- **`fd-dag` now inherits its metadata from `[workspace.package]`.** It was the only workspace crate pinning a literal `version = "0.7.11"` and — worse — declaring `license = "MIT"` against the repo's Apache-2.0 `LICENSE` and `[workspace.package] license = "Apache-2.0"`. Switched `version` / `edition` / `license` to `.workspace = true` and added `repository.workspace = true` + `rust-version.workspace = true`, matching every sibling crate; `cargo metadata` now resolves fd-dag to 0.7.11 / Apache-2.0. The extended version-parity CI guard (above) asserts no crate can re-pin a literal version.

### Changed
- **Release-history reconciliation.** Created the missing GitHub Releases for `v0.7.9`, `v0.7.10`, and `v0.7.11` (tags existed but the latest Release was `v0.7.8`, three behind), using the matching CHANGELOG sections as notes. Root Python package version (`pyproject.toml` + `src/ferrumdeck/__init__.py`) realigned from the stale `0.1.0` to the `0.7.11` workspace version. Added a `version-release-consistency` CI workflow that fails when a pushed tag has no GitHub Release and when the Rust workspace version and the root Python version disagree (without an explicit opt-out marker). README project-status notes the six Python packages are **installable from source only** (not published to PyPI).

### Removed
- **Retired two stale in-flight planning artifacts committed to `main`.** `security-scan/{plan.md,state.json}` — a January 2026 scan record that read `**Status:** IN PROGRESS` / `**Fixed:** 0` while its own sibling `state.json` recorded `"fixed": 19`, and which published a per-finding map of where secrets lived and which endpoints had defects — and `nextjs/refactor/{plan.md,state.json}`, a completed 2026-01-26 hook-extraction session log. Both are `git rm`'d and added to `.gitignore` so a future run can't re-commit them. The exposed development credentials named in the removed scan record were verified rotated before removal; the security-review disposition is recorded (dated, no per-finding detail) in `SECURITY.md`, and `docs/security/threat-model.md` was repointed there.

## [0.7.11] - 2026-07-26

### Added
- **Standards-aligned, reproducible governed-vs-ungoverned artifact** (`fd-evals/GOVERNED_BENCHMARK_RESULTS.md` + `fd-evals/CONTROLS_CROSSWALK.md`): turns the internal governed-vs-ungoverned eval into a **third-party-comparable** artifact on recognized, citable workloads, with every number regenerable and pinned to the real Rust `fd_policy` engine. Reports, on an [AgentDojo-style indirect-injection corpus (arXiv:2406.13352)](https://arxiv.org/abs/2406.13352), **attack success rate 100% → 0%** (17/17 blocked; Wilson CI [81.6%, 100%]) at **100% benign-task utility** (8/8); the safe-PR spend-overrun lane (**4/4 unsafe blocked, 85¢ vs 184¢**); and the **payment-governance scenario explicitly** (an agent overspends an AP2 mandate / x402 call → **3/3 unsafe mandates blocked, $150.95 → $0.40**, each `ferrumdeck.decision`-audit-logged with a W3C `traceparent`), run through the real `rust/crates/fd-policy/src/{x402.rs,ap2.rs,budget.rs}` path. **Controls crosswalk** maps each control (spend gate, `transparency_art50`, reversibility, `credential_dlp`, `behavioral_drift`, `exfiltration`, allowlist, audit trail) to the five risk categories in the **CISA/NSA (Five Eyes) _Careful Adoption of Agentic AI Services_ (May 2026)** guidance — privilege & access, design & configuration, behavioral misalignment, structural brittleness, accountability — with code paths + evidence tests + enforce-vs-shadow honesty. The transparency control is tied to **EU AI Act Article 50 / GPAI, enforceable 2026-08-02** (`fd-policy/src/transparency_art50.rs`). README gains a "Governed vs ungoverned (reproducible)" section + crosswalk link. Reproduce: `make eval-injection-defense` · `make bench-governed`; pins `cargo test -p fd-policy --test {injection_defense,governed_benchmark,ap2_gate}`. Positioning/credibility move only — **OSS, Apache-2.0, no hosted control-plane, no paid tier**; no engine API change (docs + README + CHANGELOG).

### Changed
- Workspace + all planes bumped `0.7.10 → 0.7.11` (tag-only version marker; the docs/positioning change adds no new engine API surface).

## [0.7.10] - 2026-07-25

### Added
- **AP2 signed-Mandate pre-call spend gate — a second payment rail on the same gate** (`fd_policy::ap2`): extends the x402-aware spend gate (shipped 0.7.9) to [Google AP2 (Agent Payments Protocol)](https://github.com/google-agentic-commerce/AP2) payments, which are pre-authorized by a **signed Mandate chain** rather than an inline HTTP 402 quote. `evaluate_ap2_payment(intent, cart, keyring, budget, usage)` **verifies the Ed25519 signature chain** — a user-signed `Ap2IntentMandate` (scope: allowed merchants/categories + the user's own max amount) plus an `Ap2CartMandate` cryptographically bound to it by `intent_id` — using real `ed25519-dalek` verification (RFC 8032, deterministic, I/O-free), then checks the cart against the **intent's authorized scope** and against **the same per-task `Budget::has_cost_headroom` ceiling the x402 gate enforces** (the existing `fd_policy::budget::Budget` spend-ceiling type, reused — not a parallel budget), all **before** any payment is authorized. **Deny-by-default** across every failure mode (`Ap2DenyKind`): `missing_signature`, `invalid_signature`, `unknown_key`, `intent_cart_mismatch`, `unpriceable` (non-USD), `intent_scope_mismatch` (merchant/category/amount outside the intent), and `cart_over_ceiling`. An authorized payment normalizes to an `Ap2CostEvent` that folds into the **same `cost_cents` ledger** as x402 + token cost (`apply_to`), and maps to the crate `PolicyDecision` like every other gate. **Never moves money** — it verifies mandates and returns an authorize/deny *decision*; settlement (card rail, bank transfer, stablecoin) lives outside FerrumDeck (`verify → gate → record`). **Governance evidence matches the x402 path:** `fd_otel::genai::span_helpers::record_ap2_cost` records the payment on the decision span (`ferrumdeck.cost.ap2_cents` + `ferrumdeck.ap2.merchant/intent_id/cart_id/decision`) alongside token cost, and the benchmark lane emits a W3C `traceparent` (MCP SEP-414) + an audit-decision record per authorization. **Benchmark row:** `fd_evals.governed_benchmark` gains an AP2 payment-rail governed-vs-ungoverned section over `evals/datasets/governed_benchmark/ap2_mandates.jsonl` (reusing the same 100¢ per-task ceiling) — **governed blocks 3/3 unsafe mandates (100%, tampered-signature + over-ceiling + scope-mismatch) and authorizes only the 1 valid, in-scope, in-budget cart; ungoverned pays all four ($0.40 governed vs $150.95 ungoverned)** — surfaced in `make bench-governed` + the README. New public API (re-exported from the `ferrumdeck` umbrella): `Ap2IntentMandate`, `Ap2CartMandate`, `Ap2Scope`, `Ap2Money`, `Ap2Keyring`, `Ap2CostEvent`, `Ap2GateOutcome`, `Ap2DenyKind`, `evaluate_ap2_payment`, `AP2_ANCHOR`. Tests: 13 fd-policy unit tests (authorize + each deny kind, JSON round-trip, keyring, ledger fold) + 2 fd-otel tests + a real-engine pin `rust/crates/fd-policy/tests/ap2_gate.rs` (drives `evaluate_ap2_payment` with real Ed25519 sigs: authorize valid, deny tampered/over-ceiling/scope-mismatch/unknown-key) + 4 fd-evals AP2 tests + refreshed golden. No-pivot: dual-plane split, Axum/SQLx/Postgres/Redis, MCP, Apache-2.0, Next.js dashboard all unchanged; no SaaS, no live settlement.

### Changed
- Workspace + all planes bumped `0.7.9 → 0.7.10`.

## [0.7.9] - 2026-07-24

### Added
- **x402-aware pre-call spend gate for autonomous payments** (`fd_policy::x402`): extends the existing per-agent cost budget from token/model spend to **paid-API spend**. When an agent's outbound call hits an [x402](https://x402.org) **HTTP `402 Payment Required`** response, the gate parses the quoted challenge (`X402Challenge` — scheme/asset/network/atomic-amount/decimals, from the real `{x402Version, accepts:[…]}` body shape), **normalizes it to cents** as a first-class cost event (`X402CostEvent`) that folds into the **same `cost_cents` ledger as inference** (so a run's cost slope includes autonomous payments, not just tokens), and checks it against the **remaining** per-agent budget **before** the payment is authorized — reusing the exact `Budget::has_cost_headroom` primitive the R2 reversibility rung already uses for token spend. A quote that would breach the ceiling is **hard-stopped** (`X402GateOutcome::Deny` + exactly one operator alert, mapped to `PolicyDecision::deny`); a quote in an asset with **no known USD peg** is **denied by default** (`DenyUnpriceable` — you cannot check a cents budget against an unpriceable quote), consistent with the crate's deny-by-default posture. Cent normalization is integer, **rounded up** (`⌈atomic·100 / 10^decimals⌉`), so sub-cent dust quotes can't slip the budget. **This never moves money** — it is a gate + cost model, not a wallet: it parses simulated 402 bodies, prices them, and returns an authorize/deny *decision*; signing an `X-PAYMENT` header / broadcasting a transfer lives entirely outside FerrumDeck (`simulate → gate → record`). The paid call rides the existing OTel span alongside token cost via `fd_otel::genai::span_helpers::record_x402_cost` (`ferrumdeck.cost.x402_cents` + `ferrumdeck.x402.asset/scheme/network/decision`, primitive-typed so fd-otel keeps no dependency on the fd-policy domain type). New public API surface: `X402Challenge`, `X402CostEvent`, `X402GateOutcome`, `evaluate_x402_payment`, `X402_ANCHOR` (re-exported from the published `ferrumdeck` umbrella). Runnable, self-verifying demo (exits non-zero if the gate fails to block the over-budget payment): `cargo run -p ferrumdeck --example x402_spend_gate` + [`examples/x402-spend-gate/`](examples/x402-spend-gate/README.md). Tests: 12 fd-policy unit tests (parse/normalize-ceil/authorize/hard-stop-with-overage/boundary/unpriceable-deny/no-cap/apply-to-one-ledger/serde) + 2 fd-otel tests (attr-key contract + span-helper smoke). No-pivot: dual-plane split, Axum/SQLx/Postgres/Redis, MCP, Apache-2.0 OSS, Next.js dashboard all unchanged; no SaaS surface, no live settlement. Anchors (verified live): [x402 Foundation under the Linux Foundation](https://www.linuxfoundation.org/press/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications) (2026-07-14), [Cloudflare Monetization Gateway on x402](https://blog.cloudflare.com/monetization-gateway/) (2026-07-01), [Databricks Unity AI Gateway](https://www.databricks.com/blog/ai-governance-data-ai-summit-2026-whats-new-unity-ai-gateway) hard spend caps, [FinOps FOCUS 1.4](https://siliconangle.com/2026/06/08/focus-specification-ai-cost-accountability-finopsx/) AI token economics.
- **Reproducible governed-vs-ungoverned benchmark + W3C-trace-context spans** (`fd_evals.governed_benchmark`): quantifies the two numbers no closed platform (Alterion Draco, Microsoft Agent 365, AWS Bedrock AgentCore) publishes — **governance overhead** (added latency/cost) and **% of unsafe tool actions blocked** — on one fixed [safe-PR-agent](evals/agents/safe-pr-agent) workload run twice: with the deny-by-default allowlist + Airlock RASP + cost budget **ON** (governed) and **OFF** (ungoverned). Four unsafe actions are injected, one per enforcement layer (`eval()`/`os.system` RCE write → anti-RCE matcher; raw-IP `http_request` → exfil shield; `delete_repo` → allowlist deny; a 6× runaway `search_code` → budget cap). **Reproduced numbers: governed blocked 4/4 (100%) vs 0/4 ungoverned; added decision latency ≈0.9 µs p50 / ≈8 µs p95; audit overhead +0.36¢ / +720 tokens; and governed cost 54% *less* to run (85.4¢ vs 184¢) because stopping the unsafe + runaway calls saves more than the decisions cost.** Deterministic, offline, no LLM: the workload is fixed, so the blocked set, reasons, and cost/token deltas are byte-stable (golden fixture `governed_benchmark.golden.json`); wall-clock latency is the one machine-dependent figure, measured-and-reported (same honesty posture as the enforcement-latency bench). The governed decision reuses `fd_evals.injection_defense.decide` (mirrors the Rust `fd_policy` contract) + the real `Budget::has_cost_headroom` semantics, and the blocked-set + governed/ungoverned cost are **pinned to the real engine** by a new `rust/crates/fd-policy/tests/governed_benchmark.rs` (drives the actual `ToolAllowlist` + `AirlockInspector` + `Budget` over the same `workload.jsonl`). Each governed decision rides the **existing** OTel + GenAI-semconv decision-span path (`fd_runtime.trace_tool_decision` → Jaeger, not replaced) and records its **W3C `traceparent`** (MCP SEP-414) so the benchmark trace is portable across the MCP boundary. New `fd-eval governed-benchmark` CLI subcommand + `make bench-governed` target; dataset under `evals/datasets/governed_benchmark/`; write-up in [`docs/BENCHMARK.md`](docs/BENCHMARK.md) with the reproducible command + honest scope; README headline. Tests: 2 Rust integration tests (real-engine block-all-unsafe + per-layer-reason) + 8 Python tests (blocking, overhead, determinism, golden, W3C-traceparent shape). No-pivot: dual-plane split, Axum/SQLx/Postgres/Redis, MCP tool protocol, Apache-2.0 OSS, Next.js dashboard all unchanged; no SaaS surface.

### Changed
- Workspace + all planes bumped `0.7.8 → 0.7.9` (Rust workspace + `fd-dag` override + the two internal path-dep pins, six Python packages, `nextjs`).

## [0.7.8] - 2026-07-20

### Added
- **Cross-MCP W3C trace-context correlation — MCP SEP-414** (`fd_otel::trace_context`): the enforcement decision span now joins the *caller's* distributed trace. When a tool-call request carries W3C trace context in `_meta` (the unprefixed `traceparent`/`tracestate`/`baggage` keys SEP-414 reserves), the gateway extracts + strictly validates the `traceparent` (version `00`, 32-hex non-zero trace-id, 16-hex non-zero parent-id, 2-hex flags), **rejects** malformed/all-zero values rather than propagating them, caps `tracestate`/`baggage` to the W3C limits (dropping, not erroring, and recording the drop), and **parents the existing decision span** (`fd_otel::decision::emit_tool_decision_span`) on that remote context — no second telemetry path. The trace-id + sampled flag are persisted on the enforcement decision record (the append-only `audit_events` row: dedicated `trace_id`/`span_id` columns + a `trace_context` object in `details`, plus optional additive `trace_id`/`trace_sampled` on the `fd_audit::AuditEvent` receipts substrate), so an audit query can join a policy decision to its trace. Feature-gated behind the **same** OTel semconv stability opt-in as the GenAI span naming (`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`); unset, ferrumdeck ignores `_meta` and starts a root span exactly as before — a pure extension for callers who send nothing. **Honest scope:** this **targets** the 2026-07-28 MCP revision (a *Release Candidate* as of this change) and implements the SEP-414 conventions (SEP status *Final*); it is **not** a conformance claim to an unreleased spec. Tests: 10 fd-otel extraction/validation/capping unit tests (valid propagates + parent context matches; malformed + all-zero rejected; absent → root; oversized tracestate truncated + recorded) + fd-storage persistence tests (trace-id lands on the record; no-`_meta` leaves it trace-free) + fd-audit receipts round-trip. Docs: [`docs/mcp-trace-conformance.md`](docs/mcp-trace-conformance.md) (verbatim SEP-414 + W3C quotes, end-to-end trace tree, explicit does/does-not-guarantee), linked from the README observability section.

### Changed
- Workspace + all planes bumped `0.7.7 → 0.7.8`.

## [0.7.7] - 2026-07-19

### Added
- **Colorado SB 26-189 (2026) ADMT record-keeping rule** (`fd_policy::colorado_sb26_189`): deny-by-default-style enforcement on the R1–R3 ladder for automated decision-making technology in *consequential decisions* — an ADMT-disclosure flag on covered decisions, a queryable "what decided this, when, on what inputs" record (`ColoradoAdmtRecord`, round-tripped through the append-only `audit_events` trail), and a 3-year retention floor. Follows the Art.50 rule shape; unit + integration tested; not legal advice (structural check only, C.R.S. subsections to be confirmed against the enrolled act). See [ADR 0005](docs/adr/0005-colorado-sb26-189-admt.md).
- **Storage-layer 3-year retention floor** (`fd_storage::retention` + migration `20260719000001_add_audit_retention_floor`): a DB trigger rejects UPDATE and rejects DELETE of any `audit_events` row younger than 3 years; `AuditRepo::prune_admt_expired` is guarded so an early prune is refused before any SQL runs. Single source of truth in `fd_policy::colorado_sb26_189::RETENTION_FLOOR_YEARS`.
- **`ferrumdeck.admt_disclosure`** attribute on the shared enforcement decision span (`fd_otel::emit_tool_decision_span`) — the Colorado disclosure flag rides the existing GenAI span, not a parallel emitter; kept behind the `GenAiSemconv` resolver.

### Changed
- Workspace + all planes bumped `0.7.6 → 0.7.7` (Rust workspace + `fd-dag` override + the two internal path-dep pins, six Python packages, `nextjs`).

## [0.7.6] - 2026-07-18

### Added
- **OTel enforcement decision-spans on both planes** (`fd_otel::decision` + `fd_runtime.tracing`): every allow/deny/approval/kill verdict is emitted as a queryable GenAI span (`ferrumdeck.decision` + reason/rung/budget), behind the `OTEL_SEMCONV_STABILITY_OPT_IN` semconv-flip knob.
- **Reproducible observability blind-spot benchmark** (`fd_evals.enforce_vs_observe`): one AgentDojo-style injection trace run record-only (records post-hoc) vs in-path gate (blocks pre-execution) on the same span; `make bench-enforce-vs-observe`; doc at `docs/benchmarks/enforce-vs-observe.md`.
- Enforcement engine **published to crates.io** as `ferrumdeck-core` / `ferrumdeck-policy` / `ferrumdeck` at 0.7.6 (folds in the never-released 0.7.5 work; see below).

### Fixed
- Resolve clippy `for_kv_map` / `dead_code` lints surfaced by rustc/clippy 1.97 stable.

### Note
- **0.7.5 was never tagged or released.** The workspace was bumped `0.7.4 → 0.7.5` for the decision-span work but no `v0.7.5` tag or crates.io publish was cut; that content shipped in **0.7.6**.

## [0.7.4] - 2026-07-07

### Added
- Enforcement engine **first published to crates.io** under the `ferrumdeck-*` brand (`ferrumdeck-core`/`-policy` + the `ferrumdeck` umbrella; `[lib] name` keeps `fd_core`/`fd_policy` import paths), with the `release-crate.yml` provenance workflow.

## [0.7.3] - 2026-07-06

### Added
- **ASB benchmark axis + EU AI Act Art.50 transparency-enforcement rule** (`fd_evals.asb`, `fd_policy::transparency_art50`): Agent-Security-Bench attack classes over the deny-by-default allowlist + Airlock + R1–R3 ladder, plus a structural Art.50 disclosure/marking rule; corpus-pinned to the real Rust enforcement.
- **Reproducible enforcement decision-path latency microbenchmark** (`rust/crates/fd-policy/benches/enforcement_latency.rs`, criterion): sub-millisecond decision cost; `make bench-enforcement`; doc at `docs/benchmarks/enforcement-latency.md`.

## [0.7.2] - 2026-07-04

_First tagged release. Consolidates the untagged `0.1.0 → 0.7.2` governance/enforcement build-out (117 commits); the intermediate version numbers below were never tagged._

### Added
- **Coherence-divergence monitor** (`fd_policy::airlock::coherence`, Strained Coherence): trajectory-level Airlock signal; graduated R1–R3 enforcement, wired live into the gateway run stream, with an SSE event + drift demo.
- **Reversibility-tiered graduated response** (`fd_policy::reversibility`, DeepMind R1–R3 ladder): reversible→R1, costly→R2-under-budget, irreversible→R3 approval.
- **Claim-grounding-rate reliability metric** (`fd_otel::claim_grounding` + `fd_evals.claim_grounding`, VeriGraph): per-run lexical-overlap grounding proxy, cross-plane golden-pinned.
- **HarnessX trace→signal loop**: eval-driven harness suggestions (proposal-only, never auto-applied) + training-signal export (reusing the audit redactor) + dashboard panel.
- **Champion-challenger promotion gate** (`fd_policy::promotion`): metric-threshold + human-approval gate, deny-by-default, audited.
- **Delegation-aware budget leases** (`fd_policy::lease`): shared atomic pool so fan-out cannot out-spend the parent cap; `!Copy`/`!Clone` move semantics.
- **Debt-vs-tax cost decomposition** (`fd_otel::cost_decomposition` + `fd_evals.cost_decomposition`): per-call `span_role`, per-run token vs tax rollups.
- **Per-harness eval dimension** (`fd_evals.harness`, Harness-Bench): report at `(model × harness_config)` with a structural config hash.
- **Routing-decision audit** (`fd_policy::routing`, AgensFlow): content-hashed, replayable coordination records on the immutable audit trail, cross-plane hash-pinned.
- **Reproducible AgentDojo-style injection-defense block-rate suite** (`fd_evals.injection_defense`): Wilson-CI block-rate, corpus-pinned to the real RASP.
- **Tool-call firing-rate metric** (`fd_otel::firing_rate` + `fd_evals.firing_rate`): share of reasoning steps that invoked a tool, cross-plane golden-pinned.
- **Benchmark-audit pre-flight + policy gate** (`fd_evals.bench_audit`, ABA).
- **Receiver attestation for self-reported spans** (`fd_runtime.attestation`, optional/off-by-default): binds a signed receipt to a span; additive signal, never drops spans.
- **Airlock hardening**: credential DLP + per-domain data budget on the exfil shield; schema-drift guard for tool-call payloads; per-agent behavioral-drift z-score.
- **Explicit policy conflict resolution + decision traces** (`fd_policy::precedence`, `fd_policy::trace`).
- **Predictive run-budget forecast + cost-anomaly projection** on SSE + dashboard.
- **Airlock security system** (anti-RCE / financial circuit breaker / data-exfil shield), workflow DAG scheduling, Helm chart, comprehensive test suite + CI, OpenAPI docs, and the Safe PR Agent reference agent.
- `docs/receipts-schema.md` mapping the audit shape to Foundation Protocol primitives (+ schema-drift golden).

### Changed
- Workspace stepped `0.2.0 → 0.3.0 → 0.4.0 → 0.5.0 → 0.6.0 → 0.7.0 → 0.7.1 → 0.7.2` (none tagged before 0.7.2); Python data-plane versions synced up from a stranded `0.1.0` to match the other planes.

### Fixed
- ~50 fixes across CI/test hardening, dashboard stabilization (sidebar tests, module docs, health), the Axum 0.8 migration, and clippy/format cleanup. (Consolidated; the untagged pre-0.7.2 range was not sectioned per-commit.)

## [0.2.0] – [0.7.1] — not tagged

These workspace versions appear in `Cargo.toml` history but were **never tagged
or released**, so no honest release date can be assigned to them. Their changes
are consolidated into **[0.7.2]** above (the first tag that captured them).

## [0.1.0] - 2026-01-15

### Added

- Initial release of FerrumDeck AgentOps Control Plane
- Rust control plane with Axum HTTP API
- Python data plane with litellm LLM execution
- Next.js 16 dashboard with dark "Mission Control" theme
- Deny-by-default tool policies with approval gates
- Budget enforcement (tokens, cost, time, tool calls)
- Immutable audit trail with PII redaction
- MCP router for secure tool execution
- Evaluation framework (fd-evals) for agent testing
- OpenTelemetry integration with GenAI semantic conventions
- Redis Streams for job queue
- PostgreSQL with pgvector for storage
