# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

<!-- AUTO-MANAGED: project-description -->
## Overview

**FerrumDeck** is a production-grade AgentOps Control Plane for running agentic AI workflows with deterministic governance. It provides policy enforcement, audit logging, budget gates, and secure execution for AI agents.

Polyglot monorepo:
- **Rust** control plane (governance, orchestration, policy engine) — Axum gateway + workspace crates
- **Python** data plane (LLM execution, MCP tool calls, evaluation framework) — uv workspaces
- **Next.js 16+** dashboard (admin UI) — React 19, Tailwind 4, shadcn/Radix
- **Postgres + Redis** as primary datastore + queue; Jaeger/OTel for tracing

Key safety features: deny-by-default tool allowlists, Airlock RASP inspection (anti-RCE, financial circuit breaker, data exfil shield), approval gates, immutable audit trail.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build & Development Commands

```bash
# Quick start
make quickstart           # Start infra + gateway + worker + dashboard
make install              # Install all deps (Rust + Python via uv sync)

# Dev environment (Postgres 5433, Redis 6379, Jaeger 16686)
make dev-up               # docker compose up -d
make dev-down             # docker compose down
make dev-logs             # Tail container logs

# Run services (separate terminals)
make run-gateway          # Rust gateway → localhost:8080
make run-worker           # Python worker (consumes Redis queue)
make run-dashboard        # Static dashboard → localhost:8000
npm run dev --prefix nextjs   # Next.js dev → localhost:3001

# Build
make build                # build-rust + build-python
make build-rust           # cargo build --workspace
make build-python         # uv build
make build-release        # cargo build --workspace --release

# Test
make test                 # All tests
make test-rust            # cargo test --workspace
make test-python          # pytest fd-evals + fd-worker
make test-integration     # Integration suite (needs dev-up)

# Code quality
make fmt                  # cargo fmt + ruff format
make lint                 # cargo clippy + ruff check + pyright
make check                # fmt + lint + test
make ci-check             # Full CI check

# Database
make db-migrate           # Apply migrations (auto on gateway start)
make db-reset             # Drop + recreate + seed
make db-seed              # Load test data

# Evals (requires ANTHROPIC_API_KEY)
make eval-run             # Smoke suite (~2 min)
make eval-run-full        # Full regression (~10 min)
make eval-report          # Generate report from latest results

# Dashboard (nextjs/)
npm run lint              # eslint
npm test                  # jest
npm run test:coverage     # Coverage report
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Architecture

```
ferrumdeck/
├── rust/                       # Control Plane
│   ├── crates/
│   │   ├── fd-core/            # IDs (ULID + prefixes), config, errors
│   │   ├── fd-storage/         # SQLx Postgres repos + Redis streams queue
│   │   ├── fd-policy/          # Policy engine, budgets, Airlock RASP
│   │   ├── fd-registry/        # Agent/tool versioning
│   │   ├── fd-audit/           # Audit log + PII redaction
│   │   ├── fd-dag/             # DAG scheduler
│   │   └── fd-otel/            # OpenTelemetry setup
│   └── services/
│       └── gateway/            # Axum HTTP API (port 8080)
├── python/packages/            # Data Plane (uv workspace)
│   ├── fd-runtime/             # Workflow execution + tracing
│   ├── fd-worker/              # Redis queue consumer, step executor
│   ├── fd-mcp-router/          # MCP tool routing
│   ├── fd-mcp-tools/           # MCP server implementations
│   ├── fd-evals/               # Evaluation framework
│   └── fd-cli/                 # CLI tool
├── nextjs/                     # Dashboard (Next.js 16+, React 19)
│   └── src/{app,components,hooks,lib,types}
├── evals/                      # Eval configs (suites, datasets, scorers, agents)
├── contracts/                  # OpenAPI specs + JSON schemas
├── db/migrations/              # SQLx migrations
├── deploy/                     # docker/, k8s/, dashboard/
├── docs/                       # architecture/, adr/, security/, runbooks/
├── examples/safe-pr-agent/     # Reference agent
└── tests/                      # api, chaos, e2e, integration, performance, security
```

**Data flow**:
```
Dashboard / API Clients
        │
        ▼
   Gateway (Rust) ──► Policy Engine ──► Run Orchestrator
                                              │
                                       Redis Streams
                                              │
                                     Python Worker
                                              │
                       ┌──────────────────────┼──────────────────────┐
                       ▼                      ▼                      ▼
                   LLM Call              MCP Tool Call            Sandbox
                   (litellm)         (Airlock RASP inspect)
```

**Service ports**: Gateway 8080 · Next.js 3001 · Static dashboard 8000 · Postgres 5433 · Redis 6379 · Jaeger UI 16686 · OTel gRPC 4317 / HTTP 4318.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Code Conventions

### Rust
- Edition 2021, MSRV 1.80; Tokio async + Axum + tower middleware
- Errors: `thiserror` for library errors, `anyhow` for application errors
- IDs: ULID-based, strongly-typed with prefixes — `run_`, `stp_`, `agt_` via `define_id!` macro in fd-core
- DB: SQLx with compile-time checked queries
- Format: `cargo fmt` (default rustfmt). Lint: `cargo clippy --workspace --all-targets -- -D warnings`

### Python
- Python 3.12+; package manager **uv** with `[tool.uv.workspace]` members under `python/packages/*`
- Format: `ruff format` (line-length 100). Lint: `ruff check` + `pyright` (standard mode)
- Tests: `pytest` with `asyncio_mode="auto"`
- Import groups: `known-first-party = ["fd_runtime", "fd_worker", "fd_mcp_router", "fd_evals", "fd_cli"]`

### TypeScript / Next.js
- Next.js 16.1 + React 19, App Router (`src/app/`), Tailwind 4, shadcn/ui on Radix primitives
- TanStack Query for server state; ESLint with `eslint-config-next`
- Tests: Jest + Testing Library; coverage thresholds intentionally not enforced

### Naming
- Rust: `snake_case` files/functions, `PascalCase` types
- Python: `snake_case` throughout, `PascalCase` for classes
- TypeScript: `camelCase` functions, `PascalCase` components and types
- Crate prefix: `fd-` (e.g., `fd-core`); module prefix: `fd_` (e.g., `fd_runtime`)

### Cross-cutting
- No hardcoded secrets — use `.env` (gitignored) or Azure Key Vault
- Handle errors at system boundaries (HTTP endpoints, external calls); trust internal calls
- Keep functions under ~50 lines; extract helpers if longer

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: patterns -->
## Detected Patterns

### Security model
- **Deny-by-default** tool allowlist per agent
- **Airlock RASP** three-layer inspection on tool calls:
  1. Anti-RCE pattern matcher (`eval`, `exec`, shell injection)
  2. Financial circuit breaker (spending velocity, loop detection)
  3. Data exfiltration shield (domain whitelist, blocks raw IPs)
- Modes: `shadow` (log only, safe rollout) vs `enforce` (block)
- **Approval gates** for sensitive actions; **budget enforcement** kills runs over limits
- **LLM02 mitigation**: worker validates LLM output before tool dispatch

### Step execution
- LLM calls via `litellm` (Claude + GPT support)
- Tool calls via MCP router, gated by policy engine + Airlock
- Retry with exponential backoff for transient failures
- OpenTelemetry traces every step (spans propagate run_id → step_id)

### API + dashboard
- Axum gateway with typed handlers; OpenAPI via `utoipa` + Swagger UI
- BFF pattern in Next.js: `/api/v1/*` proxies to gateway
- SSE for real-time run updates; TanStack Query polling fallback

### Testing
- Unit tests live in module `tests/` subdirectories
- Integration tests require `make dev-up`
- Evals use fd-evals framework with custom scorers under `evals/scorers/`

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: git-insights -->
## Git Insights

- Recent focus: CI/test hardening — coverage thresholds removed, jest peer deps fixed, gateway artifact-download filters tuned
- Dashboard stabilization: sidebar test fixes, module documentation added, dashboard bug fixes
- Gateway: legacy hash deadline extended in dev to ease local migration churn
- Rust: Axum 0.8 migration (`merge` replaces empty-path `nest`), clippy/format cleanup
- Branch convention: `feature/<desc>`, `fix/<desc>`, `chore/<desc>` against `main`
- Commit style: conventional prefixes (`fix(scope):`, `feat:`); imperative subject < 72 chars

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: best-practices -->
## Best Practices

- Run `make check` before commits — formats + lints + tests in one shot
- Verify after changes: `python3 -m py_compile <file>`, `cargo clippy`, `npx tsc --noEmit` in `nextjs/`
- Migrations run automatically on gateway startup — do **not** invoke manually in CI
- Eval gating: PRs to `main` require the smoke suite to pass; set `ANTHROPIC_API_KEY` locally
- For port conflicts: `lsof -i :<port>` then `kill -9 $(lsof -t -i :<port>)`
- Stuck queue debug: `redis-cli -p 6379 XLEN fd:steps:pending`
- Dashboard build errors: `cd nextjs && rm -rf .next node_modules && npm install`
- Use Plan mode for multi-step work; ask before destructive ops (db-reset, force-push, drop tables)

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Custom Notes

Add project-specific notes here. This section is never auto-modified.

<!-- END MANUAL -->
