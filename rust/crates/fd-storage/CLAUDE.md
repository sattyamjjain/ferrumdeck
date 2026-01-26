# fd-storage

<!-- AUTO-MANAGED: module-description -->
## Purpose

Data layer for FerrumDeck providing PostgreSQL repositories and Redis queue integration. Implements the repository pattern with compile-time checked SQL queries.

**Role**: Persistence abstraction - all database access flows through this crate.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-storage/src/
├── lib.rs              # Public exports
├── queue.rs            # Redis queue client (XADD/XREAD)
├── models/             # Database models (SQLx FromRow)
│   ├── mod.rs
│   ├── runs.rs         # Run state model
│   ├── steps.rs        # Step state model
│   ├── agents.rs       # Agent registry model
│   ├── tools.rs        # Tool registry model
│   ├── policies.rs     # Policy configuration
│   ├── quotas.rs       # Budget/quota tracking
│   ├── audit.rs        # Audit log entries
│   ├── threats.rs      # Airlock threat records
│   ├── workflows.rs    # Workflow definitions
│   └── api_keys.rs     # API key storage
└── repos/              # Repository implementations
    ├── mod.rs
    ├── runs.rs         # RunRepository
    ├── steps.rs        # StepRepository
    ├── agents.rs       # AgentRepository
    ├── tools.rs        # ToolRepository
    ├── policies.rs     # PolicyRepository
    ├── quotas.rs       # QuotaRepository
    ├── audit.rs        # AuditRepository
    ├── threats.rs      # ThreatRepository
    └── workflows.rs    # WorkflowRepository
```

**Data Flow**:
```
Gateway Handler → Repository → SQLx Query → PostgreSQL
                            → Redis Queue → Worker
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Repository Pattern
```rust
pub struct RunRepository {
    pool: PgPool,
}

impl RunRepository {
    pub async fn find_by_id(&self, id: RunId) -> Result<Option<Run>> {
        sqlx::query_as!(Run, "SELECT * FROM runs WHERE id = $1", id.as_ref())
            .fetch_optional(&self.pool)
            .await
            .map_err(Into::into)
    }
}
```

### Queue Operations
```rust
// Enqueue step for worker
queue.push_step(step_id, job_data).await?;

// Consumer reads with XREAD (blocking)
let jobs = queue.read_pending(count).await?;
```

### Model Conventions
- Use `#[derive(sqlx::FromRow)]` for database models
- Use `Option<T>` for nullable columns
- Use `rust_decimal::Decimal` for money/budget fields

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `sqlx` | PostgreSQL with compile-time checks |
| `redis` | Redis streams for queue |
| `rust_decimal` | Decimal precision for budgets |
| `fd-core` | Typed IDs and errors |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Database Schema

Tables are created via migrations in `db/migrations/`. Key tables:
- `runs` - Agent run state
- `steps` - Individual step execution
- `agents` / `agent_versions` - Agent registry
- `tools` - Tool definitions
- `policies` - Policy configurations
- `audit_events` - Immutable audit trail
- `threats` - Airlock security events

## Redis Queue Keys
- `fd:steps:pending` - Steps awaiting execution (XSTREAM)
- `fd:steps:processing` - Currently processing (for ack tracking)

<!-- END MANUAL -->
