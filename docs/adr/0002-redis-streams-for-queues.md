# ADR-0002: Redis Streams for Job Queues

## Status
Accepted

## Context
The control plane needs to communicate jobs to workers. We need a reliable, performant message queue.

Requirements:
- At-least-once delivery
- Message persistence
- Consumer group support (multiple workers)
- Low latency (<10ms enqueue)
- Observable (queue depth monitoring)
- Simple operations

## Decision
We use **Redis Streams** as the job queue mechanism.

### Queue Structure
```
fd:queue:steps    - Step execution jobs
fd:queue:results  - Result callbacks (future)
```

### Consumer Groups
Each worker type has its own consumer group:
- `workers` - Python step executors

### Message Format
```json
{
  "id": "msg_01J...",
  "job_type": "step_execution",
  "payload": {
    "run_id": "run_01J...",
    "step_id": "stp_01J...",
    "step_type": "llm",
    "input": {...}
  },
  "created_at": "2024-12-25T00:00:00Z",
  "attempts": 0
}
```

### Acknowledgment Flow
1. Worker reads message with `XREADGROUP`
2. Worker processes job
3. Worker calls Gateway with result
4. Gateway sends `XACK` to remove from pending
5. If no ACK within timeout, Redis re-delivers to another consumer

## Consequences

### Positive
- Already using Redis for caching, no new infrastructure
- Built-in consumer groups handle load balancing
- XPENDING allows dead letter queue handling
- Excellent performance (100k+ messages/sec)
- Persistence survives Redis restarts

### Negative
- Not a full-featured message broker (no routing, topics)
- Manual dead letter queue implementation
- Stream trimming needs configuration

### Configuration
```env
REDIS_URL=redis://localhost:6379
REDIS_QUEUE_PREFIX=fd:queue:
REDIS_STREAM_MAXLEN=100000
REDIS_CONSUMER_BLOCK_MS=5000
```

## Alternatives Considered

### RabbitMQ
- More features (routing, DLQ)
- Rejected: Additional infrastructure, overkill for our needs

### PostgreSQL LISTEN/NOTIFY
- No additional infrastructure
- Rejected: No persistence, no consumer groups

### AWS SQS / Google Cloud Pub/Sub
- Managed service
- Rejected: Cloud lock-in, need self-hosted option

### Kafka
- Enterprise-grade streaming
- Rejected: Operational complexity too high for initial deployment

## References
- [Redis Streams Tutorial](https://redis.io/docs/data-types/streams-tutorial/)
- [Consumer Groups](https://redis.io/docs/data-types/streams-tutorial/#consumer-groups)
