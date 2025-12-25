# Runbook: Incident Response

## Overview

This runbook provides a structured approach to handling production incidents in FerrumDeck.

## Severity Levels

| Level | Description | Response Time | Examples |
|-------|-------------|---------------|----------|
| SEV1 | Complete outage | Immediate | API down, data loss |
| SEV2 | Major degradation | < 15 min | High error rates, slow responses |
| SEV3 | Minor issue | < 1 hour | Single tenant affected, non-critical feature |
| SEV4 | Low impact | < 24 hours | Cosmetic issues, warnings |

## Incident Commander Responsibilities

1. Declare incident and severity
2. Coordinate response team
3. Communicate status updates
4. Make go/no-go decisions
5. Document timeline
6. Initiate post-mortem

## Response Workflow

### 1. Detection & Triage (0-5 min)

```
Alert Received
    ↓
Acknowledge Alert
    ↓
Assess Severity
    ↓
Notify IC (if SEV1/2)
    ↓
Open Incident Channel
```

**Quick Assessment Questions:**
- Is the service responding?
- Are errors isolated or widespread?
- When did symptoms start?
- Any recent deployments?

### 2. Investigation (5-15 min)

**Service Health Check:**
```bash
# API health
curl https://api.ferrumdeck.com/health

# Pod status
kubectl get pods -n ferrumdeck-prod

# Recent events
kubectl get events -n ferrumdeck-prod --sort-by='.lastTimestamp' | tail -20
```

**Log Analysis:**
```bash
# Gateway errors
kubectl logs -n ferrumdeck-prod -l app.kubernetes.io/name=gateway --since=10m | grep -i error

# Worker errors
kubectl logs -n ferrumdeck-prod -l app.kubernetes.io/name=worker --since=10m | grep -i error
```

**Trace Analysis:**
1. Open Jaeger: `https://jaeger.ferrumdeck.internal`
2. Search for error traces in affected timeframe
3. Identify failing component

### 3. Mitigation (15-60 min)

**Common Mitigations:**

| Issue | Mitigation |
|-------|------------|
| OOM/CPU exhaustion | Scale up pods |
| Bad deploy | Rollback to previous version |
| Database issues | Failover to replica |
| External API down | Enable fallback/circuit breaker |
| Traffic spike | Enable rate limiting |

**Rollback Procedure:**
```bash
# Check deployment history
kubectl rollout history deployment/gateway -n ferrumdeck-prod

# Rollback to previous version
kubectl rollout undo deployment/gateway -n ferrumdeck-prod

# Or rollback to specific revision
kubectl rollout undo deployment/gateway -n ferrumdeck-prod --to-revision=5

# Verify
kubectl rollout status deployment/gateway -n ferrumdeck-prod
```

**Circuit Breaker Activation:**
```bash
# Enable maintenance mode
kubectl set env deployment/gateway -n ferrumdeck-prod MAINTENANCE_MODE=true

# Rate limit specific tenant
curl -X POST https://api.ferrumdeck.com/admin/rate-limit \
  -H "Authorization: Bearer $ADMIN_KEY" \
  -d '{"tenant_id": "xxx", "requests_per_minute": 10}'
```

### 4. Resolution & Verification

1. Confirm fix is working:
   ```bash
   # Check error rates
   # Check latency metrics
   # Run smoke tests
   ./scripts/run-evals.sh smoke
   ```

2. Monitor for 30 minutes after fix

3. Gradually restore normal operation:
   - Remove rate limits
   - Disable maintenance mode
   - Scale back emergency resources

### 5. Communication

**Status Page Updates:**
```
[Investigating] We're investigating reports of API errors.
[Identified] We've identified the cause and are implementing a fix.
[Monitoring] A fix has been deployed. We're monitoring the situation.
[Resolved] The incident has been resolved. Services are operating normally.
```

**Internal Updates (every 30 min for SEV1/2):**
- Current status
- Actions taken
- ETA for resolution
- Owner/contact

## Post-Incident

### Immediate (within 24 hours)
1. Update incident timeline
2. Document root cause
3. List immediate follow-up actions

### Post-Mortem (within 5 days)
1. Schedule blameless review
2. Write post-mortem document:
   - Summary
   - Timeline
   - Root cause
   - Impact
   - What worked
   - What didn't
   - Action items with owners

### Action Items
Track in issue tracker with:
- Clear description
- Owner
- Due date
- Priority

## Emergency Contacts

| Role | Contact | Escalation |
|------|---------|------------|
| Primary On-Call | PagerDuty | Automatic |
| Secondary On-Call | PagerDuty | After 15 min |
| Engineering Lead | Slack @eng-lead | SEV1/2 |
| Platform Owner | Slack @platform | SEV1 |

## Related Runbooks

- [Gateway Scaling](gateway-scaling.md)
- [Worker Failure Recovery](worker-failure-recovery.md)
- [Database Migration](database-migration.md)
