# ADR-0003: Deny-by-Default Tool Access

## Status
Accepted

## Context
AI agents can potentially call any tool available in the system. We need a policy model that ensures safety while enabling useful automation.

Key concerns:
- Agents may be instructed to perform harmful actions
- Tool combinations can have unexpected effects
- Different environments need different permissions
- Audit requirements for compliance

## Decision
We adopt a **deny-by-default** policy for tool access.

### Policy Model
```
1. All tools are DENIED unless explicitly allowed
2. Allowed tools are specified per agent version
3. Some tools may require human APPROVAL before execution
4. Explicit DENY rules override ALLOW rules
```

### Policy Hierarchy
```
Global Defaults
    ↓
Project Policies
    ↓
Agent Version Config
    ↓
Runtime Overrides (via API)
```

### Tool Risk Levels
| Level | Description | Default Policy |
|-------|-------------|----------------|
| `read` | Read-only operations | Allow if in allowlist |
| `write` | Modifies state | Require approval |
| `destructive` | Cannot be undone | Deny by default |

### Allowlist Configuration
```yaml
agent_versions:
  allowed_tools:
    - read_file        # Read risk
    - list_directory   # Read risk
    - write_file       # Write risk - requires approval
  tool_configs:
    write_file:
      require_approval: true
      max_file_size: 1MB
```

### Policy Decision Flow
```
Tool Call Request
       ↓
Is tool in denied_tools? → YES → DENY
       ↓ NO
Is tool in allowed_tools? → NO → DENY
       ↓ YES
Is approval required? → YES → AWAIT_APPROVAL
       ↓ NO
       → ALLOW
```

## Consequences

### Positive
- Secure by default - new tools are blocked until reviewed
- Explicit audit trail of all policy decisions
- Granular control per agent/project
- Supports compliance requirements (SOC2, etc.)

### Negative
- Initial setup requires explicit allowlisting
- May frustrate developers during prototyping
- Approval workflows add latency

### Mitigations
- Provide "development mode" with relaxed policies (not for production)
- Good defaults for common safe tools
- Async approval via webhooks/Slack

## Implementation

### Database Schema
```sql
CREATE TABLE policy_rules (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id),
    conditions JSONB NOT NULL,
    effect policy_effect NOT NULL  -- allow/deny/require_approval
);
```

### API
```http
GET  /v1/policies           # List policies
POST /v1/policies           # Create policy
GET  /v1/policies/{id}      # Get policy
PUT  /v1/policies/{id}      # Update policy
DELETE /v1/policies/{id}    # Delete policy
```

## Alternatives Considered

### Allow-by-Default
- Easier development experience
- Rejected: Unacceptable security risk for production

### Capability-Based Security
- More flexible
- Rejected: Higher complexity, harder to audit

### Role-Based Access Control
- Standard enterprise pattern
- Rejected: Tools aren't users; capability model fits better

## References
- [OWASP LLM Top 10](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [Principle of Least Privilege](https://en.wikipedia.org/wiki/Principle_of_least_privilege)
