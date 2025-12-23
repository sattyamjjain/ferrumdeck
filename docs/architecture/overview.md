# Architecture Overview

FerrumDeck follows a **control plane / data plane** separation pattern, similar to how Kubernetes separates API server concerns from node execution, or how GitLab runs AI workloads through a dedicated AI Gateway service.

## Design Principles

### 1. Deterministic Control, Probabilistic Execution

- **Control Plane (Rust)**: Deterministic state management, policy evaluation, orchestration
- **Data Plane (Python)**: Probabilistic AI execution, tool calls, LLM interactions

### 2. Immutability as a Feature

All configurations are versioned and immutable once created:
- Agent definitions
- Tool schemas
- Prompt templates
- Policy rules

This enables reproducible runs and precise debugging.

### 3. Deny-by-Default Security

Every tool call must be explicitly allowed. The policy engine evaluates:
1. Is this tool in the allowlist?
2. Does this action require approval?
3. Is the run within budget?

### 4. Observability First

Every operation emits:
- OpenTelemetry traces (with GenAI semantic conventions)
- Structured logs
- Metrics
- Audit events

## Component Overview

### Control Plane Services

```
┌─────────────────────────────────────────────────────────┐
│                    Gateway Service                       │
│  - HTTP API (Axum)                                      │
│  - Authentication (API keys, OAuth2)                    │
│  - Rate limiting                                         │
│  - Request routing                                       │
└─────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────┐
│                    Core Services                         │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │   Registry   │  │   Policy     │  │    Audit     │   │
│  │   Service    │  │   Engine     │  │    Log       │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │     Run      │  │   Budget     │                     │
│  │ Orchestrator │  │   Tracker    │                     │
│  └──────────────┘  └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

### Data Plane Services

```
┌─────────────────────────────────────────────────────────┐
│                    Worker Service                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │    Queue     │  │    Step      │  │    OTel      │   │
│  │   Consumer   │  │  Executor    │  │  Reporter    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │     LLM      │  │     MCP      │  │   Sandbox    │   │
│  │   Executor   │  │   Router     │  │  (Future)    │   │
│  └──────────────┘  └──────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────┘
```

## Data Flow

### Run Creation

```
1. Client → POST /v1/runs
2. Gateway → Validate request
3. Gateway → Check policy (is this agent allowed?)
4. Gateway → Create run record in Postgres
5. Gateway → Enqueue first step to Redis
6. Gateway → Return run ID to client
```

### Step Execution

```
1. Worker polls Redis queue
2. Worker receives step job
3. Worker executes step:
   - LLM: Call model via litellm
   - Tool: Route through MCP router
   - Sandbox: Execute in isolated env
4. Worker reports result to Control Plane
5. Control Plane updates run state
6. Control Plane enqueues next step (or completes run)
```

### Policy Evaluation

```
1. Before each action, check policy:
   - Tool allowlist check
   - Budget check
   - Approval gate check
2. If denied: Block action, update run status
3. If requires approval: Pause run, wait for approval
4. If allowed: Proceed with action
```

## Storage

### PostgreSQL Tables

| Table | Purpose |
|-------|---------|
| `tenants` | Multi-tenant isolation |
| `workspaces` | Organizational grouping |
| `agents` | Agent definitions |
| `agent_versions` | Immutable agent configs |
| `tools` | Tool definitions |
| `tool_versions` | Immutable tool configs |
| `runs` | Run records |
| `steps` | Step records |
| `policy_rules` | Policy configurations |
| `policy_decisions` | Decision audit trail |
| `audit_events` | Immutable audit log |

### Redis Streams

| Stream | Purpose |
|--------|---------|
| `fd:queue:steps` | Step execution queue |
| `fd:cache:*` | Various caches |

## Observability

### OpenTelemetry Integration

All services emit traces, metrics, and logs via OpenTelemetry:

```yaml
Trace Hierarchy:
  run (root span)
  └── step
      ├── llm_call
      │   └── attributes: model, tokens, cost
      ├── tool_call
      │   └── attributes: tool_name, server
      └── policy_check
          └── attributes: decision, rule_id
```

### GenAI Semantic Conventions

We follow the OpenTelemetry GenAI semantic conventions for LLM observability:

- `gen_ai.system`: Provider (anthropic, openai)
- `gen_ai.request.model`: Model name
- `gen_ai.usage.input_tokens`: Input token count
- `gen_ai.usage.output_tokens`: Output token count
