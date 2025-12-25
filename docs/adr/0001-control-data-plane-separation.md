# ADR 0001: Control Plane and Data Plane Separation

## Status

Accepted

## Date

2024-12-26

## Context

FerrumDeck is a platform for running AI agents with safety guardrails. We need to decide on the architectural pattern for how the platform handles:

1. API requests and orchestration (control logic)
2. Actual LLM calls and tool execution (data processing)

Key considerations:
- LLM calls can be long-running (seconds to minutes)
- Tool executions may need to run in isolated environments
- We need horizontal scalability for both operations
- Different security requirements for API handling vs code execution
- Different resource profiles (CPU-bound vs IO-bound)

## Decision

We adopt a **Control Plane / Data Plane separation** architecture:

### Control Plane (Gateway Service)
- **Written in**: Rust (axum framework)
- **Responsibilities**:
  - API endpoint handling (REST)
  - Authentication and authorization
  - Policy evaluation (tool allowlists, budgets)
  - Run orchestration and state management
  - Approval queue management
  - Audit logging
  - Workflow DAG scheduling
- **Scaling**: Based on API request rate
- **State**: Stateless (all state in PostgreSQL/Redis)

### Data Plane (Worker Service)
- **Written in**: Python
- **Responsibilities**:
  - LLM API calls (Anthropic, OpenAI via LiteLLM)
  - MCP tool execution
  - Sandbox code execution
  - Artifact storage
  - Retrieval operations
- **Scaling**: Based on queue depth (Redis Streams)
- **State**: Stateless (pulls jobs from queue)

### Communication
- **Control → Data**: Redis Streams (step_queue)
- **Data → Control**: HTTP API (submit_step_result)
- **Shared State**: PostgreSQL (runs, steps, artifacts)

## Consequences

### Positive
- **Independent scaling**: Gateway scales for API load, Workers scale for compute load
- **Language optimization**: Rust for low-latency API, Python for ML ecosystem
- **Security isolation**: Workers can run in restricted network segments
- **Fault isolation**: Worker crashes don't affect API availability
- **Flexible deployment**: Workers can run on GPU nodes, Gateway on standard compute

### Negative
- **Operational complexity**: Two services to deploy and monitor
- **Latency overhead**: Queue-based communication adds milliseconds
- **Debugging complexity**: Traces span multiple services

### Neutral
- Need comprehensive observability (OTel) to track requests across planes
- Need health checks and retry logic for inter-service communication

## Alternatives Considered

### 1. Monolithic Service
- Simpler deployment
- Rejected: Cannot scale LLM calls independently from API handling

### 2. Serverless Functions
- Maximum scaling flexibility
- Rejected: Cold start latency too high for interactive use cases, complex state management

### 3. Sidecar Pattern
- Workers as sidecars to Gateway pods
- Rejected: Cannot scale independently, resource contention

## References

- [Kubernetes Control Plane Architecture](https://kubernetes.io/docs/concepts/overview/components/)
- [AWS Well-Architected: Separation of Concerns](https://docs.aws.amazon.com/wellarchitected/latest/framework/oe-separation-of-concerns.html)
