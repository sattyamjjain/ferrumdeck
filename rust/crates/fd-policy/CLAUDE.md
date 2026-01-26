# fd-policy

<!-- AUTO-MANAGED: module-description -->
## Purpose

Policy engine for FerrumDeck implementing deny-by-default tool governance. Includes Airlock RASP (Runtime Application Self-Protection) for security inspection of tool calls.

**Role**: Security boundary - all tool calls must pass policy checks and Airlock inspection.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-policy/src/
├── lib.rs              # Public exports
├── engine.rs           # Main policy engine
├── rules.rs            # Rule definitions and matching
├── budget.rs           # Budget tracking and enforcement
├── decision.rs         # Allow/Deny/Require decision types
└── airlock/            # Runtime security (RASP)
    ├── mod.rs          # Airlock module exports
    ├── config.rs       # Airlock configuration (modes)
    ├── inspector.rs    # Main inspection orchestrator
    ├── patterns.rs     # Anti-RCE pattern matching
    ├── velocity.rs     # Financial circuit breaker
    └── exfiltration.rs # Data exfiltration prevention
```

**Policy Decision Flow**:
```
Tool Request → Policy Engine → Rule Matching
                            → Budget Check
                            → Airlock Inspection
                                ├── Anti-RCE Check
                                ├── Velocity Check
                                └── Exfil Check
                            → Decision (Allow/Deny/Approval)
```

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Policy Decisions
```rust
pub enum Decision {
    Allow,
    Deny { reason: String },
    RequireApproval { reason: String },
}
```

### Airlock Modes
```rust
pub enum AirlockMode {
    Shadow,   // Log violations, don't block
    Enforce,  // Block violations
}
```

### Security Patterns
- Patterns are regex-based for flexibility
- False positives in shadow mode help tuning
- All violations are logged to audit trail

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `regex` | Pattern matching for security rules |
| `tokio` | Async support for inspection |
| `fd-core` | Typed IDs and errors |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Airlock Security Layers

### 1. Anti-RCE Pattern Matcher
Detects dangerous patterns in tool arguments:
- `eval()`, `exec()`, `os.system()`
- Shell metacharacters in commands
- Code injection patterns

### 2. Financial Circuit Breaker
Prevents runaway spending:
- Per-run budget limits
- Velocity checks (spending rate)
- Loop detection (repeated tool calls)

### 3. Data Exfiltration Shield
Blocks data leaks:
- Domain whitelist enforcement
- Blocks raw IP addresses
- Prevents C2 (command & control) patterns

## Configuration Example
```rust
let airlock = AirlockConfig {
    mode: AirlockMode::Enforce,
    max_spend_per_minute: Decimal::new(100, 2), // $1.00
    allowed_domains: vec!["api.github.com".into()],
};
```

<!-- END MANUAL -->
