# ADR 0003: Deny-by-Default Tool Policy

## Status

Accepted

## Date

2024-12-26

## Context

AI agents in FerrumDeck can execute arbitrary tools via MCP (Model Context Protocol). This creates significant security risks:

1. **Data exfiltration**: Agent could read sensitive files and send to external endpoints
2. **System compromise**: Agent could execute destructive commands
3. **Privilege escalation**: Agent could modify security configurations
4. **Resource abuse**: Agent could consume excessive compute/network resources

We need a security model that:
- Prevents unauthorized tool access by default
- Allows operators to explicitly grant tool permissions
- Supports approval workflows for high-risk operations
- Provides audit trail of all tool executions

## Decision

We implement a **Deny-by-Default** tool policy with three-tier classification:

### Policy Structure

```yaml
tool_allowlist:
  allowed:           # Automatic execution permitted
    - read_file
    - list_directory
    - git_status
  
  approval_required: # Requires human approval
    - write_file
    - git_commit
    - create_pr
  
  denied:            # Always blocked
    - delete_repository
    - sudo
    - shell_exec
```

### Classification Criteria

| Tier | Risk Level | Approval | Examples |
|------|------------|----------|----------|
| allowed | read | None | File reads, git status, API GETs |
| approval_required | write | Human or automated | File writes, commits, API POSTs |
| denied | destructive | Never | Deletions, admin operations |

### Default Policy
```yaml
# If tool not in any list: DENIED
default_action: deny
```

### Enforcement Points
1. **Gateway (Pre-queue)**: Check policy before dispatching to worker
2. **Worker (Pre-execution)**: Validate policy via control plane API
3. **MCP Router**: Enforce schema validation per tool

### Approval Flow
1. Worker encounters `approval_required` tool
2. Worker reports PENDING status with approval request
3. Gateway creates approval record with expiry
4. Human/system approves via API
5. Gateway re-queues step
6. Worker executes approved tool

## Consequences

### Positive
- **Secure by default**: Unknown tools cannot execute
- **Explicit permissions**: Operators consciously grant access
- **Audit trail**: All policy decisions logged
- **Flexible**: Per-agent, per-tenant policy customization
- **Compliance**: Meets principle of least privilege

### Negative
- **Initial friction**: Operators must configure allowlists
- **Approval latency**: High-risk tools require human wait time
- **Maintenance**: Allowlists need updates as tools change

### Mitigations
- Provide sensible default policies per agent type
- Implement automated approval for trusted scenarios
- Version policies alongside agent definitions

## Implementation Details

### Policy Engine (Rust)
```rust
pub enum PolicyDecision {
    Allow,
    RequireApproval { reason: String },
    Deny { reason: String },
}

pub fn evaluate_tool_call(
    tool_name: &str,
    tool_input: &Value,
    policy: &Policy,
) -> PolicyDecision;
```

### Budget Enforcement
Policy engine also enforces budgets:
- `max_input_tokens`: Total input tokens per run
- `max_output_tokens`: Total output tokens per run
- `max_tool_calls`: Maximum tool invocations per run
- `max_wall_time_secs`: Maximum run duration
- `max_cost_cents`: Maximum cost per run

## Alternatives Considered

### 1. Allow-by-Default
- All tools allowed unless explicitly denied
- Rejected: Too risky, easy to miss dangerous tools

### 2. Capability-Based
- Tools request capabilities (read, write, network)
- Rejected: Too coarse-grained for our use case

### 3. Sandboxing Only
- Run all tools in isolated sandbox
- Rejected: Not all tools can be sandboxed, doesn't prevent data exfiltration

## References

- [OWASP LLM Top 10: LLM07 - Insecure Plugin Design](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [Principle of Least Privilege](https://csrc.nist.gov/glossary/term/least_privilege)
- [MCP Security Considerations](https://modelcontextprotocol.io/docs/concepts/security)
