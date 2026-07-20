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

_Nothing yet._

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
