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

## Airlock RASP (Runtime Application Self-Protection)

Airlock is a multi-layer runtime security system that inspects every tool call before execution. It operates as a "virtual security guard" between the LLM and tool execution.

**Implementation:** `rust/crates/fd-policy/src/airlock/`

### Operating Modes

| Mode | Behavior | Use Case |
|------|----------|----------|
| **Shadow** (default) | Log violations but allow execution | Safe rollout, monitoring |
| **Enforce** | Block violations immediately | Production protection |

### Three Inspection Layers

```
Tool Call → [Layer 1: RCE Detection] → [Layer 2: Velocity Tracker] → [Layer 3: Exfiltration Shield] → Execute
                    ↓                          ↓                              ↓
               Block if pattern           Block if limit              Block if unauthorized
               matches dangerous           exceeded                    destination
               code patterns
```

#### Layer 1: Anti-RCE Pattern Detection

**Risk:** LLM generates malicious code in tool arguments

**Detection Patterns:**
- `eval()`, `exec()`, `compile()` calls
- `os.system()`, `subprocess.run()` shell execution
- Dynamic imports (`__import__`, `importlib`)
- Pickle deserialization (`pickle.loads`)
- Code objects (`code_type`, `types.CodeType`)

**Risk Score:** 90 (Critical)

#### Layer 2: Financial Circuit Breaker (Velocity Tracker)

**Risk:** Runaway costs, infinite loops, resource exhaustion

**Controls:**
- **Spending velocity**: Max $1.00 per 10 seconds (configurable)
- **Loop detection**: Same tool+args called 3+ times triggers block
- **Cost accumulation**: Real-time tracking with sliding window

**Risk Scores:**
- Velocity breach: 85 (Critical)
- Loop detection: 75 (High)

**Implementation:**
```sql
-- Velocity events tracked in PostgreSQL
CREATE TABLE velocity_events (
    id SERIAL PRIMARY KEY,
    run_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_input_hash TEXT NOT NULL,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

#### Layer 3: Data Exfiltration Shield

**Risk:** LLM attempts to exfiltrate data to unauthorized destinations

**Controls:**
- Domain whitelist enforcement
- Raw IP address blocking (prevents C2 connections)
- URL pattern validation

**Risk Scores:**
- Exfiltration attempt: 80 (Critical)
- IP address used: 70 (High)

**Configuration:**
```yaml
exfiltration:
  enabled: true
  target_tools:
    - http_get
    - http_post
    - fetch_url
  allowed_domains:
    - api.github.com
    - api.anthropic.com
  block_ip_addresses: true
```

### Threat Database

Detected threats are stored for audit and analysis:

```sql
CREATE TABLE threats (
    id TEXT PRIMARY KEY,              -- thr_xxxxx
    run_id TEXT NOT NULL,
    risk_score INTEGER NOT NULL,      -- 0-100
    risk_level TEXT NOT NULL,         -- low/medium/high/critical
    violation_type TEXT NOT NULL,     -- rce_pattern/velocity_breach/etc.
    violation_details TEXT NOT NULL,
    blocked_payload JSONB,
    trigger_pattern TEXT,
    action TEXT NOT NULL,             -- blocked/logged
    shadow_mode BOOLEAN NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);
```

### Risk Scoring System

| Level | Score Range | Color | Action |
|-------|-------------|-------|--------|
| **Low** | 0-39 | Green | Log only |
| **Medium** | 40-59 | Yellow | Log + alert |
| **High** | 60-79 | Orange | Block in enforce mode |
| **Critical** | 80-100 | Red | Always block in enforce mode |

### Dashboard Integration

- `/threats` - View all security violations
- Run detail pages show threat count badges
- Settings page for toggling shadow/enforce mode
- Real-time threat feed with 5-second polling

## Additional Threats

### Authentication Bypass
**Risk:** Unauthorized API access

**Controls:**
- API key hashing (HMAC-SHA256 with server secret)
- Legacy SHA256 migration with deadline (2025-03-01)
- Optional OAuth2/JWT validation
- Key rotation support
- Pre-auth IP-based rate limiting
- Post-auth tenant-based rate limiting

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

### LLM Call Security Monitoring

**Risk:** Unmonitored LLM usage can lead to cost overruns, abuse, or security incidents

**Controls:**
- Comprehensive audit logging for all LLM calls
- Anomaly detection for unusual token consumption
- Real-time cost tracking per call
- Security event logging with timestamps

**Implementation:**
```python
# python/packages/fd-worker/src/fd_worker/llm.py
class LLMExecutor:
    MAX_EXPECTED_INPUT_TOKENS = 100_000
    MAX_EXPECTED_OUTPUT_TOKENS = 50_000

    def _log_security_event(self, event_type, model, details, level="info"):
        """Log security events for audit trail."""
        log_data = {
            "event_type": event_type,  # llm_call_start, llm_call_complete, anomaly_*
            "model": model,
            "timestamp": time.time(),
            **details,
        }
        security_logger.info(f"LLM_SECURITY_EVENT: {json.dumps(log_data)}")
```

**Event Types:**
- `llm_call_start` - Call initiated with metadata
- `llm_call_complete` - Call finished with token counts and duration
- `llm_call_error` - Call failed with error type
- `anomaly_high_input_tokens` - Input exceeds threshold
- `anomaly_high_output_tokens` - Output exceeds threshold

### Scope-Based Authorization

**Risk:** Privilege escalation through API key misuse

**Controls:**
- Scope-based middleware (`require_admin()`, `require_write()`)
- Admin-only routes: API key revocation, policy management, security config
- Write-only routes: Registry modifications, workflow creation
- Read routes: Default for authenticated users

**Implementation:**
```rust
// rust/services/gateway/src/routes.rs
Router::new()
    .nest("", admin_routes.layer(middleware::from_fn(require_admin())))
    .nest("", write_routes.layer(middleware::from_fn(require_write())))
    .nest("", read_routes)  // Authenticated but no specific scope required
```

## Security Controls Summary

| Control | Implementation Status |
|---------|----------------------|
| Authentication | Implemented (API Key with HMAC-SHA256, OAuth2/JWT) |
| Authorization | Implemented (Policy Engine + Scope Middleware) |
| Input Validation | Implemented (JSON Schema) |
| Output Sanitization | Implemented (Redaction) |
| Audit Logging | Implemented (AuditEvent + LLM Security Logger) |
| Budget Limits | Implemented (BudgetUsage) |
| Rate Limiting | Implemented (Pre-auth IP + Post-auth Tenant) |
| Runtime Protection | Implemented (Airlock RASP) |
| LLM Monitoring | Implemented (Token anomaly detection) |
| TLS | Required (config) |
| Secrets Management | Partial (env vars) |
| Container Hardening | Implemented (Pinned images, non-root) |

## Recent Security Scan Results

Security scan conducted January 2026. Results: **19/25 vulnerabilities fixed (76%)**.

| Severity | Total | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 6 | 3 | 3 (manual key rotation) |
| High | 8 | 8 | 0 |
| Medium | 8 | 8 | 0 |
| Low | 3 | 2 | 1 (accepted risk) |

**Manual Action Required:**
- C-001: Rotate Anthropic API key at console.anthropic.com
- C-002: Rotate OpenAI API key at platform.openai.com
- C-003: Revoke GitHub token at github.com/settings/tokens

**Accepted Risk:**
- L-002: JWT session invalidation requires Redis blacklist (acceptable with short JWT expiry)

See `security-scan/state.json` for full details.

## Recommended Improvements

### High Priority
1. **Secrets Management**: Integrate with Vault or AWS Secrets Manager
2. **Network Policies**: Kubernetes NetworkPolicies for pod isolation
3. **WAF**: Deploy web application firewall for API protection

### Medium Priority
4. **Field-Level Encryption**: Encrypt sensitive database fields
5. **mTLS**: Mutual TLS between services
6. **SBOM**: Generate software bill of materials
7. **JWT Blacklist**: Redis-based JWT invalidation for immediate session termination

### Low Priority
8. **HSM Integration**: Hardware security module for key management
9. **Penetration Testing**: Regular third-party security assessments

## Incident Response
See [Incident Response Runbook](../runbooks/incident-response.md)

## Security Contact
Report security vulnerabilities to: security@ferrumdeck.com
