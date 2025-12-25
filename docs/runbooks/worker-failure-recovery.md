# Runbook: Worker Failure Recovery

## Overview

Workers process step execution jobs from Redis Streams. This runbook covers recovery procedures when workers fail or become unresponsive.

## Symptoms

- Runs stuck in RUNNING status
- Step queue depth increasing
- Worker pods in CrashLoopBackOff
- LLM/tool calls not completing

## Immediate Actions

### 1. Assess Scope

```bash
# Check worker pod status
kubectl get pods -n ferrumdeck-prod -l app.kubernetes.io/name=worker

# Check queue depth
redis-cli -h redis-prod-master XLEN fd:step_queue

# Check pending messages (claimed but not acked)
redis-cli -h redis-prod-master XPENDING fd:step_queue workers
```

### 2. Check Worker Logs

```bash
# Recent logs from all workers
kubectl logs -n ferrumdeck-prod -l app.kubernetes.io/name=worker --tail=100

# Logs from specific failing worker
kubectl logs -n ferrumdeck-prod <pod-name> --previous
```

### 3. Common Failure Causes

| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| OOMKilled | Memory exhaustion | Increase memory limit |
| CrashLoopBackOff | Code error or config issue | Check logs, rollback |
| Pending | Insufficient resources | Scale nodes or reduce requests |
| LLM timeout | API provider issues | Check provider status, retry |

## Recovery Procedures

### Restart Workers

```bash
# Rolling restart (zero downtime)
kubectl rollout restart deployment/worker -n ferrumdeck-prod

# Force delete stuck pods
kubectl delete pods -n ferrumdeck-prod -l app.kubernetes.io/name=worker --force --grace-period=0
```

### Reclaim Stuck Jobs

If workers crash mid-job, messages become "pending" in Redis. Reclaim them:

```bash
# View pending messages older than 60 seconds
redis-cli -h redis-prod-master XPENDING fd:step_queue workers - + 100

# Claim idle messages (transfers to new consumer)
redis-cli -h redis-prod-master XCLAIM fd:step_queue workers worker-recovery 60000 <message-id>
```

Automated recovery script:

```bash
#!/bin/bash
# recover-stuck-jobs.sh

IDLE_TIME_MS=60000  # 60 seconds

# Get pending message IDs older than threshold
PENDING=$(redis-cli -h redis-prod-master XPENDING fd:step_queue workers - + 1000 | \
  awk -v idle=$IDLE_TIME_MS '$3 > idle {print $1}')

for MSG_ID in $PENDING; do
  echo "Reclaiming $MSG_ID"
  redis-cli -h redis-prod-master XCLAIM fd:step_queue workers recovery $IDLE_TIME_MS $MSG_ID
done
```

### Cancel Stuck Runs

If runs cannot be recovered, cancel them:

```bash
# Via API
curl -X POST https://api.ferrumdeck.com/v1/runs/{run_id}/cancel \
  -H "Authorization: Bearer $API_KEY"

# Direct database update (emergency only)
psql -h postgres-prod -d ferrumdeck -c \
  "UPDATE runs SET status='FAILED', error='Worker recovery - manual cancellation' WHERE id='<run_id>'"
```

### Dead Letter Queue

After multiple retries, move to DLQ:

```bash
# Check DLQ
redis-cli -h redis-prod-master XLEN fd:step_dlq

# View DLQ messages
redis-cli -h redis-prod-master XRANGE fd:step_dlq - + COUNT 10

# Reprocess DLQ message (after fixing issue)
redis-cli -h redis-prod-master XADD fd:step_queue * <field> <value> ...
```

## Scaling for Recovery

If backlog is large:

```bash
# Temporarily scale up workers
kubectl scale deployment worker -n ferrumdeck-prod --replicas=20

# Monitor queue drain
watch "redis-cli -h redis-prod-master XLEN fd:step_queue"

# Scale back down after recovery
kubectl scale deployment worker -n ferrumdeck-prod --replicas=5
```

## Post-Incident

1. **Root Cause Analysis**
   - Review logs and traces from incident period
   - Identify trigger (deploy, load spike, external dependency)

2. **Update Monitoring**
   - Add alerts for symptoms observed
   - Improve dashboards if visibility was lacking

3. **Document**
   - Add to incident log
   - Update this runbook if needed

## Prevention

- Set appropriate resource limits
- Configure liveness/readiness probes
- Implement circuit breakers for external APIs
- Monitor queue depth and alert on growth
- Regular chaos testing

## Related Runbooks

- [Gateway Scaling](gateway-scaling.md)
- [Incident Response](incident-response.md)
