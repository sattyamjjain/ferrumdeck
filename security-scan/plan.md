# FerrumDeck Security Scan Report

**Scan Date:** 2026-01-24
**Status:** IN PROGRESS
**Total Vulnerabilities:** 25
**Fixed:** 0

---

## Risk Summary

| Severity | Count | Fixed | Remaining |
|----------|-------|-------|-----------|
| CRITICAL | 6 | 0 | 6 |
| HIGH | 8 | 0 | 8 |
| MEDIUM | 8 | 0 | 8 |
| LOW | 3 | 0 | 3 |

---

## CRITICAL Vulnerabilities

### [C-001] Real Anthropic API Key Exposed in .env
- **File:** `.env:45`
- **Type:** Hardcoded Secret
- **Status:** PENDING
- **Risk:** Credential exposure, unauthorized LLM API usage, financial liability
- **Evidence:** `ANTHROPIC_API_KEY=sk-ant-api03-[REDACTED]`
- **Remediation:** Immediately rotate key at console.anthropic.com, verify .env not in git history
- **Verification:** `git log --all -- .env` should return empty

### [C-002] Real OpenAI API Key Exposed in .env
- **File:** `.env:48`
- **Type:** Hardcoded Secret
- **Status:** PENDING
- **Risk:** Credential exposure, unauthorized LLM API usage, financial liability
- **Evidence:** `OPENAI_API_KEY=sk-proj-[REDACTED]`
- **Remediation:** Immediately rotate key at platform.openai.com
- **Verification:** Old key should return 401 unauthorized

### [C-003] Real GitHub Token Exposed in .env
- **File:** `.env:116`
- **Type:** Hardcoded Secret
- **Status:** PENDING
- **Risk:** Repository access, code theft, supply chain attack
- **Evidence:** `GITHUB_TOKEN=ghp_[REDACTED]`
- **Remediation:** Revoke token at github.com/settings/tokens
- **Verification:** Token should be listed as revoked

### [C-004] Default API Key Secret Allows Bypass
- **File:** `rust/services/gateway/src/state.rs:117-123`
- **Type:** Weak Default Credential
- **Status:** PENDING
- **Risk:** Predictable API key hashes if env var not set
- **Evidence:** Falls back to `ferrumdeck-dev-secret-do-not-use-in-production`
- **Remediation:** Fail startup if API_KEY_SECRET not set in production
- **Verification:** Gateway should refuse to start without API_KEY_SECRET

### [C-005] Hardcoded Fallback API Key in Dashboard
- **File:** `nextjs/src/lib/api/config.ts:6-8`
- **Type:** Hardcoded Credential
- **Status:** PENDING
- **Risk:** Default API key provides full access if FD_API_KEY not set
- **Evidence:** `return process.env.FD_API_KEY || "fd_dev_key_abc123"`
- **Remediation:** Remove fallback, fail with clear error
- **Verification:** Dashboard should error without FD_API_KEY

### [C-006] Docker Image Uses Unpinned rust:latest
- **File:** `deploy/docker/Dockerfile.gateway:7`
- **Type:** Unpredictable Build
- **Status:** PENDING
- **Risk:** Build reproducibility, potential CVE introduction
- **Evidence:** `FROM rust:latest AS builder`
- **Remediation:** Pin to `rust:1.80-bookworm`
- **Verification:** Image builds with consistent Rust version

---

## HIGH Vulnerabilities

### [H-001] IDOR - Missing Tenant Isolation on get_run
- **File:** `rust/services/gateway/src/handlers/runs.rs:381-395`
- **Type:** Broken Access Control
- **Status:** PENDING
- **Risk:** Cross-tenant data access
- **Evidence:** AuthContext tenant_id not validated against run ownership
- **Remediation:** Add `if run.project_id != auth.tenant_id { return Err(forbidden) }`
- **Verification:** Test accessing run from different tenant returns 403

### [H-002] IDOR - Missing Tenant Isolation on Multiple Endpoints
- **Files:**
  - `rust/services/gateway/src/handlers/api_keys.rs:84-109`
  - `rust/services/gateway/src/handlers/registry.rs:217-234,368-381`
  - `rust/services/gateway/src/handlers/policies.rs:134-149`
- **Type:** Broken Access Control
- **Status:** PENDING
- **Risk:** Cross-tenant resource access and manipulation
- **Remediation:** Add tenant validation to all resource access endpoints
- **Verification:** Integration tests for cross-tenant access denial

### [H-003] Path Traversal in Test Runner MCP Server
- **File:** `python/packages/fd-mcp-tools/src/fd_mcp_tools/test_runner_server.py:66-69`
- **Type:** Path Traversal
- **Status:** PENDING
- **Risk:** File access outside workspace directory
- **Evidence:** Simple string replacement insufficient, missing is_relative_to() check
- **Remediation:** Apply git_server.py pattern with resolve() and is_relative_to()
- **Verification:** Test `....//etc/passwd` style inputs are blocked

### [H-004] Command Injection via Docker Container Name
- **File:** `nextjs/src/app/api/v1/docker/logs/[container]/route.ts:28-38`
- **Type:** Command Injection
- **Status:** PENDING
- **Risk:** Malicious container names could affect Docker command
- **Evidence:** Container name from URL passed directly to spawn()
- **Remediation:** Add regex validation `/^fd-[a-zA-Z0-9_-]+$/`
- **Verification:** Test malformed container names return 400

### [H-005] SSE Channel Access Without Authentication
- **File:** `nextjs/src/app/api/sse/[channel]/route.ts:296-437`
- **Type:** Missing Authentication
- **Status:** PENDING
- **Risk:** Information disclosure, cross-tenant event monitoring
- **Evidence:** No auth check before subscribing to channels
- **Remediation:** Add authentication middleware, validate channel ownership
- **Verification:** Unauthenticated requests return 401

### [H-006] Rate Limiting Applied After Authentication
- **File:** `rust/services/gateway/src/routes.rs:140-149`
- **Type:** Missing Rate Limiting
- **Status:** PENDING
- **Risk:** Brute-force attacks on API keys
- **Evidence:** Layer order executes rate limit after auth due to Axum layering
- **Remediation:** Add IP-based rate limiting before auth middleware
- **Verification:** Failed auth attempts are rate limited

### [H-007] Command Injection via Extra Args in Test Runner
- **File:** `python/packages/fd-mcp-tools/src/fd_mcp_tools/test_runner_server.py:289-290,315-316`
- **Type:** Command Injection
- **Status:** PENDING
- **Risk:** Arbitrary pytest/jest flags could execute code
- **Evidence:** `args.extend(arguments["extra_args"])` without validation
- **Remediation:** Implement argument allowlist or format validation
- **Verification:** Test malicious extra_args are rejected

### [H-008] litellm Requires Security Monitoring
- **File:** `python/packages/fd-worker/pyproject.toml`
- **Type:** Dependency Risk
- **Status:** PENDING
- **Risk:** Rapid development cycle, historical CVEs, API key logging risks
- **Evidence:** litellm 1.80.11 - no current CVE but high-risk category
- **Remediation:** Pin version, audit logging config, subscribe to advisories
- **Verification:** Verify API keys not present in logs

---

## MEDIUM Vulnerabilities

### [M-001] Missing Scope Enforcement
- **File:** `rust/services/gateway/src/middleware/auth.rs:261-287`
- **Type:** Authorization Bypass
- **Status:** PENDING
- **Risk:** API keys ignore scope restrictions
- **Evidence:** `require_scope` middleware marked `#[allow(dead_code)]`
- **Remediation:** Implement scope enforcement on sensitive endpoints
- **Verification:** Limited-scope key cannot access admin endpoints

### [M-002] Approval Resolution Without Ownership Verification
- **File:** `rust/services/gateway/src/handlers/approvals.rs:147-327`
- **Type:** Broken Access Control
- **Status:** PENDING
- **Risk:** Cross-tenant approval manipulation
- **Evidence:** Any authenticated user can resolve any approval
- **Remediation:** Verify run/project ownership before approval resolution
- **Verification:** Cannot approve/reject other tenant's approvals

### [M-003] Legacy API Key Hash Support
- **File:** `rust/services/gateway/src/middleware/auth.rs:121-156`
- **Type:** Weak Cryptography
- **Status:** PENDING
- **Risk:** SHA256 without salt vulnerable to rainbow tables
- **Evidence:** Fallback to legacy hash for migration
- **Remediation:** Set migration deadline, force key rotation
- **Verification:** Legacy keys rejected after deadline

### [M-004] aiohttp Dependency Requires Monitoring
- **File:** `python/packages/fd-runtime/pyproject.toml`
- **Type:** Dependency Risk
- **Status:** PENDING
- **Risk:** Historical HTTP vulnerabilities
- **Evidence:** aiohttp 3.13.2 - historical CVEs in older versions
- **Remediation:** Keep updated, monitor for new CVEs
- **Verification:** Running latest stable version

### [M-005] Jinja2 Template Injection Risk
- **File:** Python dependencies
- **Type:** Template Injection
- **Status:** PENDING
- **Risk:** SSTI if user input passed to templates
- **Evidence:** jinja2 3.1.6 - risk depends on usage patterns
- **Remediation:** Audit template usage, ensure autoescape enabled
- **Verification:** User input not passed to template rendering

### [M-006] Unpinned uv Image Version
- **File:** `deploy/docker/Dockerfile.worker:23`
- **Type:** Unpredictable Build
- **Status:** PENDING
- **Risk:** Build reproducibility issues
- **Evidence:** `COPY --from=ghcr.io/astral-sh/uv:latest`
- **Remediation:** Pin to specific version (e.g., uv:0.5.0)
- **Verification:** Build uses consistent uv version

### [M-007] tower 0.4.x End-of-Life in Dependencies
- **File:** `Cargo.lock`
- **Type:** Outdated Dependency
- **Status:** PENDING
- **Risk:** No security updates for EOL version
- **Evidence:** tower 0.4.13 alongside 0.5.2
- **Remediation:** Update transitive dependencies to use tower 0.5.x
- **Verification:** `cargo tree -d` shows only tower 0.5.x

### [M-008] Next.js 16 Maturity
- **File:** `nextjs/package.json`
- **Type:** Dependency Risk
- **Status:** PENDING
- **Risk:** New major version may have undiscovered issues
- **Evidence:** next 16.1.1 - recent release
- **Remediation:** Monitor Next.js security advisories, thorough testing
- **Verification:** No known CVEs in deployed version

---

## LOW Vulnerabilities

### [L-001] Detailed JWT Error Messages
- **File:** `rust/services/gateway/src/middleware/auth.rs:100-103`
- **Type:** Information Disclosure
- **Status:** PENDING
- **Risk:** Aids attackers in understanding token validation
- **Evidence:** `format!("Invalid token: {}", e)` returned to client
- **Remediation:** Return generic auth failure, log details server-side
- **Verification:** Auth errors don't expose implementation details

### [L-002] Missing Session Invalidation on Key Revocation
- **File:** `rust/crates/fd-storage/src/repos/api_keys.rs:69-81`
- **Type:** Improper Session Management
- **Status:** PENDING
- **Risk:** Revoked keys may continue working until cache expires
- **Evidence:** No revocation list implementation
- **Remediation:** Implement key revocation check in auth middleware
- **Verification:** Revoked key immediately returns 401

### [L-003] Test API Key in Integration Tests
- **File:** `tests/integration/conftest.py:33,47`
- **Type:** Test Credential
- **Status:** PENDING
- **Risk:** Low - test-only, but ensure not valid in any environment
- **Evidence:** `fd_test_abc123xyz789`
- **Remediation:** Verify this key is not seeded in any database
- **Verification:** Key returns 401 in all environments

---

## Remediation Priority

### Immediate (24 hours)
1. [C-001] Rotate Anthropic API key
2. [C-002] Rotate OpenAI API key
3. [C-003] Revoke GitHub token
4. [H-001] Add tenant validation to get_run

### Week 1
5. [C-004] Fail on missing API_KEY_SECRET
6. [C-005] Remove default API key fallback
7. [C-006] Pin Docker image versions
8. [H-002] Tenant isolation on all endpoints
9. [H-003] Fix path traversal in test_runner
10. [H-004] Validate container names

### Week 2
11. [H-005] Authenticate SSE endpoints
12. [H-006] Pre-auth rate limiting
13. [H-007] Validate test runner extra_args
14. [M-001] Implement scope enforcement
15. [M-002] Ownership check on approvals

### Month 1
16. Remaining MEDIUM and LOW findings
17. Implement automated dependency scanning
18. Set up security advisory monitoring

---

## Session Commands

```
/security-scan resume   - Continue from last fix
/security-scan status   - Show current progress
/security-scan new      - Fresh scan (clears progress)
```
