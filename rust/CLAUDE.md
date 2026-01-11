# Rust Control Plane

<!-- AUTO-MANAGED: module-description -->
## Purpose

The Rust workspace implements the **Control Plane** for FerrumDeck - the source of truth for governance, orchestration, and audit. It handles API requests, policy enforcement, run orchestration, and data persistence.

**Role**: Stateful control plane that manages agent runs, enforces policies, and maintains audit trails.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
rust/
├── crates/                   # Shared libraries
│   ├── fd-core/              # Core primitives
│   │   ├── id.rs             # ULID-based typed IDs
│   │   ├── config.rs         # Configuration loading
│   │   ├── error.rs          # Error types
│   │   └── time.rs           # Time utilities
│   ├── fd-storage/           # Data layer
│   │   ├── pool.rs           # PostgreSQL connection pool
│   │   ├── queue.rs          # Redis queue client
│   │   ├── models/           # Database models
│   │   └── repos/            # Repository pattern
│   ├── fd-policy/            # Policy engine
│   │   ├── engine.rs         # Policy evaluation
│   │   ├── rules.rs          # Rule definitions
│   │   ├── budget.rs         # Budget tracking
│   │   └── decision.rs       # Decision types
│   ├── fd-registry/          # Version control
│   │   ├── agent.rs          # Agent versioning
│   │   ├── tool.rs           # Tool versioning
│   │   └── version.rs        # Version utilities
│   ├── fd-audit/             # Audit logging
│   │   ├── event.rs          # Audit events
│   │   └── redaction.rs      # PII redaction
│   ├── fd-dag/               # Workflow scheduling
│   │   ├── lib.rs            # DAG types
│   │   └── scheduler.rs      # Step scheduling
│   └── fd-otel/              # Observability
│       ├── setup.rs          # OTEL initialization
│       └── genai.rs          # GenAI semantic conventions
└── services/
    └── gateway/              # HTTP API service
        ├── main.rs           # Entry point
        ├── routes.rs         # Route definitions
        ├── state.rs          # Application state
        ├── handlers/         # Request handlers
        │   ├── runs.rs       # Run management
        │   ├── registry.rs   # Agent/tool registry
        │   ├── workflows.rs  # Workflow operations
        │   ├── approvals.rs  # Approval handling
        │   └── health.rs     # Health checks
        └── middleware/       # Tower middleware
            ├── auth.rs       # API key authentication
            ├── rate_limit.rs # Rate limiting
            └── request_id.rs # Request ID injection
```

**Crate Dependency Graph**:
```
gateway
├── fd-core
├── fd-storage ── fd-core
├── fd-policy ─── fd-core
├── fd-registry ─ fd-core
├── fd-audit ──── fd-core
├── fd-dag ────── fd-core
└── fd-otel
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Crate Structure
- Each crate has `lib.rs` as entry point with public exports
- Use `mod.rs` for submodule organization
- Derive macros: `Debug, Clone, Serialize, Deserialize` as baseline

### ID Macros
```rust
define_id!(RunId, "run");     // Creates strongly-typed ID wrapper
define_id!(StepId, "stp");    // With prefix for string representation
define_id!(AgentId, "agt");   // agt_01HGXK...
```

### Error Handling
```rust
// Library errors with thiserror
#[derive(Debug, thiserror::Error)]
pub enum Error { ... }

// Application errors can use anyhow
anyhow::Result<T>
```

### Database Patterns
```rust
// Compile-time checked queries
sqlx::query_as!(Model, "SELECT * FROM table WHERE id = $1", id)
    .fetch_one(&pool)
    .await?
```

### Async Patterns
```rust
// Use tokio for async runtime
#[tokio::main]
async fn main() { ... }

// Tower middleware for cross-cutting concerns
use tower::ServiceBuilder;
```

### Testing
- Unit tests in same file with `#[cfg(test)]`
- Integration tests require running database
- Use `fake` crate for test data generation
- Run with: `cargo test --workspace`

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `axum` | Web framework (0.8) |
| `tokio` | Async runtime |
| `sqlx` | PostgreSQL with compile-time checks |
| `redis` | Queue and caching |
| `tower` | Middleware framework |
| `tower-http` | HTTP middleware (cors, tracing) |
| `tracing` | Structured logging |
| `opentelemetry` | Distributed tracing |
| `serde` | Serialization |
| `serde_json` | JSON handling |
| `ulid` | Time-sortable IDs |
| `chrono` | Date/time handling |
| `thiserror` | Error derive macros |
| `anyhow` | Application error handling |
| `dotenvy` | Environment configuration |
| `jsonwebtoken` | JWT handling |

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
