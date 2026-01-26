# fd-audit

<!-- AUTO-MANAGED: module-description -->
## Purpose

Audit logging for FerrumDeck providing an append-only event trail. Supports automatic PII redaction and structured event recording for compliance.

**Role**: Compliance and observability - every significant action is recorded immutably.

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: architecture -->
## Module Architecture

```
fd-audit/src/
├── lib.rs          # Public exports
├── event.rs        # Audit event types and builders
└── redaction.rs    # PII detection and redaction
```

**Event Types**:
- `RunStarted` / `RunCompleted` / `RunFailed`
- `StepExecuted` / `StepFailed`
- `ToolInvoked` / `ToolDenied`
- `ApprovalRequested` / `ApprovalGranted` / `ApprovalDenied`
- `PolicyViolation` / `AirlockThreat`
- `BudgetExceeded`

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: conventions -->
## Module-Specific Conventions

### Event Building
```rust
let event = AuditEvent::builder()
    .run_id(run_id)
    .event_type(EventType::ToolInvoked)
    .tool_name("github.create_pr")
    .details(json!({ "repo": "org/repo" }))
    .build();
```

### Redaction Rules
- API keys: `sk-***`, `ghp_***`
- Emails: Hashed or masked
- Credit cards: Last 4 digits only
- Custom patterns via regex

### Immutability
- Events are insert-only (no UPDATE/DELETE)
- Timestamps are server-generated
- Hash chain for tamper detection (optional)

<!-- END AUTO-MANAGED -->

<!-- AUTO-MANAGED: dependencies -->
## Key Dependencies

| Crate | Purpose |
|-------|---------|
| `regex` | PII pattern detection |
| `chrono` | Timestamp handling |
| `serde_json` | Event detail serialization |
| `fd-core` | Typed IDs |

<!-- END AUTO-MANAGED -->

<!-- MANUAL -->
## Usage Example

```rust
use fd_audit::{AuditEvent, EventType, Redactor};

// Create redactor with patterns
let redactor = Redactor::default();

// Record event with auto-redaction
let event = AuditEvent::new(EventType::ToolInvoked)
    .with_run_id(run_id)
    .with_details(&redactor.redact(tool_args));

audit_repo.insert(event).await?;
```

## Querying Audit Trail

Events are stored in `audit_events` table:
```sql
SELECT * FROM audit_events
WHERE run_id = $1
ORDER BY created_at;
```

<!-- END MANUAL -->
