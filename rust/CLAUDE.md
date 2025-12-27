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

### Testing
- Unit tests in same file with `#[cfg(test)]`
- Integration tests require running database
- Use `fake` crate for test data generation

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
| `tracing` | Structured logging |
| `opentelemetry` | Distributed tracing |
| `serde` | Serialization |
| `ulid` | Time-sortable IDs |
| `thiserror` | Error derive macros |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Notes

<!-- END MANUAL -->
