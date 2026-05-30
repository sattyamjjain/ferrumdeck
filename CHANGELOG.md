# Changelog

All notable changes to FerrumDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Governance
- **Routing-decision audit for multi-agent coordination (AgensFlow, [arXiv:2605.27466](https://arxiv.org/abs/2605.27466))**: First-class, auditable, replayable record of every coordination/routing decision the orchestrator makes. New `fd_policy::routing::RoutingDecision { id, run_id, subtask_id, candidates[], chosen, reason{code,detail}, content_hash, decided_at, anchor }` is built at the dispatch choke point (`gateway::handlers::orchestrator::create_and_enqueue_step`) and written through the **existing** immutable audit trail (`Repos::spawn_audit` → `AuditRepo::create` → `audit_events`); no parallel store, no new exporter. Five stable reason codes — `policy_match`, `budget_within_limits`, `approval_gate`, `skip`, `fallback_default` — cover the dispatch-time policy outcomes the orchestrator already enumerates. SHA-256 over a stable JSON projection of the structural fields makes records content-addressed so replays can detect coordination drift. New `AuditRepo::list_routing_decisions(run_id)` filtered projection plus action / resource constants (`action::ROUTING_DECIDED`, `resource::ROUTING_DECISION`). New utoipa-documented `GET /v1/runs/{run_id}/routing -> RoutingResponse` read endpoint deserialises the chain back out of `audit_events.details` (malformed rows skipped with a warn, never blocked). New `routing.decision.recorded` SSE event type on the per-run channel locks in the wire shape (BFF mock first, gateway→BFF push deferred — same pattern as `policy.decision.explained`, `run.forecast.updated`, SchemaDriftGuard). fd-evals replay path extended with `ReplayTrace.routing_decisions` and a new `fd_evals.routing` module mirroring the Rust shape (parser, expected-hash recomputation, `verify_chain` returning a `RoutingChainReport` with `is_complete` + `is_hash_consistent`). Cross-plane hash contract pinned at both ends: Rust integration test `routing_hash_export::fixture_hash_is_pinned` and Python coverage test `test_routing_decision_chain::test_python_hash_matches_rust_pin` both assert the digest `b24284a106e28a41f408a96694ca410772719bc9d5dcc23f629707c75dfe4410` for the canonical fixture; a mismatch on either side fails CI. Tests: 8 new Rust unit tests (hash stability, reason-code drift, structural-mutation drift, anchor serde round-trip, snake_case wire shape) + 1 Rust integration test pinning the cross-plane hash + 8 new Python tests (cross-plane hash, chain extraction filter, completeness check, drift detection, defensive parsing). See [`docs/runbooks/routing-decision-audit.md`](docs/runbooks/routing-decision-audit.md) for the contract. Anti-pivot upheld: dual-plane split, MCP, OTel/Jaeger GenAI semconv all unchanged.

#### Observability
- **Tool-call firing-rate metric (`ferrumdeck.metrics.tool_call_firing_rate`)**: New derived OTel signal tracking the share of reasoning (`StepType::Llm`) steps that invoked at least one tool, computed per run and aggregated per agent over a sliding time window. Pure compute lives in `fd_otel::firing_rate` (Rust) and `fd_evals.firing_rate` (Python) — same arithmetic on both planes, no FFI. Five new attribute keys ship under the existing `ferrumdeck.*` semconv extension (rate, reasoning-step count, invoking-step count, breach flag, threshold); no new telemetry backend, exporter, or collector pipeline is introduced. Dashboard agent overview tab gets a Recharts area-chart trend panel with a configurable low-firing-rate threshold (default 40%, dropdown 20–60%) and a sliding window selector (6h / 12h / 24h / 72h / 168h); a low-firing-rate breach paints the card with a red border + `AlertTriangle` badge. Gateway upstream is wired lazily — the BFF route at `/api/v1/registry/agents/[agentId]/tool-call-firing-rate` proxies to the gateway when present and falls through to a deterministic agent-id-seeded mock so the dashboard ships ahead of the upstream compute (same `BudgetProjectionBadge` / SchemaDriftGuard / `run.forecast.updated` pattern). Schema drift is gated by `python/packages/fd-evals/tests/test_tool_call_firing_rate_golden.py`: a synthetic workflow's compute output is diffed against `tests/fixtures/tool_call_firing_rate.golden.json`, with a `BLESS=1` rebless escape hatch. 7 new Rust unit tests cover the pure compute path (empty-window safety, threshold-strict-`<`, invoking-step clamping, JSON wire-shape stability, span-tagging compile-check). See [`docs/runbooks/tool-call-firing-rate.md`](docs/runbooks/tool-call-firing-rate.md) for the contract and tuning notes.

#### Documentation
- **`docs/receipts-schema.md`**: docs: ship receipts-schema.md mapping fd-policy audit shape to Foundation Protocol primitives + schema-drift regression. Names the existing `fd_audit::AuditEvent` struct (verified at workspace v0.1.0) as a stable receipts substrate compatible with [Foundation Protocol](https://arxiv.org/abs/2605.23218) (Mila + MetaGPT, 22 May 2026); documents the canonical 9-field shape with one-line semantics; maps every field to an FP event-substrate primitive (metering / receipt / settlement / policy / provenance / audit) with FerrumDeck-specific fields explicitly marked out of FP scope; echoes FP's "wrap and bridge existing protocols rather than replace" stance (FerrumDeck is the producer, FP / mnemo / SIEMs are all candidate consumers); records the agreed p95 ≤ 5 ms per-call budget for the audit insert path (bench + OTel histogram deferred to the follow-up `fd-receipts` crate). New `audit_record_schema_drift` integration test under `rust/crates/fd-audit/tests/` serializes a deterministic fixture event and diffs against `tests/fixtures/audit_record_schema.golden.json`; any change to the audit shape now requires re-blessing the golden (`BLESS=1 cargo test -p fd-audit --test audit_record_schema_drift`) *and* updating the receipts doc in the same commit, so the wire contract can't silently drift. No code change to the audit log itself; the `fd-receipts` crate that exports this stream as an FP event-substrate is deferred to a follow-up PR so the API contract is named first.

#### Evaluation hygiene
- **Bench-Audit Pre-Flight (ABA, [arXiv:2605.26079](https://arxiv.org/abs/2605.26079))**: New `fd_evals.bench_audit` module that scores an eval suite's task metadata + grader config against four ABA-style hygiene classes — `ambiguous_spec`, `env_conflict`, `brittle_grading`, `suspect_truth` — before any external benchmark delta is allowed to gate a routing/model-swap decision. The audit is purely deterministic (no LLM judge) so the same suite yields the same `bench_trust_score` on every CI run; flagged tasks ship with structured evidence strings. Exposed via `fd-eval audit --suite <name>` with a `--min-trust` exit-code gate, plus a new dashboard `BenchTrustCard` on `/evals/runs/[evalRunId]` that surfaces the score, hygiene-class breakdown, and flagged-task table. The Rust policy plane (`fd_policy::bench_audit::BenchAuditPolicy`) consumes the summary and emits verdicts (`bench_audit:low_trust_score`, `bench_audit:hitl_band`, `bench_audit:within_flagged_margin`, `bench_audit:high_trust_score`) that flow through the existing `resolve_conflicts` precedence resolver and `DecisionTrace` — this is a new *rule source*, not a parallel engine, so the deny-by-default invariant is preserved at the caller. New `PolicyEngine::evaluate_bench_gated_decision` wires the policy through the standard decision/trace shape. Tests: 15 new Python tests covering clean / dirty / per-class detectors + a regression guard that the shipped `safe-pr-agent` dataset stays above the default 0.70 threshold; 13 new Rust tests covering verdict precedence, override records, suite-id mismatch short-circuit, and engine-level wiring through the trace.

#### Governance
- **Explicit policy-conflict resolution + decision traces**: When more than one policy matches a tool call (e.g. denylist + approval-required + allowlist all hit), the engine no longer relies on evaluation order. New `fd_policy::precedence` module encodes the canonical ordering `Deny > RequiresApproval > BudgetCap > Allow` as the named, testable `precedence_rank()` function plus `resolve_conflicts()`. `BudgetCap` is a dedicated tier so operators can tell allowlist-deny from budget-deny in the trace. Every `PolicyDecision` now carries an additive `trace: Option<DecisionTrace>` recording every matched verdict, which one fired, and which were overridden + why. Surfaced on `POST /v1/runs/{id}/check-tool` as `decision_trace` (additive — older clients ignore). New BFF SSE event `policy.decision.explained` locks in the wire shape; gateway→BFF push wiring is deferred (same pattern as SchemaDriftGuard and `run.forecast.updated`). 24 new unit/integration tests cover the precedence math, override records, three-way conflicts, and back-compat with the legacy `ToolAllowlist::check` short-circuit. See `docs/runbooks/policy-conflict-resolution.md` for the contract. Design reference: CUGA (*Governance by Construction for Generalist Agents*, Shlomov et al., arXiv:[2605.20874](https://arxiv.org/abs/2605.20874)) — informed the broader policy-as-code framing; the precedence function and override-record schema are FerrumDeck-original.
- **Predictive run-budget forecasting**: After each step is recorded, the gateway projects the run's end-of-run cost (linear extrapolation + EWMA-smoothed projection) against `PolicyEngine::default_budget()`. The snapshot — `projected_cost_cents`, `ewma_cost_cents`, `budget_breach_projected`, `breach_kind` — is denormalized onto `runs` and surfaced on `GET /v1/runs/{id}`. Compute lives in `fd-policy::forecast` with `rust_decimal` math (no ML dep). Persistence is best-effort and never gates run progress. See `docs/runbooks/budget-forecast.md` for the contract.
- **`run.forecast.updated` SSE event**: New event type on the per-run channel `run:{run_id}` carrying the latest forecast snapshot. The BFF SSE endpoint (`nextjs/src/app/api/sse/[channel]/route.ts`) emits this shape via the mock generator so dashboards and the schema are locked in. Gateway→BFF push wiring is deferred to a follow-up PR, mirroring the SchemaDriftGuard pattern; polling on the run-detail endpoint picks up forecast updates immediately.
- **Dashboard surfaces**: New `BudgetProjectionBadge` on the run header (pulses when `budget_breach_projected = true`), and a dashed "projected to add" segment stacked on today's bar of the daily cost chart aggregating extra cost from currently-active flagged runs.

#### Deployment
- `deploy/helm/ferrumdeck` Helm chart packaging the gateway, worker, dashboard, and optional bundled Postgres (pgvector) + Redis. Mirrors the existing Kustomize manifests at `deploy/k8s/` (both are retained). CI runs `helm lint` + `kubeconform` on any change under `deploy/helm/`.

#### Airlock RASP Security System
- **Credential DLP**: New `airlock::credential_dlp` module scans outbound payloads for cloud keys (AWS access key id, GCP service-account JSON marker), PATs (GitHub, Stripe live keys, Anthropic, OpenAI, Slack bot tokens), and financial account numbers. False positives on PAN and IBAN suppressed via Luhn (mod-10) and mod-97 checksum validators — arbitrary 16-digit correlation ids are not flagged. Matches recorded as `ViolationType::CredentialLeak` with a redacted first-4/last-4 fingerprint; raw secret never enters audit storage.
- **Per-domain data budget on the exfiltration shield**: New `ExfiltrationConfig.data_budget_per_domain_bytes` caps cumulative outbound bytes per `(run, domain)` tuple. Exceedance returns `ViolationType::DataExfiltrationBudget` and denies further dispatches through the existing shadow/enforce-mode plumbing. Per-run state cleared via `AirlockInspector::clear_run` when a run terminates.
- **Schema-Drift Guard**: Validates MCP tool-call payloads against the registered JSON Schema on each `ToolVersion`. Drifted fields surface as structured deltas (missing-required, type-mismatch, constraint-violation) inside the `AirlockViolation.details` field. New `SchemaDriftGuard` is attached at gateway boot once tool versions load; activation is gated on `InspectionContext.tool_version_id` being populated by the caller. Gateway/worker/dashboard wiring is intentionally deferred to a follow-up PR.
- **Anti-RCE Pattern Matcher**: Detects dangerous code patterns in tool inputs (eval, exec, shell injection)
- **Financial Circuit Breaker**: Spending velocity limits and loop detection to prevent runaway costs
- **Data Exfiltration Shield**: Domain whitelist enforcement, blocks raw IPs, prevents C2 connections
- New `/threats` dashboard page for viewing security violations
- Threat count badges on run detail pages
- Shadow/enforce mode toggle in settings

#### Enhanced Authentication & Authorization
- HMAC-SHA256 API key hashing (replaces plain SHA256)
- Legacy hash migration deadline (2025-03-01) with automatic rejection after deadline
- Scope-based authorization middleware (`require_admin()`, `require_write()`)
- Pre-auth IP-based rate limiting (prevents auth endpoint abuse)

#### LLM Security Monitoring
- Comprehensive audit logging for all LLM calls via litellm
- Token usage anomaly detection (flags calls exceeding thresholds)
- Real-time cost tracking per call
- Security event logging with timestamps and call IDs

#### Dashboard Improvements
- Animated counters for stats display
- Improved error and not-found pages
- Enhanced SSE endpoint with authentication
- Better empty state components

### Fixed

#### Security Vulnerabilities (19/25 resolved)
- **H-001, H-002**: IDOR vulnerabilities - Added tenant validation via `can_access_project()`
- **H-003**: Path traversal in test runner - Added `is_relative_to()` check
- **H-004**: Command injection via container name - Added regex validation
- **H-005**: Unauthenticated SSE access - Added authentication requirement
- **H-006**: Rate limit bypass - Added pre-auth IP-based rate limiter
- **H-007**: Command injection via extra args - Added `validate_extra_args()` allowlist
- **H-008**: Missing LLM monitoring - Added security logging and anomaly detection
- **M-001**: Missing scope enforcement - Added middleware to routes.rs
- **M-002**: Approval without ownership check - Added project verification
- **M-003**: Indefinite legacy hash support - Added migration deadline
- **C-004**: Default API key secret - Made mandatory in production
- **C-005**: Hardcoded fallback API key - Removed fallback, throws error
- **C-006**: Unpinned Docker images - Pinned to rust:1.80-bookworm, uv:0.5.11
- **L-001**: Detailed JWT errors - Changed to generic error messages
- **L-003**: Test API key in production - Added seed migration safety checks

### Changed

- Docker images now use pinned versions for reproducible builds
- JWT validation errors now return generic messages (prevents information leakage)
- API key authentication now uses HMAC with server secret
- Rate limiting now applies before authentication (IP-based)

### Security

- **Accepted Risk (L-002)**: JWT session invalidation requires Redis blacklist infrastructure. Mitigated with short JWT expiry times. API key revocation works immediately.
- **Manual Action Required (C-001, C-002, C-003)**: Rotate exposed API keys at respective provider consoles (Anthropic, OpenAI, GitHub)

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
