# Changelog

All notable changes to FerrumDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Deployment
- `deploy/helm/ferrumdeck` Helm chart packaging the gateway, worker, dashboard, and optional bundled Postgres (pgvector) + Redis. Mirrors the existing Kustomize manifests at `deploy/k8s/` (both are retained). CI runs `helm lint` + `kubeconform` on any change under `deploy/helm/`.

#### Airlock RASP Security System
- **Credential DLP**: New `airlock::credential_dlp` module scans outbound payloads for cloud keys (AWS access key id, GCP service-account JSON marker), PATs (GitHub, Stripe live keys, Anthropic, OpenAI, Slack bot tokens), and financial account numbers. False positives on PAN and IBAN suppressed via Luhn (mod-10) and mod-97 checksum validators — arbitrary 16-digit correlation ids are not flagged. Matches recorded as `ViolationType::CredentialLeak` with a redacted first-4/last-4 fingerprint; raw secret never enters audit storage.
- **Per-domain data budget on the exfiltration shield**: New `ExfiltrationConfig.data_budget_per_domain_bytes` caps cumulative outbound bytes per `(run, domain)` tuple. Exceedance returns `ViolationType::DataExfiltrationBudget` and denies further dispatches through the existing shadow/enforce-mode plumbing. Per-run state cleared via `AirlockInspector::clear_run` when a run terminates.
- **Schema-Drift Guard**: Validates MCP tool-call payloads against the registered JSON Schema on each `ToolVersion`. Drifted fields surface as structured deltas (missing-required, type-mismatch, constraint-violation) inside the `AirlockViolation.details` field. New `SchemaDriftGuard` is attached at gateway boot once tool versions load; activation is gated on `InspectionContext.tool_version_id` being populated by the caller. Gateway/worker/dashboard wiring is intentionally deferred to a follow-up PR.
- **Anti-RCE Pattern Matcher**: Detects dangerous code patterns in tool inputs (eval, exec, shell injection)
- **Financial Circuit Breaker**: Spending velocity limits and loop detection to prevent runaway costs
- **Data Exfiltration Shield**: Domain whitelist enforcement, blocks raw IPs, prevents C2 connections
- New `/threats` dashboard page for viewing security violations
- Threat count badges on run detail pages
- Shadow/enforce mode toggle in settings

#### Enhanced Authentication & Authorization
- HMAC-SHA256 API key hashing (replaces plain SHA256)
- Legacy hash migration deadline (2025-03-01) with automatic rejection after deadline
- Scope-based authorization middleware (`require_admin()`, `require_write()`)
- Pre-auth IP-based rate limiting (prevents auth endpoint abuse)

#### LLM Security Monitoring
- Comprehensive audit logging for all LLM calls via litellm
- Token usage anomaly detection (flags calls exceeding thresholds)
- Real-time cost tracking per call
- Security event logging with timestamps and call IDs

#### Dashboard Improvements
- Animated counters for stats display
- Improved error and not-found pages
- Enhanced SSE endpoint with authentication
- Better empty state components

### Fixed

#### Security Vulnerabilities (19/25 resolved)
- **H-001, H-002**: IDOR vulnerabilities - Added tenant validation via `can_access_project()`
- **H-003**: Path traversal in test runner - Added `is_relative_to()` check
- **H-004**: Command injection via container name - Added regex validation
- **H-005**: Unauthenticated SSE access - Added authentication requirement
- **H-006**: Rate limit bypass - Added pre-auth IP-based rate limiter
- **H-007**: Command injection via extra args - Added `validate_extra_args()` allowlist
- **H-008**: Missing LLM monitoring - Added security logging and anomaly detection
- **M-001**: Missing scope enforcement - Added middleware to routes.rs
- **M-002**: Approval without ownership check - Added project verification
- **M-003**: Indefinite legacy hash support - Added migration deadline
- **C-004**: Default API key secret - Made mandatory in production
- **C-005**: Hardcoded fallback API key - Removed fallback, throws error
- **C-006**: Unpinned Docker images - Pinned to rust:1.80-bookworm, uv:0.5.11
- **L-001**: Detailed JWT errors - Changed to generic error messages
- **L-003**: Test API key in production - Added seed migration safety checks

### Changed

- Docker images now use pinned versions for reproducible builds
- JWT validation errors now return generic messages (prevents information leakage)
- API key authentication now uses HMAC with server secret
- Rate limiting now applies before authentication (IP-based)

### Security

- **Accepted Risk (L-002)**: JWT session invalidation requires Redis blacklist infrastructure. Mitigated with short JWT expiry times. API key revocation works immediately.
- **Manual Action Required (C-001, C-002, C-003)**: Rotate exposed API keys at respective provider consoles (Anthropic, OpenAI, GitHub)

## [0.1.0] - 2026-01-15

### Added

- Initial release of FerrumDeck AgentOps Control Plane
- Rust control plane with Axum HTTP API
- Python data plane with litellm LLM execution
- Next.js 16 dashboard with dark "Mission Control" theme
- Deny-by-default tool policies with approval gates
- Budget enforcement (tokens, cost, time, tool calls)
- Immutable audit trail with PII redaction
- MCP router for secure tool execution
- Evaluation framework (fd-evals) for agent testing
- OpenTelemetry integration with GenAI semantic conventions
- Redis Streams for job queue
- PostgreSQL with pgvector for storage
