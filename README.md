# FerrumDeck

**AgentOps Control Plane** — A production-grade platform for running agentic AI workflows with deterministic governance and measurable reliability.

## Overview

FerrumDeck provides a **deterministic control plane** (Rust) and **probabilistic runtime** (Python) for operating AI agents safely in production.

### Key Features

- **Governance**: Tool allowlists, approval gates, budget enforcement
- **Observability**: Full tracing with OpenTelemetry GenAI conventions
- **Reproducibility**: Version-pinned runs, step-level replay
- **Quality**: Evaluation suites with regression gating

## Quick Start

### Prerequisites

- Rust 1.83+
- Python 3.12+
- Docker & Docker Compose
- [uv](https://docs.astral.sh/uv/) (Python package manager)

### Setup

```bash
# Clone the repository
git clone https://github.com/ferrumdeck/ferrumdeck.git
cd ferrumdeck

# Start infrastructure (Postgres, Redis, Jaeger)
make dev-up

# Install dependencies
make install

# Build everything
make build

# Run tests
make test
```

### Running the Gateway

```bash
# Start the Rust gateway
make run-gateway

# In another terminal, start a Python worker
make run-worker
```

### Create a Run

```bash
curl -X POST http://localhost:8080/v1/runs \
  -H "Content-Type: application/json" \
  -d '{
    "agent_id": "agt_example",
    "input": {"task": "Hello, world!"}
  }'
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Clients                               │
│              (Web UI / CLI / SDK / CI Pipelines)            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                  Control Plane (Rust)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │ Gateway │ │ Policy  │ │Registry │ │  Audit  │            │
│  │   API   │ │ Engine  │ │         │ │   Log   │            │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
            ┌───────────┐       ┌───────────────┐
            │   Redis   │       │  PostgreSQL   │
            │  (Queue)  │       │  (Storage)    │
            └───────────┘       └───────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                   Data Plane (Python)                        │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐            │
│  │ Worker  │ │   LLM   │ │   MCP   │ │ Sandbox │            │
│  │         │ │Executor │ │ Router  │ │  Exec   │            │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌───────────────────┐
                    │   OpenTelemetry   │
                    │     → Jaeger      │
                    └───────────────────┘
```

## Project Structure

```
ferrumdeck/
├── contracts/          # OpenAPI specs, JSON schemas
├── rust/
│   ├── crates/         # Shared libraries
│   │   ├── fd-core/    # IDs, errors, config
│   │   ├── fd-policy/  # Policy engine
│   │   ├── fd-registry/# Versioned registry
│   │   ├── fd-audit/   # Audit log
│   │   └── fd-otel/    # Observability
│   └── services/
│       └── gateway/    # API gateway
├── python/
│   └── packages/
│       ├── fd-runtime/ # Runtime primitives
│       ├── fd-worker/  # Queue consumer
│       ├── fd-mcp-router/ # Tool routing
│       └── fd-evals/   # Evaluation harness
├── deploy/
│   └── docker/         # Docker Compose
├── evals/              # Evaluation datasets
└── docs/               # Documentation
```

## Development

```bash
# Format code
make fmt

# Lint code
make lint

# Run all checks
make check

# Run specific tests
cargo test -p fd-policy
uv run pytest python/packages/fd-runtime
```

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
# Database
DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5432/ferrumdeck

# Redis
REDIS_URL=redis://localhost:6379

# LLM Providers
ANTHROPIC_API_KEY=sk-ant-xxx
OPENAI_API_KEY=sk-xxx

# OpenTelemetry
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

## Documentation

- [Architecture Overview](docs/architecture/overview.md)
- [Policy Engine](docs/architecture/policy-engine.md)
- [Threat Model](docs/architecture/threat-model.md)
- [API Reference](contracts/openapi/control-plane.openapi.yaml)

## License

Apache-2.0
