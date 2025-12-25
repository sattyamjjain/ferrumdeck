# ADR 0002: Redis Streams for Job Queuing

## Status

Accepted

## Date

2024-12-26

## Context

FerrumDeck needs a reliable job queue to dispatch step execution jobs from the Gateway (control plane) to Workers (data plane). Requirements:

1. **Durability**: Jobs must not be lost on service restart
2. **At-least-once delivery**: Every job must be processed
3. **Consumer groups**: Multiple workers should share the load
4. **Visibility timeout**: Failed jobs should be retried
5. **Ordering**: Jobs for the same run should be processable in order
6. **Monitoring**: Need visibility into queue depth and processing rate
7. **Low latency**: Sub-100ms dispatch time

## Decision

We use **Redis Streams** as our job queue mechanism.

### Implementation Details

```
Stream: fd:step_queue
Consumer Group: workers
```

**Message Structure:**
```json
{
  "run_id": "uuid",
  "step_id": "uuid",
  "step_type": "llm|tool|retrieval|sandbox",
  "input": {},
  "tenant_id": "uuid",
  "agent_id": "uuid",
  "priority": 0
}
```

**Operations:**
- `XADD fd:step_queue * ...` - Gateway adds job
- `XREADGROUP GROUP workers consumer-{id} ...` - Worker claims job
- `XACK fd:step_queue workers {id}` - Worker acknowledges completion
- `XPENDING fd:step_queue workers` - Monitor pending jobs
- `XCLAIM fd:step_queue workers ...` - Reclaim stuck jobs

### Configuration
- `MAXLEN ~10000`: Cap stream size with approximate trimming
- `BLOCK 5000`: Workers block for 5s waiting for jobs
- `COUNT 1`: Process one job at a time per worker
- Claim idle jobs after 60 seconds

## Consequences

### Positive
- **Native Redis**: No additional infrastructure (already using Redis for caching)
- **Durable**: Survives Redis restarts (with persistence enabled)
- **Consumer groups**: Built-in load balancing across workers
- **Backpressure**: XPENDING provides queue depth for HPA metrics
- **Ordering**: Messages ordered within stream
- **Fast**: Sub-millisecond operations

### Negative
- **No priority queues**: All jobs share one stream (workaround: multiple streams)
- **Manual dead-letter**: Need to implement retry/DLQ logic
- **No delayed jobs**: Cannot schedule future execution natively
- **Memory**: Large backlogs consume Redis memory

### Mitigations
- Implement job timeout and retry with XCLAIM
- Dead-letter to separate stream after N retries
- Monitor memory with Redis alerts
- Use MAXLEN to prevent unbounded growth

## Alternatives Considered

### 1. RabbitMQ
- Full-featured message broker
- Rejected: Additional infrastructure, overkill for our use case

### 2. PostgreSQL SKIP LOCKED
- Use database as queue
- Rejected: Higher latency, contention under load

### 3. AWS SQS / GCP Pub/Sub
- Managed queuing service
- Rejected: Cloud vendor lock-in, latency for on-prem deployments

### 4. Kafka
- High-throughput streaming
- Rejected: Operational complexity, overkill for job queue use case

## References

- [Redis Streams Documentation](https://redis.io/docs/data-types/streams/)
- [Redis Streams Tutorial](https://redis.io/docs/data-types/streams-tutorial/)
- [Building Reliable Queue with Redis Streams](https://redis.com/blog/reliable-message-queue-redis-streams/)
