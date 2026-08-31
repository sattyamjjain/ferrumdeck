# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- AUTO-MANAGED: project-description -->
## Overview

**FerrumDeck** is a deterministic, in-path enforcement engine and AgentOps control plane for agentic AI workflows. Every tool call an agent attempts passes through a policy decision before it executes.

Polyglot monorepo:
- **Rust** control plane — enforcement engine, policy, audit chain, orchestration; Axum gateway + workspace crates
- **Python** data plane — LLM execution, MCP tool calls, evaluation/benchmark framework; uv workspace
- **Next.js** dashboard — admin UI over the gateway (React 19, Tailwind 4, shadcn/Radix)
- **Postgres + Redis** — primary datastore and step queue; OTel/Jaeger for tracing

Enforcement surface: deny-by-default tool allowlists, five-layer Airlock RASP inspection, budget gates with leases,
the R1–R3 reversibility ladder, AP2/x402 payment spend gates, approval gates, and a hash-chained audit trail with
out-of-band checkpoint anchoring. Regulatory rules ship as first-class modules (EU AI Act Art.50 transparency,
Colorado SB 26-189).

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build & Development Commands

```bash
# Quick start
make quickstart           # Infra + gateway + worker + dashboard
make install              # All deps (cargo fetch + uv sync)

# Dev infra — deploy/docker/compose.dev.yaml
make dev-up               # Postgres 5433, Redis 6379, Jaeger 16686, OTel 4317/4318
make dev-down
make dev-logs / make dev-ps

# Run services (separate terminals)
make run-gateway          # cargo run --package gateway → :8080
make run-worker           # Python worker, consumes Redis stream
make run-dashboard        # Static dashboard (deploy/dashboard) → :8000
npm run dev --prefix nextjs   # Next.js dashboard → :3001

# Build
make build                # build-rust + build-python
make build-rust           # cargo build --workspace
make build-release        # cargo build --workspace --release

# Test
make test-rust            # cargo test --workspace
make test-python          # pytest fd-evals + fd-worker
make test-integration     # cargo test -- --ignored; pytest -m integration (needs dev-up)

# Code quality
make fmt                  # cargo fmt + ruff format python/
make lint                 # cargo clippy + ruff check python/ + pyright python/
make check                # fmt + lint + test
make ci-check             # Full CI gate

# Contract + schema generation
make gen-openapi          # scripts/gen_openapi.sh → contracts/
make gen-schemas          # scripts/gen_schemas.sh

# Claims integrity (CI-enforced honesty gates)
make check-claims             # README/ROADMAP claims vs docs/feature-status.yml
make check-changelog-issues   # CHANGELOG [Unreleased] issue refs vs GitHub
make claims-recount           # Re-derive test counts from pytest/cargo

# Evals + benchmarks
make eval-run                 # Smoke suite (needs ANTHROPIC_API_KEY)
make eval-run-full            # Full regression
make eval-injection-defense   # Deterministic, offline, no LLM
make eval-asb                 # ASB + EU AI Act Art.50, seeded, offline
make eval-report              # Render a report from the latest results
make bench-enforcement        # Criterion latency bench on the decision path
make bench-enforce-vs-observe # Enforce vs shadow comparison (evals/enforce_vs_observe.py)
make bench-governed           # Governed vs ungoverned overhead + blocked %
make reproduce-spend-gate     # Reproduce AP2 + x402 spend-gate figures
make demo-x402
make eval-health              # Regenerate docs/eval-health.md from evals/reports/
make eval-health-check        # Fail if that page is stale

# `fd_evals run` takes --min-score <floor>; a breach exits 2 and means the
# harness stopped observing what it asserts on, not that the agent got worse.

# Misc
make dashboard                # Serve deploy/dashboard
make pull-mcp-image           # Pre-pull the MCP tool image
make repo-description         # Print the canonical one-line repo description

# Database
make db-migrate / db-reset / db-seed

# Dashboard (nextjs/)
npm run lint · npm test · npm run test:coverage
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Architecture

```
ferrumdeck/
├── Cargo.toml                  # Rust workspace root (members: rust/crates/*, rust/services/*)
├── pyproject.toml              # uv workspace root (members: python/packages/*)
├── rust/
│   ├── crates/
│   │   ├── ferrumdeck/         # Umbrella crate re-exporting the engine; `audit` feature
│   │   ├── fd-core/            # Typed ULID IDs (define_id!), config, errors, time
│   │   ├── fd-policy/          # Engine, Airlock, budgets/leases, AP2, x402,
│   │   │                       #   reversibility, Art.50, Colorado SB 26-189, routing
│   │   ├── fd-storage/         # SQLx Postgres repos/models, Redis stream queue, retention
│   │   ├── fd-audit/           # Hash-chained events, checkpoint anchoring, PII redaction
│   │   ├── fd-registry/        # Agent/tool versioning
│   │   ├── fd-dag/             # DAG scheduler
│   │   └── fd-otel/            # OTel setup, GenAI conventions, decision/cost/firing-rate spans
│   └── services/gateway/       # Axum HTTP API (:8080) — handlers/, middleware/, openapi.rs
├── python/packages/
│   ├── fd-runtime/             # Workflow models, client, tracing, airlock, attestation
│   ├── fd-worker/              # Queue consumer, step executor, LLM, agentic path, validation
│   ├── fd-mcp-router/          # MCP tool routing
│   ├── fd-mcp-tools/           # MCP servers (git, test runner)
│   ├── fd-evals/               # Eval + benchmark framework, scorers/
│   └── fd-cli/                 # CLI
├── nextjs/                     # Dashboard — src/{app,components,hooks,lib,types}
├── evals/                      # suites/, datasets/, agents/, reports/
├── contracts/ · db/migrations/ · docs/ · deploy/{docker,helm,k8s,dashboard}/
│     docs/eval-health.md          # generated by scripts/gen_eval_health.py
│     docs/otel-genai-mapping.md   # generated by observability/genai_mapping.py
├── observability/                 # otel/collector.yaml + genai_mapping.py (OTel GenAI semconv)
├── config/ · scripts/ · artifacts/ · examples/
└── tests/                      # api, chaos, e2e, integration, performance, security
      tests/*.py                # top-level regression guards (eval-health, genai mapping) —
                                #   CI must collect these, not just the subdirectories
```

**Data flow**
```
Dashboard / API clients
        │
        ▼
   Gateway (Rust) ──► Policy Engine ──► Run Orchestrator
                       (+ Airlock)            │
                                       Redis Streams
                                              │
                                       Python Worker
                                              │
                    ┌─────────────────────────┼─────────────────────────┐
                    ▼                         ▼                         ▼
                LLM call                 MCP tool call               Sandbox
                (litellm)          (routed, policy + Airlock gated)
```

**Ports**: Gateway 8080 · Next.js 3001 (container 3001:3000) · Static dashboard 8000 · Postgres 5433 · Redis 6379 · Jaeger UI 16686 · OTel gRPC 4317 / HTTP 4318.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Code Conventions

### Rust
- Edition 2021; workspace declares `rust-version = "1.80"`, but the dependency graph requires ≥1.88 — Docker images build on rust 1.90
- Tokio async + Axum 0.8 + tower middleware; dependencies pinned in `[workspace.dependencies]`
- Errors: `thiserror` in libraries, `anyhow` in applications
- IDs: ULID-based, strongly typed with prefixes (`run_`, `stp_`, `agt_`) via `define_id!` in fd-core
- DB: SQLx with compile-time checked queries (`cargo sqlx prepare --workspace`; `SQLX_OFFLINE=true` to build without a DB)
- Published crates rename on crates.io — `fd-core` → `ferrumdeck-core`, `fd-policy` → `ferrumdeck-policy`, `fd-audit` → `ferrumdeck-audit` — while lib/import paths stay `fd_core`, `fd_policy`, `fd_audit`. `fd-otel` → `ferrumdeck-otel` is also published, but the release workflow does not carry it (it publishes core → policy → audit → umbrella only), so it sits at 0.8.12. `fd-dag`, `fd-storage`, `fd-registry` are unpublished.
- Lint: `cargo clippy --workspace --all-targets -- -D warnings`

### Python
- Python 3.12+; **uv** workspace, members `python/packages/*`, internal deps via `[tool.uv.sources]`
- Format `ruff format` (line-length 100, target py312); lint `ruff check` + `pyright`
- Ruff rules: E/W/F/I/B/C4/UP/ARG/SIM/TCH/PTH/ERA/RUF — `PTH` forces `pathlib` over `os.path`, `ERA` rejects commented-out code. Only `E501` and `B008` are ignored.
- Tests: `pytest`, `asyncio_mode="auto"`
- First-party imports: `fd_runtime`, `fd_worker`, `fd_mcp_router`, `fd_evals`, `fd_cli`

### TypeScript / Next.js
- Next.js 16 + React 19, App Router (`src/app/`), route groups (`(dashboard)`), Tailwind 4, shadcn/ui on Radix
- TanStack Query/Table/Virtual for server state and grids; `nuqs` for URL state; `sonner` for toasts; `recharts` for charts; `cmdk` for the command palette; `next-themes` for dark mode
- ESLint via `eslint-config-next`; Jest + Testing Library (coverage thresholds intentionally not enforced)

### Naming
- Rust `snake_case` files/functions, `PascalCase` types · Python `snake_case` · TS `camelCase` functions, `PascalCase` components/types
- Crate prefix `fd-`; module prefix `fd_`

### Cross-cutting
- No hardcoded secrets — `.env` (gitignored) or Key Vault
- Handle errors at system boundaries (HTTP handlers, external calls); trust internal calls
- Keep functions under ~50 lines

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: patterns -->
## Detected Patterns

### Enforcement model
- **Deny-by-default** per-agent tool allowlist (`fd_policy::rules::ToolAllowlist`) with per-tool risk levels
- **Airlock RASP — five inspection layers** in `airlock/inspector.rs`, ordered cheapest-signal-first:
  1. *Layer −1* behavioral drift — per-agent rolling z-score over observations
  2. *Layer 0* schema drift — tool schema vs registered `tool_version_id`
  3. *Layer 1* anti-RCE pattern matching (`eval`, `exec`, shell injection)
  4. *Layer 2* velocity / financial circuit breaker (spend rate, loop detection)
  5. *Layer 3* exfiltration shield — domain allowlist, raw-IP blocking, credential DLP (`credential_dlp.rs`)
- **Coherence-divergence monitor** (`airlock/coherence.rs`) is *not* one of the five layers. Every inspector layer
  judges a single tool call in isolation; this one watches the run **trajectory** (the audit event stream) for the
  agent stating a fact that should change its plan ("tests still failing", "permission denied") and then advancing
  as if it were untrue. `observe_event` streams and fires mid-run; `scan_trajectory` replays a slice post-hoc —
  both share one detection core. Anchored on Strained Coherence (arxiv:2606.07889).
- Risk score buckets to Low/Medium/High/Critical; modes `shadow` (log only) vs `enforce` (block)
- **Reversibility ladder (R1–R3)** classifies actions by how recoverable they are
- **Budget enforcement** via `SharedBudget` + `BudgetLease`; forecasting in `forecast.rs`
- **Payment rails**: x402 pre-call spend gate and AP2 Ed25519-signed mandate chains, gated on the same decision path
- **Regulatory modules**: `transparency_art50.rs` (EU AI Act Art.50), `colorado_sb26_189.rs`
- **Precedence + promotion**: `precedence.rs` resolves conflicting rules; `promotion.rs` moves policies shadow → enforce
- Every decision emits a `DecisionTrace`

### Audit
- `audit_events` are hash-chained (`chain.rs`); chain heads are anchored out-of-band (`checkpoint.rs`) so tampering is detectable even with DB write access
- PII redaction at write time (`redaction.rs`)

### Step execution
- LLM calls via `litellm`; tool calls via MCP router, gated by policy + Airlock
- **LLM02 mitigation**: worker validates LLM output before dispatching any tool
- Retry with exponential backoff (`tenacity`) for transient failures
- OTel spans propagate `run_id` → `step_id`, using GenAI semantic conventions

### API + dashboard
- Axum gateway, typed handlers, OpenAPI via `utoipa` + Swagger UI
- Gateway middleware: auth, oauth2, rate limiting, request ID
- BFF pattern — Next.js exposes explicit per-resource routes under `src/app/api/v1/**/route.ts` that proxy to the gateway; SSE at `api/sse/[channel]` with TanStack Query polling fallback

### Honesty gates
- `docs/feature-status.yml` is the source of truth for feature claims; `check-claims` fails CI when README/ROADMAP overstate it
- `check-changelog-issues` verifies CHANGELOG `[Unreleased]` issue references against GitHub
- Evals for governance behavior are deterministic and offline (no LLM) so they can gate PRs
- `docs/eval-health.md` is generated from committed reports and regenerated by the nightly; an eval that has never passed is labelled **NEVER PASSED** in its own row rather than omitted
- `docs/otel-genai-mapping.md` is generated from `observability/genai_mapping.py`; it states mapped-vs-unmapped field counts and explicitly disclaims OTel GenAI conformance
- A suite's declared scorers must be loadable — `build_scorer` raises `SuiteError` on an unknown `type:` rather than falling back to defaults. The YAML-name → class map is `SCORER_REGISTRY` in `fd_evals/suite.py`, and those names are a suite file's public contract
- **A zero is not automatically a real zero.** `UNOBSERVABLE_SCORERS` (`files_changed`, `pr_created`, `tests_pass`, `lint_pass`) read run fields the control plane does not surface; a suite selecting them asserts on data the harness cannot see, and the runner says so instead of scoring 0. Check `assertion_coverage` before citing any eval score, and never let an output scorer assert against a mock stand-in

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: git-insights -->
## Git Insights

- Recent focus: **trusting the test/eval harness itself**. A run of fixes established that a suite can report green or zero without ever having measured anything — the regression suite had never been scheduled, 18 `tests/*.py` guards were never collected by CI, eval-health was built from local output instead of committed evidence, and an output scorer was asserting against a mock stand-in. Treat a suspicious score as a harness question first
- Earlier: release + supply-chain hardening — per-arch image builds on native runners (not QEMU), Docker base bumped for MSRV, crates published under the `ferrumdeck-*` names
- Enforcement features landed as first-class policy modules: AP2 signed-mandate spend gate, x402 pre-call gate, audit chain-head anchoring, schema-drift and behavioral-drift Airlock layers
- Strong anti-fabrication theme throughout: fixes explicitly stop the dashboard/evals from serving mock or fabricated data, and CI gates check claims, changelog issue references, and eval-health staleness
- Security posture maintained through dependency floors (litellm, mcp SDK) and an agent-security SARIF gate
- Branch convention `feature/<desc>`, `fix/<desc>`, `chore/<desc>` against `main`; conventional commit prefixes with scope, imperative subject < 72 chars. `fix` and `feat` dominate; `chore(release)` promotes the changelog

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: best-practices -->
## Best Practices

- Run `make check` before commits; `make ci-check` to mirror CI
- Verify after changes: `cargo clippy --workspace --all-targets -- -D warnings`, `uv run pyright python/`, `npx tsc --noEmit` in `nextjs/`
- Migrations run automatically on gateway startup — never invoke them manually in CI
- Never write `close/fix/resolve #N` in a commit or PR body — it auto-closes the issue on merge, even when quoted
- Keep `docs/feature-status.yml` in sync when adding or removing a capability, or `check-claims` will fail
- When touching the decision path, add a deterministic offline eval rather than an LLM-dependent one
- Before trusting any green suite, confirm it actually ran: that CI collects the test paths, that the schedule fires, and — for live-stack runs — that the readiness probe and seeded API key are real. A suite that never executed looks identical to one that passed
- Port conflicts: `lsof -i :<port>` then `kill -9 $(lsof -t -i :<port>)`
- Stuck queue debug: `redis-cli -p 6379 XLEN fd:steps:pending`
- Dashboard build errors: `cd nextjs && rm -rf .next node_modules && npm install`
- Ask before destructive ops (db-reset, force-push, dropping tables)

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Custom Notes

Add project-specific notes here. This section is never auto-modified.

<!-- END MANUAL -->
