# Runbook: Gateway Scaling

## Overview

The Gateway service handles all API requests and orchestrates run execution. This runbook covers scaling procedures for various scenarios.

## Metrics to Monitor

| Metric | Threshold | Action |
|--------|-----------|--------|
| CPU utilization | > 70% for 5min | Scale up |
| Memory utilization | > 75% for 5min | Scale up |
| Request latency p99 | > 500ms | Scale up |
| Error rate | > 1% | Investigate, possibly scale |
| Request queue depth | > 100 | Scale up |

## Horizontal Scaling

### Kubernetes (Automatic via HPA)

The HPA handles automatic scaling. Check current status:

```bash
kubectl get hpa gateway-hpa -n ferrumdeck-prod
kubectl describe hpa gateway-hpa -n ferrumdeck-prod
```

### Manual Scaling

If HPA is insufficient or disabled:

```bash
# Scale to specific replica count
kubectl scale deployment gateway -n ferrumdeck-prod --replicas=10

# Verify pods are ready
kubectl get pods -n ferrumdeck-prod -l app.kubernetes.io/name=gateway
```

### Docker Compose

```bash
# Scale gateway service
docker compose up -d --scale gateway=5
```

## Vertical Scaling

If horizontal scaling doesn't help (e.g., memory pressure):

1. Update resource limits in overlay:
   ```yaml
   # deploy/k8s/overlays/production/kustomization.yaml
   - op: replace
     path: /spec/template/spec/containers/0/resources
     value:
       limits:
         cpu: 4000m
         memory: 4Gi
   ```

2. Apply and trigger rolling update:
   ```bash
   kubectl apply -k deploy/k8s/overlays/production
   ```

## Pre-Scaling Checklist

Before scaling up, verify:

- [ ] PostgreSQL connection pool has headroom (max_connections)
- [ ] Redis has sufficient memory for more connections
- [ ] Load balancer health checks are passing
- [ ] No ongoing deployment or incident

## Post-Scaling Verification

After scaling:

1. Check all pods healthy:
   ```bash
   kubectl get pods -n ferrumdeck-prod -l app.kubernetes.io/name=gateway
   ```

2. Verify load distribution:
   ```bash
   # Check request distribution in Grafana or:
   kubectl logs -n ferrumdeck-prod -l app.kubernetes.io/name=gateway --tail=10
   ```

3. Monitor for 10 minutes:
   - Error rate should decrease or stay stable
   - Latency should improve
   - No pod restarts

## Scaling Down

Scale down gradually during low-traffic periods:

1. Set HPA minReplicas lower:
   ```bash
   kubectl patch hpa gateway-hpa -n ferrumdeck-prod \
     --patch '{"spec":{"minReplicas":2}}'
   ```

2. Allow HPA to scale down naturally (wait stabilization period)

3. Never scale below minAvailable in PDB (2 for gateway)

## Troubleshooting

### Pods not scaling up
- Check HPA events: `kubectl describe hpa gateway-hpa`
- Check metrics-server: `kubectl top pods -n ferrumdeck-prod`
- Check node capacity: `kubectl describe nodes | grep -A5 "Allocated resources"`

### Pods failing to start
- Check events: `kubectl get events -n ferrumdeck-prod --sort-by='.lastTimestamp'`
- Check logs: `kubectl logs -n ferrumdeck-prod <pod-name> --previous`

### Performance not improving after scale
- Check database connection pool saturation
- Check Redis memory/CPU
- Profile application for bottlenecks

## Related Runbooks

- [Worker Failure Recovery](worker-failure-recovery.md)
- [Database Migration](database-migration.md)
- [Incident Response](incident-response.md)
