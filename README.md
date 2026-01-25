# FerrumDeck

**AgentOps Control Plane** — A production-grade platform for running agentic AI workflows with deterministic governance, comprehensive observability, and measurable reliability.

[![CI](https://github.com/sattyamjjain/ferrumdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/sattyamjjain/ferrumdeck/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.80+-orange.svg)](https://www.rust-lang.org/)
[![Python](https://img.shields.io/badge/python-3.12+-blue.svg)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/next.js-16.1-black.svg)](https://nextjs.org/)

---

## Table of Contents

- [Overview](#overview)
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

## Key Features

### Governance
- **Deny-by-Default Tools**: Only explicitly allowed tools can be called
- **Approval Gates**: High-risk actions require human approval before execution
- **Budget Enforcement**: Automatic run termination when limits exceeded (tokens, cost, time)
- **Policy Engine**: Configurable rules for tool access and risk management

### Observability
- **OpenTelemetry Integration**: Full distributed tracing with GenAI semantic conventions
- **Cost Tracking**: Real-time token counting and cost calculation per run
- **Jaeger UI**: Visual trace exploration and debugging
- **Audit Trail**: Immutable logging of every action for compliance

### Reproducibility
- **Versioned Registry**: Agents, tools, and prompts are version-controlled
- **Step-Level Replay**: Debug specific steps with exact inputs
- **Deterministic IDs**: ULID-based identifiers for time-ordered, collision-resistant tracking

### Quality
- **Evaluation Framework**: Deterministic test suites for agent workflows
- **Regression Gating**: CI blocks merges if agent quality degrades
- **Baseline Comparisons**: Track performance across versions

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

---

## Quick Start

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
| `/threats` | Security threat detection and monitoring |
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

FerrumDeck implements multiple security layers:

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Authentication                                  │
│   • API Keys (SHA256 hashed, scoped)                    │
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
└─────────────────────────────────────────────────────────┘
```

### Threat Model

**Assumption**: Prompt injection cannot be fully prevented.

**Strategy**: Containment, not prevention.

| Threat | Mitigation |
|--------|-----------|
| Malicious tool calls | Deny-by-default allowlist |
| Token exhaustion | Budget limits with auto-kill |
| Data exfiltration | Allowlist blocks unauthorized tools |
| Privilege escalation | Scoped API keys, tenant isolation |
| Audit tampering | Append-only, immutable logging |

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

Helm charts coming soon. For now, use the Docker images with your preferred orchestration.

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
