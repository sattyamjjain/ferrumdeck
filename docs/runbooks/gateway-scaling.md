# Runbook: Gateway Scaling

## Overview
This runbook covers horizontal scaling of the FerrumDeck Gateway service.

## Prerequisites
- Access to Kubernetes cluster or Docker Swarm
- Monitoring dashboards (Grafana/Prometheus)
- Database connection pool headroom

## Scaling Indicators

### Scale Up When
| Metric | Threshold | Action |
|--------|-----------|--------|
| Request latency p99 | > 500ms | Add 1 replica |
| CPU utilization | > 70% sustained 5min | Add 1 replica |
| Error rate 5xx | > 1% | Investigate, then scale |
| Request queue depth | > 100 | Add 1 replica |

### Scale Down When
| Metric | Threshold | Action |
|--------|-----------|--------|
| CPU utilization | < 30% sustained 15min | Remove 1 replica |
| Request rate | < 10 req/s per instance | Remove 1 replica |

## Scaling Procedures

### Kubernetes
```bash
# Check current replicas
kubectl get deployment gateway -n ferrumdeck

# Scale up
kubectl scale deployment gateway -n ferrumdeck --replicas=5

# Scale with HPA (recommended)
kubectl autoscale deployment gateway -n ferrumdeck \
  --min=2 --max=10 --cpu-percent=70
```

### Docker Compose
```bash
# Scale to 5 instances
docker compose up -d --scale gateway=5

# Verify health
docker compose ps
```

## Connection Pool Sizing

Each gateway instance uses database connections:
- **Default pool size**: 20 connections
- **Min connections**: 5

### Formula
```
max_connections = gateway_replicas * pool_size + buffer
                = 5 * 20 + 20
                = 120 connections
```

Ensure PostgreSQL `max_connections` accommodates this.

## Health Checks

### Liveness
```bash
curl http://gateway:8080/health
# Expected: 200 OK
```

### Readiness
```bash
curl http://gateway:8080/ready
# Expected: 200 OK (only when DB + Redis connected)
```

## Rollback Procedure
If new instances are unhealthy:

```bash
# Kubernetes
kubectl rollout undo deployment gateway -n ferrumdeck

# Docker
docker compose up -d --scale gateway=2
```

## Monitoring Queries

### Prometheus
```promql
# Request rate per instance
rate(http_requests_total{service="gateway"}[5m])

# P99 latency
histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{service="gateway"}[5m]))

# Error rate
rate(http_requests_total{service="gateway",status=~"5.."}[5m])
/ rate(http_requests_total{service="gateway"}[5m])
```

## Post-Scaling Checklist
- [ ] Verify all instances healthy in load balancer
- [ ] Check database connection pool utilization
- [ ] Monitor Redis connection count
- [ ] Verify request distribution is even
- [ ] Alert thresholds still appropriate
