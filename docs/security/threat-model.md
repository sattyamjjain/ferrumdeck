# FerrumDeck Threat Model

## Overview
This document analyzes security threats to the FerrumDeck AgentOps platform and the controls implemented to mitigate them.

## System Architecture (Security View)

```
                                    ┌─────────────────┐
                                    │   LLM Providers │
                                    │ (Anthropic/OAI) │
                                    └────────▲────────┘
                                             │
┌──────────┐     ┌─────────────┐     ┌───────┴───────┐     ┌─────────────┐
│  Client  │────▶│   Gateway   │────▶│    Workers    │────▶│ MCP Servers │
│  (API)   │     │(Control Plane)│   │ (Data Plane)  │     │  (Tools)    │
└──────────┘     └──────┬──────┘     └───────────────┘     └─────────────┘
                        │
              ┌─────────┴─────────┐
              │                   │
        ┌─────▼─────┐       ┌─────▼─────┐
        │ PostgreSQL │       │   Redis   │
        │ (State)    │       │ (Queue)   │
        └───────────┘       └───────────┘
```

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| B1 | Client → Gateway (External API) |
| B2 | Gateway → Workers (Internal) |
| B3 | Workers → LLM Providers (External) |
| B4 | Workers → MCP Servers (Internal/External) |
| B5 | Gateway → Database (Internal) |

## OWASP LLM Top 10 Mapping

### LLM01: Prompt Injection
**Risk:** Malicious user input manipulates agent behavior

**Controls:**
- Input validation on API endpoints
- System prompts are immutable (stored in agent versions)
- Clear separation of user input vs system instructions
- Audit logging of all inputs

**Residual Risk:** Medium - LLMs inherently vulnerable to sophisticated injection

### LLM02: Insecure Output Handling
**Risk:** LLM output executed without validation

**Controls:**
- Output sanitization before tool execution
- Tool input schema validation
- Redaction of sensitive data in outputs
- Output size limits

**Implementation:**
```python
# python/packages/fd-worker/src/fd_worker/executor.py
def sanitize_output(output: str) -> str:
    # Remove potential injection patterns
    # Validate against expected schema
```

### LLM03: Training Data Poisoning
**Risk:** Compromised model produces malicious outputs

**Controls:**
- Use only trusted LLM providers (Anthropic, OpenAI)
- Model versioning to roll back if issues detected
- Behavioral monitoring via eval framework

**Residual Risk:** Low - Using pre-trained models, not fine-tuning

### LLM04: Model Denial of Service
**Risk:** Resource exhaustion via expensive prompts

**Controls:**
- Budget limits (tokens, cost, time)
- Rate limiting per API key
- Request timeout enforcement
- Queue depth limits

**Configuration:**
```yaml
budget:
  max_input_tokens: 100000
  max_output_tokens: 50000
  max_cost_cents: 500
  max_wall_time_ms: 300000
```

### LLM05: Supply Chain Vulnerabilities
**Risk:** Compromised dependencies

**Controls:**
- Dependency pinning in lock files
- Cargo.lock / uv.lock committed
- Regular dependency audits (`cargo audit`, `pip-audit`)
- Container image scanning

### LLM06: Sensitive Information Disclosure
**Risk:** LLM reveals secrets or PII

**Controls:**
- Redaction layer for audit logs
- Secrets never passed to LLM directly
- Tool outputs filtered before logging
- Database field-level encryption (future)

**Implementation:**
```rust
// rust/crates/fd-audit/src/redaction.rs
pub fn redact_json(value: &Value) -> Value {
    // Redacts sensitive fields and patterns
}
```

### LLM07: Insecure Plugin Design
**Risk:** Tools with excessive capabilities

**Controls:**
- Deny-by-default tool access
- Tool risk levels (read/write/destructive)
- Approval gates for high-risk tools
- Tool sandboxing (MCP isolation)

**Policy Example:**
```yaml
allowed_tools:
  - read_file      # read risk
  - list_directory # read risk
approval_required:
  - write_file     # write risk
denied_tools:
  - exec_shell     # destructive risk
```

### LLM08: Excessive Agency
**Risk:** Agent takes unintended actions

**Controls:**
- Explicit tool allowlisting per agent
- Budget limits prevent runaway agents
- Human approval for sensitive operations
- Audit trail for all actions

### LLM09: Overreliance
**Risk:** Users trust agent output without verification

**Controls:**
- Clear indication of AI-generated content
- Evaluation framework for quality validation
- Confidence scores where available (future)

**Residual Risk:** Medium - Human factors outside system control

### LLM10: Model Theft
**Risk:** Proprietary prompts/data leaked

**Controls:**
- API key authentication
- TLS for all communications
- Audit logging of access
- No model training on user data

## Additional Threats

### Authentication Bypass
**Risk:** Unauthorized API access

**Controls:**
- API key hashing (SHA256)
- Optional OAuth2/JWT validation
- Key rotation support
- Rate limiting per key

### SQL Injection
**Risk:** Database compromise

**Controls:**
- Parameterized queries (SQLx compile-time checking)
- Input validation
- Least-privilege database users

### Redis Command Injection
**Risk:** Queue manipulation

**Controls:**
- Structured message format (JSON)
- No dynamic Redis commands
- Authentication enabled
- Network isolation

### Container Escape
**Risk:** Worker compromises host

**Controls:**
- Non-root container users
- Read-only root filesystem
- Seccomp/AppArmor profiles
- Resource limits

## Security Controls Summary

| Control | Implementation Status |
|---------|----------------------|
| Authentication | Implemented (API Key, OAuth2) |
| Authorization | Implemented (Policy Engine) |
| Input Validation | Implemented (JSON Schema) |
| Output Sanitization | Implemented (Redaction) |
| Audit Logging | Implemented (AuditEvent) |
| Budget Limits | Implemented (BudgetUsage) |
| Rate Limiting | Implemented (Tower middleware) |
| TLS | Required (config) |
| Secrets Management | Partial (env vars) |
| Container Hardening | Partial (Dockerfile best practices) |

## Recommended Improvements

### High Priority
1. **Secrets Management**: Integrate with Vault or AWS Secrets Manager
2. **Network Policies**: Kubernetes NetworkPolicies for pod isolation
3. **WAF**: Deploy web application firewall for API protection

### Medium Priority
4. **Field-Level Encryption**: Encrypt sensitive database fields
5. **mTLS**: Mutual TLS between services
6. **SBOM**: Generate software bill of materials

### Low Priority
7. **HSM Integration**: Hardware security module for key management
8. **Penetration Testing**: Regular third-party security assessments

## Incident Response
See [Incident Response Runbook](../runbooks/incident-response.md)

## Security Contact
Report security vulnerabilities to: security@ferrumdeck.com
