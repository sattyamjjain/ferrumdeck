# ADR-0001: Control Plane / Data Plane Separation

## Status
Accepted

## Context
FerrumDeck is an AgentOps platform that orchestrates AI agent execution. We need to decide on the high-level architecture for processing agent runs.

Key considerations:
- Agent runs involve LLM API calls which can be slow (seconds to minutes)
- Tool executions may involve arbitrary external systems
- The control plane must remain responsive for API requests
- We need clear security boundaries between orchestration and execution

## Decision
We adopt a **Control Plane / Data Plane separation**:

### Control Plane (Rust Gateway)
- Handles all API requests (REST/OpenAPI)
- Manages state in PostgreSQL
- Publishes jobs to Redis Streams
- Enforces policy decisions
- Records audit events
- Remains stateless for horizontal scaling

### Data Plane (Python Workers)
- Consumes jobs from Redis Streams
- Executes LLM calls via LiteLLM
- Routes tool calls via MCP
- Reports results back to Control Plane
- Scales independently based on queue depth

### Communication
- **Job Queue**: Redis Streams (reliable, persistent)
- **Results**: HTTP callbacks to Gateway
- **Health**: Prometheus metrics from both planes

## Consequences

### Positive
- Clear separation of concerns
- Independent scaling of API vs execution capacity
- Language-appropriate: Rust for performance-critical control, Python for LLM ecosystem
- Security isolation: workers never access control plane database directly
- Failure isolation: worker crashes don't affect API availability

### Negative
- Added complexity of distributed system
- Need to manage eventual consistency
- Debugging spans multiple services
- Additional operational overhead

### Risks & Mitigations
| Risk | Mitigation |
|------|------------|
| Queue backpressure | Backpressure signals via Redis stream length |
| Worker starvation | Consumer group load balancing |
| Message loss | Redis Stream persistence + acknowledgment |

## Alternatives Considered

### Monolithic Service
- Simpler architecture
- Rejected: LLM calls would block API responsiveness

### Serverless Workers (Lambda/Cloud Run)
- Auto-scaling built in
- Rejected: Cold start latency unacceptable for interactive agents

### gRPC instead of HTTP callbacks
- More efficient
- Rejected: HTTP simpler for initial implementation, can migrate later

## References
- [Redis Streams Documentation](https://redis.io/docs/data-types/streams/)
- [CQRS Pattern](https://martinfowler.com/bliki/CQRS.html)
