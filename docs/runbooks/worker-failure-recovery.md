# Runbook: Worker Failure Recovery

## Overview
This runbook covers recovery procedures when Python workers fail or become unresponsive.

## Failure Scenarios

### 1. Worker Process Crash
**Symptoms:**
- Container restarts in Kubernetes
- Jobs stuck in "running" state
- Redis consumer group has pending messages

**Recovery:**
```bash
# Check worker status
kubectl get pods -l app=worker -n ferrumdeck

# Check for crash loops
kubectl describe pod <worker-pod> -n ferrumdeck

# Check logs
kubectl logs <worker-pod> -n ferrumdeck --previous
```

### 2. Worker Hung (Deadlock)
**Symptoms:**
- Worker process running but not processing jobs
- CPU usage near 0%
- Increasing queue depth

**Recovery:**
```bash
# Kill hung worker (Kubernetes will restart)
kubectl delete pod <worker-pod> -n ferrumdeck

# Verify replacement starts
kubectl get pods -l app=worker -n ferrumdeck -w
```

### 3. LLM Provider Outage
**Symptoms:**
- All LLM steps failing
- Errors mention timeout or API errors
- Other providers may work

**Recovery:**
1. Check provider status page
2. Consider failover to backup provider
3. Update `LITELLM_MODEL` if needed

```bash
# Switch to backup model
kubectl set env deployment/worker \
  LITELLM_MODEL=anthropic/claude-sonnet-4-20250514 \
  -n ferrumdeck
```

### 4. MCP Server Unavailable
**Symptoms:**
- Tool steps failing
- Errors mention connection refused
- LLM steps still work

**Recovery:**
```bash
# Check MCP server health
curl http://mcp-server:3000/health

# Restart MCP server if needed
kubectl rollout restart deployment mcp-server -n ferrumdeck

# Workers will automatically reconnect
```

## Redis Queue Recovery

### Check Pending Messages
```bash
# Connect to Redis
redis-cli -h redis-host

# List pending messages
XPENDING fd:queue:steps workers

# Get details of stuck messages
XPENDING fd:queue:steps workers - + 10
```

### Claim Abandoned Messages
Messages older than 5 minutes with no ACK can be reclaimed:

```bash
# Claim old messages for reprocessing
XAUTOCLAIM fd:queue:steps workers new-worker 300000 0-0 COUNT 10
```

### Dead Letter Queue
For messages that repeatedly fail:

```bash
# Move to DLQ after 3 failures
XADD fd:queue:dlq * job_id <id> error "Max retries exceeded"

# Acknowledge original message
XACK fd:queue:steps workers <message-id>
```

## Stuck Runs Recovery

### Find Stuck Runs
```sql
-- Runs stuck in 'running' for over 30 minutes
SELECT id, status, started_at, agent_version_id
FROM runs
WHERE status = 'running'
  AND started_at < NOW() - INTERVAL '30 minutes';
```

### Fail Stuck Runs
```sql
-- Mark as failed with explanation
UPDATE runs
SET status = 'failed',
    error = '{"code": "WORKER_TIMEOUT", "message": "Worker did not respond"}'::jsonb,
    completed_at = NOW()
WHERE id = 'run_xxx';
```

### Retry Stuck Steps
```bash
# Re-enqueue step (via API)
curl -X POST http://gateway:8080/v1/runs/<run_id>/steps/<step_id>/retry \
  -H "Authorization: Bearer $API_KEY"
```

## Worker Scaling for Recovery

If workers are overwhelmed:

```bash
# Scale up workers
kubectl scale deployment worker -n ferrumdeck --replicas=10

# Monitor queue drain
watch -n 5 'redis-cli XLEN fd:queue:steps'
```

## Post-Recovery Checklist
- [ ] All workers healthy and processing
- [ ] Queue depth returning to normal
- [ ] No runs stuck in invalid states
- [ ] Alerting confirmed working
- [ ] Root cause documented
- [ ] Preventive measures identified
