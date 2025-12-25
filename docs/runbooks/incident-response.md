# Runbook: Incident Response

## Overview
This runbook provides structured incident response procedures for FerrumDeck platform issues.

## Severity Levels

| Level | Definition | Response Time | Examples |
|-------|------------|---------------|----------|
| SEV1 | Complete outage | 15 min | API unreachable, data loss |
| SEV2 | Major degradation | 30 min | High error rate, slow responses |
| SEV3 | Minor degradation | 2 hours | Single feature broken |
| SEV4 | Low impact | 24 hours | UI bugs, minor issues |

## Incident Commander Responsibilities
1. Coordinate response efforts
2. Communicate status updates
3. Make escalation decisions
4. Document timeline
5. Declare incident resolved

## Initial Response (First 15 Minutes)

### 1. Acknowledge Alert
```bash
# Silence alert (PagerDuty/OpsGenie)
pd incident acknowledge <incident-id>
```

### 2. Assess Impact
```bash
# Check service health
curl https://api.ferrumdeck.com/health

# Check error rates (Grafana/Prometheus)
# Dashboard: FerrumDeck Overview
```

### 3. Determine Severity
- How many users affected?
- Is data being lost?
- Are runs failing?
- Is the API accessible?

### 4. Notify Stakeholders
```
Template:
[SEV-X] FerrumDeck Incident - <Brief Description>
Impact: <What's broken>
Status: Investigating
ETA: TBD
```

## Diagnostic Commands

### Gateway Health
```bash
# Kubernetes
kubectl get pods -n ferrumdeck
kubectl describe pod gateway-xxx -n ferrumdeck
kubectl logs gateway-xxx -n ferrumdeck --tail=100

# Direct
curl http://gateway:8080/health
curl http://gateway:8080/ready
```

### Database Health
```bash
# Check connections
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity;"

# Check slow queries
psql $DATABASE_URL -c "SELECT pid, now() - pg_stat_activity.query_start AS duration, query
FROM pg_stat_activity
WHERE state = 'active' AND now() - pg_stat_activity.query_start > interval '30 seconds';"
```

### Redis Health
```bash
redis-cli -h redis-host INFO replication
redis-cli -h redis-host XLEN fd:queue:steps
```

### Worker Health
```bash
kubectl get pods -l app=worker -n ferrumdeck
kubectl logs -l app=worker -n ferrumdeck --tail=50
```

## Common Issues & Fixes

### API 503 (Service Unavailable)
**Cause:** Gateway can't reach database or Redis

**Fix:**
```bash
# Check database
kubectl get pods -l app=postgres -n ferrumdeck

# Check Redis
kubectl get pods -l app=redis -n ferrumdeck

# Restart gateway if dependencies healthy
kubectl rollout restart deployment gateway -n ferrumdeck
```

### High Latency
**Cause:** Database slow queries, overloaded workers

**Fix:**
```bash
# Check for slow queries
psql $DATABASE_URL -c "SELECT * FROM pg_stat_statements ORDER BY total_time DESC LIMIT 5;"

# Scale workers if queue backed up
kubectl scale deployment worker --replicas=10 -n ferrumdeck
```

### Runs Stuck in "Running"
**Cause:** Worker crash, network partition

**Fix:**
```bash
# Check worker logs
kubectl logs -l app=worker -n ferrumdeck | grep ERROR

# Reclaim stuck messages
redis-cli XAUTOCLAIM fd:queue:steps workers recovery 300000 0-0

# Fail stuck runs manually if needed
psql $DATABASE_URL -c "
UPDATE runs SET status = 'failed', error = '{\"code\": \"INCIDENT_RECOVERY\"}'
WHERE status = 'running' AND started_at < NOW() - INTERVAL '1 hour';"
```

### Policy Blocking Everything
**Cause:** Misconfigured policy rules

**Fix:**
```bash
# Check recent policy changes
psql $DATABASE_URL -c "
SELECT * FROM policy_rules
WHERE updated_at > NOW() - INTERVAL '1 hour'
ORDER BY updated_at DESC;"

# Temporarily disable problematic rule
psql $DATABASE_URL -c "
UPDATE policy_rules SET enabled = false WHERE id = 'pol_xxx';"
```

## Escalation Path

```
Level 1: On-call Engineer
    ↓ (15 min no progress)
Level 2: Senior Engineer + Team Lead
    ↓ (30 min no progress)
Level 3: Engineering Manager + Incident Commander
    ↓ (SEV1 or data loss)
Level 4: VP Engineering + Executive Team
```

## Communication Templates

### Status Update
```
[SEV-X] FerrumDeck Incident Update
Time: HH:MM UTC
Status: Investigating / Identified / Fixing / Monitoring / Resolved
Impact: <current impact>
Summary: <what we know>
Next Update: HH:MM UTC
```

### Resolution Notice
```
[RESOLVED] FerrumDeck Incident
Duration: X hours Y minutes
Root Cause: <brief explanation>
Resolution: <what fixed it>
Follow-up: <post-mortem scheduled, preventive actions>
```

## Post-Incident

### Immediate (Within 24 Hours)
- [ ] Incident documented in system
- [ ] Stakeholders notified of resolution
- [ ] Monitoring verified working
- [ ] Quick fixes validated

### Within 1 Week
- [ ] Post-mortem scheduled
- [ ] Timeline documented
- [ ] Root cause analysis complete
- [ ] Action items identified
- [ ] Prevention measures planned

### Post-Mortem Template
```markdown
# Incident Post-Mortem: <Title>

## Summary
- **Date:** YYYY-MM-DD
- **Duration:** X hours
- **Severity:** SEV-X
- **Impact:** <users/runs affected>

## Timeline
- HH:MM - <event>
- HH:MM - <event>

## Root Cause
<detailed explanation>

## Resolution
<what fixed it>

## Action Items
- [ ] <preventive measure 1>
- [ ] <preventive measure 2>

## Lessons Learned
<what we learned>
```
