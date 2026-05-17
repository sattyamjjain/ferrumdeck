# FerrumDeck Helm Chart

Production deployment for FerrumDeck: Rust gateway (control plane), Python worker (data plane), Next.js dashboard, plus optional bundled Postgres (pgvector) and Redis.

The existing Kustomize manifests at `deploy/k8s/` are retained for parity — this chart mirrors their config, it does not replace them.

## Quick start

```bash
# Pull bundled deps (Bitnami postgresql + redis)
helm dependency update deploy/helm/ferrumdeck

# Install — bundled Postgres + Redis, good for demos
helm install ferrumdeck deploy/helm/ferrumdeck \
  --namespace ferrumdeck --create-namespace \
  --set secrets.data.anthropicApiKey=sk-ant-...

# Port-forward the gateway
kubectl -n ferrumdeck port-forward svc/ferrumdeck-gateway 8080:8080
curl http://localhost:8080/health

# Run the release tests
helm test ferrumdeck -n ferrumdeck
```

## Production checklist

Bundled Postgres/Redis are demo-grade. For production, point at managed services and inject secrets externally.

- **Postgres** — disable the bundled instance and point at a managed Postgres with pgvector ≥ 0.7:
  ```yaml
  postgresql:
    enabled: false
  secrets:
    data:
      databaseUrl: postgres://user:pass@managed-host:5432/ferrumdeck?sslmode=require
  ```
- **Redis** — disable bundled and point at managed Redis (Streams support required):
  ```yaml
  redis:
    enabled: false
  secrets:
    data:
      redisUrl: redis://:pass@managed-host:6379
  ```
- **TLS** — enable Ingress with cert-manager:
  ```yaml
  ingress:
    enabled: true
    className: nginx
    annotations:
      cert-manager.io/cluster-issuer: letsencrypt-prod
    hosts:
      - host: api.ferrumdeck.example.com
        paths: [{path: /, pathType: Prefix, service: gateway}]
    tls:
      - hosts: [api.ferrumdeck.example.com]
        secretName: gateway-tls
  ```
- **Secrets manager** — set `secrets.create=false` and reference an externally-managed Secret (AWS Secrets Manager via External Secrets Operator, GCP Secret Manager, sealed-secrets):
  ```yaml
  secrets:
    create: false
    existingSecret: ferrumdeck-prod-secrets   # populated by ESO / SealedSecret
  ```

## Values

See `values.yaml` — the most common overrides:

| Key | Default | Notes |
| --- | --- | --- |
| `gateway.replicaCount` | `2` | Match the Kustomize default |
| `worker.replicaCount` | `3` | |
| `dashboard.enabled` | `true` | Set false if you ship the dashboard separately |
| `postgresql.enabled` | `true` | Disable in prod, use managed Postgres |
| `redis.enabled` | `true` | Disable in prod, use managed Redis |
| `ingress.enabled` | `false` | Enable for external traffic |
| `secrets.create` | `true` | Disable when using an external secrets manager |

## Validating changes locally

```bash
helm dependency update deploy/helm/ferrumdeck
helm lint deploy/helm/ferrumdeck
helm template ferrumdeck deploy/helm/ferrumdeck --debug | less
```

CI runs `helm lint` and `helm template | kubeconform` on every PR touching `deploy/helm/**` — see `.github/workflows/helm-lint.yml`.
