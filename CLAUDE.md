# FerrumDeck

<!-- AUTO-MANAGED: project-description -->
## Overview

**FerrumDeck** is a production-grade AgentOps Control Plane for running agentic AI workflows with deterministic governance. It provides policy enforcement, audit logging, and secure execution for AI agents.

**Architecture**: Polyglot monorepo with Rust control plane (governance, orchestration), Python data plane (LLM execution, tool calls), and Next.js dashboard (admin UI).

**Key Features**:
- Deny-by-default tool policies with approval gates
- Budget enforcement and rate limiting
- Immutable audit trail for compliance
- MCP router for secure tool execution
- Evaluation framework for agent testing

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: build-commands -->
## Build & Development Commands

```bash
# Quick Start
make quickstart           # Start everything (infra + gateway + worker)
make dashboard            # Open dashboard UI in browser

# Setup
make install              # Install all dependencies (Rust + Python)
uv sync                   # Sync Python dependencies

# Development environment
make dev-up               # Start Docker services (Postgres, Redis, Jaeger)
make dev-down             # Stop Docker services
make dev-logs             # Tail service logs

# Build
make build                # Build all (Rust + Python)
make build-rust           # cargo build --workspace
make build-python         # uv build
make build-release        # cargo build --workspace --release

# Test
make test                 # Run all tests
make test-rust            # cargo test --workspace
make test-python          # pytest on fd-evals and fd-worker
make test-integration     # Run integration tests

# Code Quality
make fmt                  # Format all code (cargo fmt + ruff format)
make lint                 # Lint all code (clippy + ruff + pyright)
make check                # Run fmt + lint + test
make ci-check             # Full CI check

# Database
make db-migrate           # Run migrations (auto on gateway restart)
make db-reset             # Drop and recreate database
make db-seed              # Seed with test data

# Run services
make run-gateway          # Start Rust gateway (localhost:8080)
make run-worker           # Start Python worker with MCP tools
make run-dashboard        # Start dashboard (localhost:8000)

# Evals (requires ANTHROPIC_API_KEY)
make eval-run             # Run smoke evaluation suite
make eval-run-full        # Run full regression suite
make eval-report          # Generate report from latest results

# Clean
make clean                # Clean all build artifacts
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Architecture

```
ferrumdeck/
├── rust/                     # Control Plane (Rust)
│   ├── crates/               # Shared libraries
│   │   ├── fd-core/          # IDs, config, errors
│   │   ├── fd-storage/       # PostgreSQL repos + Redis queue
│   │   ├── fd-policy/        # Policy engine, budgets, rules
│   │   ├── fd-registry/      # Agent/tool versioning
│   │   ├── fd-audit/         # Audit logging, redaction
│   │   ├── fd-dag/           # DAG scheduler
│   │   └── fd-otel/          # OpenTelemetry setup
│   └── services/
│       └── gateway/          # Axum HTTP API
├── python/                   # Data Plane (Python)
│   └── packages/
│       ├── fd-runtime/       # Workflow execution, tracing
│       ├── fd-worker/        # Queue consumer, step execution
│       ├── fd-mcp-router/    # MCP tool routing
│       ├── fd-mcp-tools/     # MCP server implementations
│       ├── fd-evals/         # Evaluation framework
│       └── fd-cli/           # CLI tool
├── nextjs/                   # Dashboard (Next.js 16+)
│   ├── src/app/              # App Router pages
│   ├── src/components/       # React components
│   ├── src/hooks/            # Custom hooks
│   ├── src/lib/              # API client, utilities
│   └── src/types/            # TypeScript interfaces
├── evals/                    # Evaluation configs
│   ├── suites/               # Test suites
│   ├── datasets/             # Test data
│   ├── agents/               # Agent configs
│   └── scorers/              # Scoring functions
├── contracts/                # API contracts
│   ├── openapi/              # OpenAPI specs
│   └── jsonschema/           # JSON schemas
├── deploy/                   # Deployment configs
│   ├── docker/               # Docker Compose
│   └── k8s/                  # Kubernetes manifests
├── docs/                     # Documentation
│   ├── architecture/         # System design
│   ├── adr/                  # Architecture decisions
│   ├── security/             # Security docs
│   └── runbooks/             # Operational guides
├── examples/                 # Example agents
│   └── safe-pr-agent/        # PR review agent example
└── tests/                    # Integration tests
```

**Data Flow**:
```
Dashboard ─┐
           ├─→ Gateway → Policy Engine → Run Orchestrator
API Clients┘                                    │
                                          Redis Queue
                                                │
                                          Python Worker
                                                │
                                    ┌───────────┼───────────┐
                                    │           │           │
                                 LLM Call   Tool Call   Sandbox
```

**Service Ports**:
- Gateway: `http://localhost:8080`
- Dashboard: `http://localhost:3000` (Next.js dev) or `http://localhost:8000` (static)
- PostgreSQL: `localhost:5433`
- Redis: `localhost:6379`
- Jaeger UI: `http://localhost:16686`

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Code Conventions

### Rust
- **Edition**: 2021 (MSRV 1.80)
- **Async**: Tokio runtime with tower middleware
- **Errors**: `thiserror` for library errors, `anyhow` for app errors
- **IDs**: ULID-based strongly-typed IDs with prefixes (`run_`, `stp_`, `agt_`)
- **Database**: SQLx with compile-time checked queries
- **Formatting**: `cargo fmt` (default rustfmt)
- **Linting**: `cargo clippy --workspace --all-targets -- -D warnings`

### Python
- **Version**: 3.12+ (uses modern type hints)
- **Package Manager**: uv (pyproject.toml workspaces)
- **Formatting**: ruff format (line-length 100)
- **Linting**: ruff check + pyright (standard mode)
- **Testing**: pytest with asyncio_mode="auto"
- **Imports**: isort via ruff (known-first-party: fd_*)

### TypeScript/Next.js
- **Version**: Next.js 16+ with React 19
- **Styling**: Tailwind CSS 4 with dark theme
- **Components**: shadcn/ui with Radix primitives
- **State**: TanStack Query for server state
- **Linting**: ESLint with next config

### Naming
- Rust: snake_case for files/functions, PascalCase for types
- Python: snake_case throughout, PascalCase for classes
- TypeScript: camelCase for functions, PascalCase for components/types
- Crate/package prefix: `fd-` (e.g., fd-core, fd-worker)
- Module prefix: `fd_` (e.g., fd_runtime, fd_worker)

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: patterns -->
## Detected Patterns

### Security Model
- **Deny-by-default**: All tools require explicit allowlist
- **LLM02 Mitigation**: Output validation in fd-worker
- **Budget enforcement**: Runs killed when limits exceeded
- **Approval gates**: Sensitive actions require human approval

### ID System
```rust
define_id!(RunId, "run");   // run_01HGXK...
define_id!(StepId, "stp");  // stp_01HGXK...
define_id!(AgentId, "agt"); // agt_01HGXK...
```

### Step Execution
- LLM calls via litellm (Claude/GPT support)
- Tool calls via MCP router with policy checks
- Retry with exponential backoff for transient failures
- OpenTelemetry tracing for all operations

### Testing Pattern
- Unit tests in `tests/` subdirectories
- Integration tests require `make dev-up`
- Evals use fd-evals framework with scorers
- Python: `pytest` with asyncio support
- Rust: `cargo test --workspace`

### API Pattern
- REST API via Axum with typed handlers
- BFF pattern in Next.js (`/api/v1/*` proxies to gateway)
- SSE for real-time run updates
- TanStack Query for data fetching with polling

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Development Workflows

### First-Time Setup
```bash
# 1. Clone and install dependencies
git clone <repo-url> && cd ferrumdeck
make install              # Installs Rust + Python + Node deps

# 2. Start infrastructure
make dev-up               # PostgreSQL, Redis, Jaeger

# 3. Run services (separate terminals)
make run-gateway          # Terminal 1: Rust gateway
make run-worker           # Terminal 2: Python worker
npm run dev --prefix nextjs  # Terminal 3: Dashboard
```

### Typical Development Cycle
```bash
make dev-up               # Start infra (if not running)
make run-gateway          # Start gateway (auto-runs migrations)
make run-worker           # Start worker in another terminal
# Edit code...
make check                # Format + lint + test before commit
```

### Running Evaluations
```bash
export ANTHROPIC_API_KEY=sk-ant-...
make eval-run             # Smoke suite (~2 min)
make eval-run-full        # Full regression (~10 min)
make eval-report          # View latest results
```

### Database Operations
```bash
make db-reset             # Drop and recreate (loses data!)
make db-seed              # Load test data
make db-migrate           # Apply pending migrations
```

### Docker Builds
```bash
# Build images
docker build -f deploy/docker/gateway.Dockerfile -t ferrumdeck-gateway .
docker build -f deploy/docker/worker.Dockerfile -t ferrumdeck-worker .
docker build -f nextjs/Dockerfile -t ferrumdeck-dashboard nextjs/

# Run with Docker Compose
docker compose -f deploy/docker/docker-compose.yml up
```

## Environment Variables

### Required
```bash
DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck
REDIS_URL=redis://localhost:6379
ANTHROPIC_API_KEY=sk-ant-...  # For LLM calls
```

### Optional
```bash
RUST_LOG=info,gateway=debug   # Rust logging level
GATEWAY_PORT=8080             # API server port
JAEGER_ENDPOINT=http://localhost:4317  # Tracing endpoint
FD_API_KEY=fd_dev_key_abc123  # Dashboard API key
```

## Troubleshooting

### Port Conflicts
```bash
# Check what's using a port
lsof -i :8080
lsof -i :5433

# Kill process on port
kill -9 $(lsof -t -i :8080)
```

### Database Issues
```bash
# Connection refused
make dev-up               # Ensure PostgreSQL is running

# Migration errors
make db-reset             # Nuclear option: drop and recreate

# Check PostgreSQL logs
docker logs ferrumdeck-postgres-1
```

### Redis Queue Stuck
```bash
# View queue contents
redis-cli -p 6379 XLEN fd:steps:pending

# Flush stuck jobs (careful!)
redis-cli -p 6379 DEL fd:steps:pending
```

### Worker Not Processing
```bash
# Check worker is connected
curl http://localhost:8080/health

# View worker logs
make run-worker           # Watch for connection messages

# Restart worker
Ctrl+C && make run-worker
```

### Gateway Not Starting
```bash
# Check if migrations ran
psql -h localhost -p 5433 -U ferrumdeck -d ferrumdeck -c "\dt"

# View gateway logs with debug
RUST_LOG=debug make run-gateway
```

### Dashboard Build Errors
```bash
cd nextjs
rm -rf .next node_modules
npm install
npm run build
```

## CI/CD Notes

- **Eval Gating**: PRs to main require smoke eval suite to pass
- **Migrations**: Gateway auto-runs on startup; don't run manually in CI
- **Docker Builds**: Multi-stage builds for minimal image size
- **Secrets**: ANTHROPIC_API_KEY in GitHub Secrets for evals

<!-- END MANUAL -->
