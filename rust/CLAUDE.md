# Rust Control Plane

<!-- AUTO-MANAGED: module-description -->
## Purpose

The enforcement engine and control plane. Every agent tool call is decided here before it runs: policy evaluation,
Airlock RASP inspection, budget and payment gates, reversibility classification, and a hash-chained audit record.
The gateway exposes this over HTTP; the Python data plane calls into it rather than deciding anything itself.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

Cargo workspace is rooted at the **repo root** `Cargo.toml` (members `rust/crates/*`, `rust/services/*`), not at `rust/`.

```
rust/
├── crates/
│   ├── ferrumdeck/      # Umbrella crate; re-exports fd_policy, `audit` feature adds fd_audit
│   ├── fd-core/         # id.rs (define_id! ULID types), config.rs, error.rs, time.rs
│   ├── fd-policy/       # engine.rs, decision.rs, rules.rs, precedence.rs, trace.rs
│   │   ├── airlock/     # inspector.rs + behavioral_drift, schema_drift, patterns,
│   │   │                #   velocity, exfiltration, credential_dlp, coherence, config
│   │   ├── budget.rs · lease.rs · forecast.rs      # spend caps, leases, projection
│   │   ├── ap2.rs · x402.rs                        # signed mandates, pre-call spend gate
│   │   ├── reversibility.rs                        # R1–R3 ladder
│   │   ├── transparency_art50.rs · colorado_sb26_189.rs   # regulatory rules
│   │   ├── harness.rs · promotion.rs · routing.rs · bench_audit.rs
│   │   └── benches/     # enforcement_latency (criterion)
│   ├── fd-storage/      # pool.rs, queue.rs (Redis streams), migrations.rs, retention.rs,
│   │                    #   repos/, models/
│   ├── fd-audit/        # chain.rs (hash chain), checkpoint.rs (external anchoring),
│   │                    #   event.rs, redaction.rs
│   ├── fd-registry/     # agent.rs, tool.rs, version.rs
│   ├── fd-dag/          # scheduler.rs
│   └── fd-otel/         # setup.rs, genai.rs, decision.rs, cost_decomposition.rs,
│                        #   firing_rate.rs, claim_grounding.rs, trace_context.rs
└── services/gateway/src/
    ├── main.rs · routes.rs · state.rs · openapi.rs (utoipa)
    ├── handlers/        # runs, approvals, policies, registry, evals, security, workflows,
    │                    #   orchestrator, promotions, harness_suggestions, training_signal,
    │                    #   api_keys, health, tests
    └── middleware/      # auth, oauth2, rate_limit, request_id
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

- Edition 2021. Workspace declares `rust-version = "1.80"`, but the dependency graph needs ≥1.88 and Docker images build on rust 1.90 — treat 1.88 as the practical floor.
- All shared dependency versions live in the root `[workspace.dependencies]`; crates reference them with `.workspace = true`. Do not pin versions inside a crate's `Cargo.toml`.
- **Publish names differ from directory names**: Published crates rename on crates.io — `fd-core` → `ferrumdeck-core`, `fd-policy` → `ferrumdeck-policy`, `fd-audit` → `ferrumdeck-audit`, `fd-otel` → `ferrumdeck-otel`, `fd-dag` → `ferrumdeck-dag` — while lib/import paths stay `fd_core`, `fd_policy`, `fd_audit`, `fd_otel`, `fd_dag`. The publishable set is declared by the *absence* of `publish = false` in each crate's `Cargo.toml`; `fd-storage`, `fd-registry` and the gateway carry it and are never published. `scripts/check_published_versions.py` (`make check-published-versions`, and a step in the release workflow) asserts every publishable crate is both wired into the publish walk and live on crates.io at the workspace version — added after `ferrumdeck-otel` drifted five releases behind and `ferrumdeck-dag` then drifted six, because the walk's failure mode was silence. When adding a path dependency on a published crate, include both `version` and `package`. That `version` must equal the workspace version and is rewritten by `scripts/bump_version.py` — never hand-edit it. A stale pin still builds (the caret range is satisfied by any later 0.8.x) but ships a requirement letting a consumer resolve an old sibling; `internal_pins_track_workspace_version` in `rust/crates/ferrumdeck/tests/` is the gate.
- IDs are ULID-based and strongly typed via `define_id!` in fd-core; prefixes (`run_`, `stp_`, `agt_`) are part of the type.
- Errors: `thiserror` inside crates, `anyhow` in the gateway binary.
- SQLx queries are compile-time checked — run `cargo sqlx prepare --workspace` after changing SQL, or build with `SQLX_OFFLINE=true`.
- Airlock layers run cheapest-signal-first and are numbered from −1 in `inspector.rs`; keep that ordering when adding a layer.
- Lint gate is `cargo clippy --workspace --all-targets -- -D warnings`; format with default rustfmt.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Area | Crate |
|---|---|
| Async runtime | `tokio` (full features) |
| HTTP | `axum` 0.8, `tower`, `tower-http` (cors, trace, request-id, timeout, set-header) |
| Database | `sqlx` (runtime-tokio, postgres, uuid, chrono, json, migrate, rust_decimal) |
| Queue | `redis` (tokio-comp, streams) |
| Serialization | `serde`, `serde_json` |
| IDs / time | `ulid`, `uuid` (v7), `chrono` |
| Errors | `thiserror`, `anyhow` |
| Config | `config`, `dotenvy` |
| Tracing | `tracing`, `tracing-subscriber`, `tracing-opentelemetry`, `opentelemetry{,_sdk,-otlp}` |
| Crypto | `sha2`, `hmac`, `subtle`, `hex`, `ed25519-dalek` (AP2 mandate chains, RFC 8032) |
| Auth | `jsonwebtoken`, `base64` |
| HTTP client | `reqwest` (json, rustls-tls) |
| Bench | `criterion` (enforcement_latency) |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Testing Patterns

### Unit Tests
```rust
// Place in same file with module
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_prefix() {
        let id = RunId::new();
        assert!(id.to_string().starts_with("run_"));
    }

    #[tokio::test]
    async fn test_async_function() {
        // Use tokio::test for async tests
    }
}
```

### Integration Tests
```bash
# Requires running PostgreSQL and Redis
make dev-up
cargo test --workspace --test '*'
```

### Test Data Generation
```rust
use fake::{Fake, Faker};

let name: String = Faker.fake();
let email: String = fake::faker::internet::en::SafeEmail().fake();
```

### Test Databases
- Integration tests use a separate test database
- Tests should clean up after themselves
- Use transactions for test isolation when possible

## Database Migrations

### Location
Migrations are in `db/migrations/` with timestamp prefixes:
```
db/migrations/
├── 20240101000000_init.sql
├── 20240115000000_add_tenants.sql
└── 20240201000000_add_audit.sql
```

### Auto-Run Behavior
- Gateway automatically runs migrations on startup
- Uses SQLx migration tracking (`_sqlx_migrations` table)
- Never run migrations manually in CI (gateway handles it)

### Creating New Migrations
```bash
# Create a new migration file
sqlx migrate add <name>

# Or manually create with timestamp:
# db/migrations/YYYYMMDDHHMMSS_description.sql
```

### Migration Best Practices
- Always use `IF NOT EXISTS` for tables
- Add `IF NOT EXISTS` for indexes
- Use transactions for data migrations
- Test migrations against a copy of prod data

## Adding a New Crate

1. Create the crate directory:
   ```bash
   mkdir -p rust/crates/fd-newcrate/src
   ```

2. Create `Cargo.toml`:
   ```toml
   [package]
   name = "fd-newcrate"
   version.workspace = true
   edition.workspace = true

   [dependencies]
   fd-core = { path = "../fd-core" }
   ```

3. Create `src/lib.rs`:
   ```rust
   //! Brief description of the crate
   pub mod module;
   ```

4. Add to workspace in root `Cargo.toml`:
   ```toml
   [workspace]
   members = [
       "rust/crates/fd-newcrate",
       # ...
   ]
   ```

## Debugging

### Enable Debug Logging
```bash
RUST_LOG=debug cargo run -p gateway
RUST_LOG=gateway=debug,fd_storage=trace cargo run -p gateway
```

### Database Query Logging
```bash
RUST_LOG=sqlx=debug cargo run -p gateway
```

### OpenTelemetry Traces
```bash
# View traces in Jaeger
open http://localhost:16686
```

### Common Issues

**SQLx Compile Errors**
```bash
# Regenerate query cache
cargo sqlx prepare --workspace

# Or set offline mode
SQLX_OFFLINE=true cargo build
```

**Connection Pool Exhausted**
- Check max_connections in config
- Look for queries not releasing connections
- Use `pool.acquire()` with timeout

<!-- END MANUAL -->
