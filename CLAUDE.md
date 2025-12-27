# FerrumDeck

<!-- AUTO-MANAGED: project-description -->
## Overview

**FerrumDeck** is a production-grade AgentOps Control Plane for running agentic AI workflows with deterministic governance. It provides policy enforcement, audit logging, and secure execution for AI agents.

**Architecture**: Polyglot monorepo with Rust control plane (governance, orchestration) and Python data plane (LLM execution, tool calls).

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

# Test
make test                 # Run all tests
make test-rust            # cargo test --workspace
make test-python          # pytest on fd-evals and fd-worker

# Code Quality
make fmt                  # Format all code (cargo fmt + ruff format)
make lint                 # Lint all code (clippy + ruff + pyright)
make check                # Run fmt + lint + test

# Database
make db-migrate           # Run migrations
make db-reset             # Drop and recreate database

# Run services
make run-gateway          # Start Rust gateway
make run-worker           # Start Python worker

# Evals
make eval-run             # Run evaluation suite
make eval-report          # Generate eval report
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
│   └── runbooks/             # Operational guides
└── tests/                    # Integration tests
```

**Data Flow**:
```
Clients → Gateway → Policy Engine → Run Orchestrator
                                          │
                                    Redis Queue
                                          │
                                    Python Worker
                                          │
                              ┌───────────┼───────────┐
                              │           │           │
                           LLM Call   Tool Call   Sandbox
```

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
- **Linting**: `cargo clippy -- -D warnings`

### Python
- **Version**: 3.12+ (uses modern type hints)
- **Package Manager**: uv (pyproject.toml workspaces)
- **Formatting**: ruff format (line-length 100)
- **Linting**: ruff check + pyright (standard mode)
- **Testing**: pytest with asyncio_mode="auto"
- **Imports**: isort via ruff (known-first-party: fd_*)

### Naming
- Rust: snake_case for files/functions, PascalCase for types
- Python: snake_case throughout, PascalCase for classes
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

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Project Notes

Add project-specific notes, TODOs, or context here. This section is never auto-modified.

<!-- END MANUAL -->
