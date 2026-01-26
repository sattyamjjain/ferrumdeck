# fd-core

<!-- AUTO-MANAGED: module-description -->
## Purpose

Core primitives shared across all FerrumDeck Rust crates. Provides strongly-typed IDs, error types, configuration loading, and time utilities.

**Role**: Foundation crate with zero business logic - pure utilities and type definitions.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-core/src/
├── lib.rs          # Public exports
├── id.rs           # ULID-based typed IDs with prefixes
├── error.rs        # Common error types (thiserror)
├── config.rs       # Configuration loading (dotenvy + config)
└── time.rs         # Chrono helpers and formatting
```

**Key Exports**:
- `define_id!` macro for creating typed IDs
- `RunId`, `StepId`, `AgentId`, `ToolId`, etc.
- `AppConfig` for environment-based configuration
- `FdError` for common error variants

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### ID Macro Usage
```rust
use fd_core::define_id;

define_id!(MyId, "my");  // Creates MyId type with "my_" prefix
let id = MyId::new();    // my_01HGXK...
```

### Error Types
- Use `thiserror` for library errors
- Re-export common error types from this crate
- Application code can wrap with `anyhow`

### Configuration
- Uses `dotenvy` for `.env` loading
- Uses `config` crate for layered config
- Environment variables override file config

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `ulid` | Time-sortable unique IDs |
| `chrono` | Date/time handling |
| `serde` | Serialization traits |
| `thiserror` | Error derive macros |
| `config` | Configuration management |
| `dotenvy` | Environment file loading |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Usage Examples

### Creating Custom IDs
```rust
use fd_core::define_id;

define_id!(WorkflowId, "wfl");

fn main() {
    let id = WorkflowId::new();
    println!("{}", id);  // wfl_01HGXK3R5N...
}
```

### Loading Configuration
```rust
use fd_core::config::AppConfig;

let config = AppConfig::load()?;
println!("Database: {}", config.database_url);
```

<!-- END MANUAL -->
