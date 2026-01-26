# FerrumDeck Comprehensive Testing Plan

**Version**: 1.0.0
**Last Updated**: January 2026
**Status**: Complete Testing Strategy

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Testing Philosophy](#2-testing-philosophy)
3. [Test Categories Overview](#3-test-categories-overview)
4. [Unit Tests](#4-unit-tests)
5. [Integration Tests](#5-integration-tests)
6. [End-to-End Tests](#6-end-to-end-tests)
7. [API Contract Tests](#7-api-contract-tests)
8. [Security Tests](#8-security-tests)
9. [Performance Tests](#9-performance-tests)
10. [Chaos Engineering Tests](#10-chaos-engineering-tests)
11. [UI/Frontend Tests](#11-uifrontend-tests)
12. [Database Tests](#12-database-tests)
13. [Queue & Messaging Tests](#13-queue--messaging-tests)
14. [Evaluation Framework Tests](#14-evaluation-framework-tests)
15. [Test Data Management](#15-test-data-management)
16. [CI/CD Integration](#16-cicd-integration)
17. [Test Execution Matrix](#17-test-execution-matrix)
18. [Appendix: Test Case Catalog](#appendix-test-case-catalog)

---

# 1. Executive Summary

## Purpose

This document defines the complete testing strategy for FerrumDeck, ensuring:
- **Correctness**: All components function as designed
- **Security**: No vulnerabilities in the governance system
- **Reliability**: System handles failures gracefully
- **Performance**: Meets latency and throughput requirements
- **Compliance**: Audit trail integrity is maintained

## Scope

| Component | Coverage Target |
|-----------|----------------|
| Rust Control Plane | 90% unit, 80% integration |
| Python Data Plane | 85% unit, 75% integration |
| Next.js Dashboard | 80% component, 70% integration |
| API Contracts | 100% endpoint coverage |
| Security | 100% critical paths |
| E2E Workflows | 95% user journeys |

## Current State vs Target

| Category | Current | Target | Gap |
|----------|---------|--------|-----|
| Rust Unit Tests | 114 | 250+ | 136 |
| Python Unit Tests | 82 | 150+ | 68 |
| Frontend Tests | 0 | 100+ | 100 |
| Integration Tests | 30 | 80+ | 50 |
| E2E Tests | ~10 | 50+ | 40 |
| Security Tests | 25 | 75+ | 50 |
| Performance Tests | 0 | 30+ | 30 |

---

# 2. Testing Philosophy

## Principles

1. **Test the Behavior, Not the Implementation**
   - Focus on what the code does, not how it does it
   - Tests should survive refactoring

2. **Defense in Depth**
   - Multiple test layers catch different issues
   - Unit → Integration → E2E → Production monitoring

3. **Security is Non-Negotiable**
   - Every security control must have tests
   - Policy engine has 100% path coverage

4. **Fast Feedback Loops**
   - Unit tests run in < 1 minute
   - Integration tests run in < 5 minutes
   - Full E2E suite runs in < 15 minutes

5. **Deterministic Tests**
   - No flaky tests allowed
   - Tests must be reproducible

## Test Pyramid

```
                    ┌─────────────┐
                    │   Manual    │  ← Exploratory testing
                    │   Testing   │
                   ┌┴─────────────┴┐
                   │    E2E Tests  │  ← Full system verification
                  ┌┴───────────────┴┐
                  │ Integration Tests│  ← Component interaction
                 ┌┴─────────────────┴┐
                 │    Contract Tests  │  ← API boundaries
                ┌┴───────────────────┴┐
                │     Unit Tests      │  ← Individual functions
               └──────────────────────┘
```

---

# 3. Test Categories Overview

## 3.1 By Component

| Component | Unit | Integration | E2E | Security | Perf |
|-----------|------|-------------|-----|----------|------|
| fd-core | ✓ | - | - | - | - |
| fd-storage | ✓ | ✓ | - | - | ✓ |
| fd-policy | ✓ | ✓ | ✓ | ✓ | ✓ |
| fd-registry | ✓ | ✓ | - | - | - |
| fd-audit | ✓ | ✓ | - | ✓ | - |
| fd-dag | ✓ | ✓ | ✓ | - | - |
| gateway | ✓ | ✓ | ✓ | ✓ | ✓ |
| fd-worker | ✓ | ✓ | ✓ | ✓ | - |
| fd-mcp-router | ✓ | ✓ | - | ✓ | - |
| fd-evals | ✓ | ✓ | ✓ | - | - |
| dashboard | ✓ | ✓ | ✓ | - | - |

## 3.2 By Priority

| Priority | Category | Description |
|----------|----------|-------------|
| P0 | Security | Policy engine, Airlock, authentication |
| P0 | Core Flows | Run lifecycle, step execution |
| P1 | API Contracts | All REST endpoints |
| P1 | Budget Enforcement | Token/cost limits |
| P2 | Audit Trail | Event logging, PII redaction |
| P2 | Dashboard | Critical user journeys |
| P3 | Performance | Latency, throughput |
| P3 | Edge Cases | Error handling, recovery |

---

# 4. Unit Tests

## 4.1 Rust Control Plane

### 4.1.1 fd-core (Core Primitives)

**File**: `rust/crates/fd-core/src/id.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| CORE-ID-001 | `test_run_id_generation` | RunId generates valid ULID with "run_" prefix | P0 |
| CORE-ID-002 | `test_step_id_generation` | StepId generates valid ULID with "stp_" prefix | P0 |
| CORE-ID-003 | `test_agent_id_generation` | AgentId generates valid ULID with "agt_" prefix | P0 |
| CORE-ID-004 | `test_id_parsing_valid` | IDs can be parsed from valid strings | P0 |
| CORE-ID-005 | `test_id_parsing_invalid_prefix` | Parsing fails for wrong prefix | P1 |
| CORE-ID-006 | `test_id_parsing_invalid_ulid` | Parsing fails for invalid ULID portion | P1 |
| CORE-ID-007 | `test_id_uniqueness` | 1000 generated IDs are unique | P0 |
| CORE-ID-008 | `test_id_ordering` | IDs are time-ordered | P1 |
| CORE-ID-009 | `test_id_serialization` | IDs serialize/deserialize correctly | P0 |
| CORE-ID-010 | `test_id_equality` | Same ID strings are equal | P1 |

**File**: `rust/crates/fd-core/src/error.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| CORE-ERR-001 | `test_not_found_error` | NotFound error contains entity and id | P1 |
| CORE-ERR-002 | `test_policy_denied_error` | PolicyDenied contains reason and rule_id | P0 |
| CORE-ERR-003 | `test_budget_exceeded_error` | BudgetExceeded contains resource and limit | P0 |
| CORE-ERR-004 | `test_approval_required_error` | ApprovalRequired contains action and request_id | P0 |
| CORE-ERR-005 | `test_error_display` | All errors have readable Display impl | P1 |
| CORE-ERR-006 | `test_error_source_chain` | Error source chain is correct | P2 |

**File**: `rust/crates/fd-core/src/config.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| CORE-CFG-001 | `test_config_from_env` | Config loads from environment variables | P0 |
| CORE-CFG-002 | `test_config_defaults` | Missing env vars use defaults | P0 |
| CORE-CFG-003 | `test_config_validation` | Invalid config values are rejected | P1 |
| CORE-CFG-004 | `test_database_url_required` | Missing DATABASE_URL fails | P0 |
| CORE-CFG-005 | `test_redis_url_default` | Redis URL defaults to localhost | P1 |

### 4.1.2 fd-policy (Policy Engine)

**File**: `rust/crates/fd-policy/src/engine.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| POL-ENG-001 | `test_deny_by_default` | Unknown tools are denied | P0 |
| POL-ENG-002 | `test_allowed_tool_passes` | Tools in allowed_tools list pass | P0 |
| POL-ENG-003 | `test_denied_tool_blocks` | Tools in denied_tools list block | P0 |
| POL-ENG-004 | `test_approval_required` | Tools in approval_required trigger approval | P0 |
| POL-ENG-005 | `test_denied_takes_precedence` | Denied > approval_required > allowed | P0 |
| POL-ENG-006 | `test_wildcard_pattern_match` | `file_*` matches `file_read`, `file_write` | P1 |
| POL-ENG-007 | `test_exact_match_priority` | Exact match beats wildcard | P1 |
| POL-ENG-008 | `test_empty_allowlist_denies_all` | Empty allowlist denies everything | P0 |
| POL-ENG-009 | `test_policy_decision_metadata` | Decision includes policy_id and timestamp | P1 |
| POL-ENG-010 | `test_multiple_policies_merge` | Agent + tenant policies merge correctly | P1 |
| POL-ENG-011 | `test_policy_inheritance` | Project inherits workspace policy | P2 |
| POL-ENG-012 | `test_case_sensitive_tool_names` | Tool names are case-sensitive | P1 |

**File**: `rust/crates/fd-policy/src/budget.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| POL-BUD-001 | `test_input_token_limit` | Exceeding input tokens triggers kill | P0 |
| POL-BUD-002 | `test_output_token_limit` | Exceeding output tokens triggers kill | P0 |
| POL-BUD-003 | `test_total_token_limit` | Exceeding total tokens triggers kill | P0 |
| POL-BUD-004 | `test_tool_call_limit` | Exceeding tool calls triggers kill | P0 |
| POL-BUD-005 | `test_wall_time_limit` | Exceeding wall time triggers kill | P0 |
| POL-BUD-006 | `test_cost_limit` | Exceeding cost triggers kill | P0 |
| POL-BUD-007 | `test_budget_usage_atomic_increment` | Usage increments are atomic | P0 |
| POL-BUD-008 | `test_budget_remaining_calculation` | Remaining budget calculated correctly | P1 |
| POL-BUD-009 | `test_unlimited_budget` | None limits mean unlimited | P1 |
| POL-BUD-010 | `test_zero_budget_immediate_kill` | Zero budget kills immediately | P1 |
| POL-BUD-011 | `test_budget_check_all_dimensions` | Single check evaluates all limits | P0 |
| POL-BUD-012 | `test_partial_budget` | Can set only some limits | P1 |

**File**: `rust/crates/fd-policy/src/airlock/patterns.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| AIR-RCE-001 | `test_detect_eval_call` | `eval(user_input)` detected | P0 |
| AIR-RCE-002 | `test_detect_exec_call` | `exec(code)` detected | P0 |
| AIR-RCE-003 | `test_detect_os_system` | `os.system("cmd")` detected | P0 |
| AIR-RCE-004 | `test_detect_subprocess` | `subprocess.run(...)` detected | P0 |
| AIR-RCE-005 | `test_detect_pickle_loads` | `pickle.loads(data)` detected | P0 |
| AIR-RCE-006 | `test_detect_import_dunder` | `__import__("os")` detected | P0 |
| AIR-RCE-007 | `test_detect_compile` | `compile(code, ...)` detected | P0 |
| AIR-RCE-008 | `test_detect_code_object` | `types.CodeType(...)` detected | P1 |
| AIR-RCE-009 | `test_nested_dangerous_code` | Nested in JSON still detected | P0 |
| AIR-RCE-010 | `test_base64_encoded_bypass` | Base64 encoded attacks detected | P0 |
| AIR-RCE-011 | `test_obfuscated_eval` | `e` + `v` + `a` + `l` detected | P1 |
| AIR-RCE-012 | `test_clean_code_passes` | Normal code passes inspection | P0 |
| AIR-RCE-013 | `test_string_eval_in_comment` | `"eval"` in comment passes | P2 |
| AIR-RCE-014 | `test_risk_score_calculation` | RCE patterns get 90+ risk score | P0 |

**File**: `rust/crates/fd-policy/src/airlock/velocity.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| AIR-VEL-001 | `test_velocity_within_limit` | Under velocity limit passes | P0 |
| AIR-VEL-002 | `test_velocity_exceeds_limit` | Over velocity limit blocks | P0 |
| AIR-VEL-003 | `test_loop_detection_trigger` | 3+ identical calls trigger block | P0 |
| AIR-VEL-004 | `test_loop_detection_different_args` | Different args don't trigger | P1 |
| AIR-VEL-005 | `test_velocity_window_sliding` | Old events expire from window | P1 |
| AIR-VEL-006 | `test_velocity_cost_accumulation` | Cost accumulates correctly | P0 |
| AIR-VEL-007 | `test_velocity_per_run_isolation` | Different runs isolated | P0 |
| AIR-VEL-008 | `test_velocity_clear_on_completion` | Run completion clears data | P1 |
| AIR-VEL-009 | `test_input_hash_consistency` | Same input = same hash | P1 |
| AIR-VEL-010 | `test_configurable_threshold` | Loop threshold is configurable | P2 |

**File**: `rust/crates/fd-policy/src/airlock/exfiltration.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| AIR-EXF-001 | `test_allowed_domain_passes` | Whitelisted domain passes | P0 |
| AIR-EXF-002 | `test_unauthorized_domain_blocks` | Non-whitelisted domain blocks | P0 |
| AIR-EXF-003 | `test_ip_address_blocks` | Raw IP address blocks | P0 |
| AIR-EXF-004 | `test_localhost_allowed` | localhost is allowed | P1 |
| AIR-EXF-005 | `test_subdomain_handling` | `api.github.com` matches `github.com` | P1 |
| AIR-EXF-006 | `test_url_in_nested_json` | URL in nested object detected | P0 |
| AIR-EXF-007 | `test_multiple_urls` | Multiple URLs all checked | P0 |
| AIR-EXF-008 | `test_private_ip_ranges` | 10.x, 192.168.x blocked | P1 |
| AIR-EXF-009 | `test_ipv6_blocked` | IPv6 addresses blocked | P1 |
| AIR-EXF-010 | `test_empty_whitelist_blocks_all` | Empty whitelist blocks external | P0 |
| AIR-EXF-011 | `test_target_tools_filter` | Only configured tools inspected | P1 |
| AIR-EXF-012 | `test_non_http_tool_ignored` | Non-HTTP tools not inspected | P2 |

**File**: `rust/crates/fd-policy/src/airlock/inspector.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| AIR-INS-001 | `test_shadow_mode_logs_not_blocks` | Shadow mode allows but logs | P0 |
| AIR-INS-002 | `test_enforce_mode_blocks` | Enforce mode blocks violations | P0 |
| AIR-INS-003 | `test_clean_call_passes` | Clean tool call passes all layers | P0 |
| AIR-INS-004 | `test_rce_first_layer` | RCE check runs first | P0 |
| AIR-INS-005 | `test_velocity_second_layer` | Velocity check runs second | P0 |
| AIR-INS-006 | `test_exfil_third_layer` | Exfil check runs third | P0 |
| AIR-INS-007 | `test_first_violation_returns` | First violation stops checking | P1 |
| AIR-INS-008 | `test_risk_level_from_score` | Score → level mapping correct | P1 |
| AIR-INS-009 | `test_inspection_context_complete` | Context has all required fields | P1 |
| AIR-INS-010 | `test_disabled_layers_skipped` | Disabled layers don't run | P2 |

### 4.1.3 fd-storage (Data Layer)

**File**: `rust/crates/fd-storage/src/repos/runs.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| STO-RUN-001 | `test_create_run` | Run created with all fields | P0 |
| STO-RUN-002 | `test_get_run_by_id` | Run retrieved by ID | P0 |
| STO-RUN-003 | `test_get_run_not_found` | Non-existent ID returns None | P0 |
| STO-RUN-004 | `test_update_run_status` | Status updates correctly | P0 |
| STO-RUN-005 | `test_increment_usage_atomic` | Usage increment is atomic | P0 |
| STO-RUN-006 | `test_list_runs_pagination` | List with limit/offset works | P1 |
| STO-RUN-007 | `test_list_runs_filter_status` | Filter by status works | P1 |
| STO-RUN-008 | `test_list_runs_filter_agent` | Filter by agent_id works | P1 |
| STO-RUN-009 | `test_list_runs_order_by` | Order by created_at desc | P1 |
| STO-RUN-010 | `test_run_tenant_isolation` | Runs isolated by tenant | P0 |

**File**: `rust/crates/fd-storage/src/repos/steps.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| STO-STP-001 | `test_create_step` | Step created with all fields | P0 |
| STO-STP-002 | `test_get_step_by_id` | Step retrieved by ID | P0 |
| STO-STP-003 | `test_list_steps_for_run` | List steps for a run | P0 |
| STO-STP-004 | `test_update_step_status` | Status updates correctly | P0 |
| STO-STP-005 | `test_update_step_output` | Output JSON updates | P0 |
| STO-STP-006 | `test_step_ordering` | Steps ordered by step_number | P1 |
| STO-STP-007 | `test_step_parent_relationship` | Parent step tracked | P1 |

**File**: `rust/crates/fd-storage/src/repos/threats.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| STO-THR-001 | `test_create_threat` | Threat created with all fields | P0 |
| STO-THR-002 | `test_get_threat_by_id` | Threat retrieved by ID | P0 |
| STO-THR-003 | `test_list_threats_for_run` | List threats for a run | P0 |
| STO-THR-004 | `test_list_threats_by_risk_level` | Filter by risk level | P1 |
| STO-THR-005 | `test_list_threats_by_action` | Filter by blocked/logged | P1 |
| STO-THR-006 | `test_threat_count_trigger` | Run threat_count auto-increments | P0 |
| STO-THR-007 | `test_blocked_payload_storage` | Large payloads stored correctly | P1 |

**File**: `rust/crates/fd-storage/src/queue.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| STO-QUE-001 | `test_enqueue_message` | Message enqueued to stream | P0 |
| STO-QUE-002 | `test_dequeue_message` | Message dequeued from stream | P0 |
| STO-QUE-003 | `test_ack_message` | Message acknowledged | P0 |
| STO-QUE-004 | `test_dequeue_empty_returns_none` | Empty queue returns None | P0 |
| STO-QUE-005 | `test_consumer_group_creation` | Consumer group auto-created | P1 |
| STO-QUE-006 | `test_message_redelivery` | Unacked messages redeliver | P0 |
| STO-QUE-007 | `test_pending_message_claim` | Long-pending messages claimed | P1 |

### 4.1.4 fd-audit (Audit Logging)

**File**: `rust/crates/fd-audit/src/redaction.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| AUD-RED-001 | `test_redact_api_key` | API keys redacted | P0 |
| AUD-RED-002 | `test_redact_aws_credentials` | AWS keys redacted | P0 |
| AUD-RED-003 | `test_redact_database_url` | Connection strings redacted | P0 |
| AUD-RED-004 | `test_redact_email` | Email addresses redacted | P1 |
| AUD-RED-005 | `test_redact_credit_card` | Credit card numbers redacted | P0 |
| AUD-RED-006 | `test_redact_ssn` | SSN redacted | P1 |
| AUD-RED-007 | `test_redact_password_field` | "password" field values redacted | P0 |
| AUD-RED-008 | `test_redact_nested_json` | Nested JSON redacted | P0 |
| AUD-RED-009 | `test_redact_array_values` | Array elements redacted | P1 |
| AUD-RED-010 | `test_redact_preserves_structure` | JSON structure preserved | P1 |

**File**: `rust/crates/fd-audit/src/event.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| AUD-EVT-001 | `test_create_audit_event` | Event created with all fields | P0 |
| AUD-EVT-002 | `test_event_timestamp_utc` | Timestamp is UTC | P1 |
| AUD-EVT-003 | `test_event_immutable` | Events cannot be modified | P0 |
| AUD-EVT-004 | `test_event_serialization` | Events serialize to JSON | P0 |
| AUD-EVT-005 | `test_event_actor_types` | User, agent, system actors | P1 |

### 4.1.5 fd-dag (Workflow Scheduler)

**File**: `rust/crates/fd-dag/src/scheduler.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| DAG-SCH-001 | `test_topological_sort` | Steps sorted correctly | P0 |
| DAG-SCH-002 | `test_get_ready_steps` | Ready steps returned | P0 |
| DAG-SCH-003 | `test_step_completion` | Completion updates state | P0 |
| DAG-SCH-004 | `test_dependent_becomes_ready` | Completing step unblocks dependents | P0 |
| DAG-SCH-005 | `test_parallel_steps` | Independent steps ready together | P0 |
| DAG-SCH-006 | `test_cycle_detection` | Cyclic DAG rejected | P0 |
| DAG-SCH-007 | `test_missing_dependency` | Missing dependency detected | P1 |
| DAG-SCH-008 | `test_conditional_step` | Condition evaluated correctly | P1 |
| DAG-SCH-009 | `test_skip_on_condition` | Step skipped when condition false | P1 |
| DAG-SCH-010 | `test_failure_propagation` | Failure propagates to dependents | P0 |

### 4.1.6 Gateway Handlers

**File**: `rust/services/gateway/src/handlers/runs.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| GW-RUN-001 | `test_create_run_request` | Valid request creates run | P0 |
| GW-RUN-002 | `test_create_run_invalid_agent` | Invalid agent_id returns 404 | P0 |
| GW-RUN-003 | `test_create_run_missing_input` | Missing input returns 400 | P0 |
| GW-RUN-004 | `test_get_run_success` | Existing run returned | P0 |
| GW-RUN-005 | `test_get_run_not_found` | Non-existent run returns 404 | P0 |
| GW-RUN-006 | `test_list_runs_default` | Default list returns runs | P0 |
| GW-RUN-007 | `test_list_runs_pagination` | Limit/offset work | P1 |
| GW-RUN-008 | `test_cancel_run_running` | Running run can be cancelled | P0 |
| GW-RUN-009 | `test_cancel_run_completed` | Completed run returns 400 | P1 |
| GW-RUN-010 | `test_submit_step_result` | Step result updates state | P0 |
| GW-RUN-011 | `test_check_tool_policy` | Policy check returns decision | P0 |

**File**: `rust/services/gateway/src/handlers/approvals.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| GW-APR-001 | `test_list_pending_approvals` | Pending approvals returned | P0 |
| GW-APR-002 | `test_approve_request` | Approval updates status | P0 |
| GW-APR-003 | `test_reject_request` | Rejection updates status | P0 |
| GW-APR-004 | `test_resolve_not_found` | Non-existent returns 404 | P1 |
| GW-APR-005 | `test_resolve_already_resolved` | Double resolve returns 400 | P1 |
| GW-APR-006 | `test_approve_resumes_run` | Approval resumes waiting run | P0 |

**File**: `rust/services/gateway/src/handlers/security.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| GW-SEC-001 | `test_list_threats` | Threats list returned | P0 |
| GW-SEC-002 | `test_list_threats_filter` | Filter by risk_level works | P1 |
| GW-SEC-003 | `test_get_threat` | Single threat returned | P0 |
| GW-SEC-004 | `test_get_config` | Airlock config returned | P0 |
| GW-SEC-005 | `test_update_config_mode` | Mode update works | P0 |
| GW-SEC-006 | `test_update_config_admin_only` | Non-admin gets 403 | P0 |

### 4.1.7 Gateway Middleware

**File**: `rust/services/gateway/src/middleware/auth.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| GW-AUTH-001 | `test_valid_api_key` | Valid key passes auth | P0 |
| GW-AUTH-002 | `test_invalid_api_key` | Invalid key returns 401 | P0 |
| GW-AUTH-003 | `test_missing_auth_header` | Missing header returns 401 | P0 |
| GW-AUTH-004 | `test_expired_api_key` | Expired key returns 401 | P0 |
| GW-AUTH-005 | `test_revoked_api_key` | Revoked key returns 401 | P0 |
| GW-AUTH-006 | `test_bearer_format` | Bearer token format works | P1 |
| GW-AUTH-007 | `test_apikey_format` | ApiKey format works | P1 |
| GW-AUTH-008 | `test_auth_context_populated` | AuthContext has tenant_id | P0 |
| GW-AUTH-009 | `test_scopes_extracted` | Scopes extracted from key | P0 |

**File**: `rust/services/gateway/src/middleware/rate_limit.rs`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| GW-RL-001 | `test_under_limit_passes` | Under limit passes | P0 |
| GW-RL-002 | `test_over_limit_returns_429` | Over limit returns 429 | P0 |
| GW-RL-003 | `test_rate_limit_headers` | Response has X-RateLimit-* headers | P1 |
| GW-RL-004 | `test_window_resets` | Limit resets after window | P0 |
| GW-RL-005 | `test_per_tenant_isolation` | Different tenants have separate limits | P0 |
| GW-RL-006 | `test_pre_auth_ip_based` | Pre-auth uses IP address | P0 |
| GW-RL-007 | `test_retry_after_header` | Retry-After header set | P1 |

## 4.2 Python Data Plane

### 4.2.1 fd-runtime (Core Library)

**File**: `python/packages/fd-runtime/tests/test_models.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-MOD-001 | `test_run_status_enum` | All status values valid | P0 |
| PY-MOD-002 | `test_step_type_enum` | All step types valid | P0 |
| PY-MOD-003 | `test_budget_defaults` | Budget has correct defaults | P0 |
| PY-MOD-004 | `test_budget_validation` | Negative values rejected | P1 |
| PY-MOD-005 | `test_run_serialization` | Run serializes to JSON | P0 |
| PY-MOD-006 | `test_step_serialization` | Step serializes to JSON | P0 |

**File**: `python/packages/fd-runtime/tests/test_client.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-CLI-001 | `test_create_run` | Create run API call | P0 |
| PY-CLI-002 | `test_get_run` | Get run API call | P0 |
| PY-CLI-003 | `test_submit_step_result` | Submit result API call | P0 |
| PY-CLI-004 | `test_check_tool_policy` | Policy check API call | P0 |
| PY-CLI-005 | `test_retry_on_transient` | Retries on 503 | P0 |
| PY-CLI-006 | `test_no_retry_on_4xx` | No retry on client errors | P1 |
| PY-CLI-007 | `test_api_key_header` | API key in Authorization header | P0 |
| PY-CLI-008 | `test_timeout_handling` | Timeout raises appropriate error | P1 |

### 4.2.2 fd-worker (Queue Consumer)

**File**: `python/packages/fd-worker/tests/test_executor.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-EXE-001 | `test_execute_llm_step` | LLM step executed | P0 |
| PY-EXE-002 | `test_execute_tool_step` | Tool step executed | P0 |
| PY-EXE-003 | `test_policy_denied_raises` | Denied tool raises PolicyDeniedError | P0 |
| PY-EXE-004 | `test_approval_required_waits` | Approval required pauses execution | P0 |
| PY-EXE-005 | `test_budget_exceeded_raises` | Budget exceeded raises BudgetExceededError | P0 |
| PY-EXE-006 | `test_transient_error_retries` | Transient errors trigger retry | P0 |
| PY-EXE-007 | `test_llm_response_parsing` | Tool calls extracted from response | P0 |
| PY-EXE-008 | `test_output_validation` | LLM output validated before tool call | P0 |

**File**: `python/packages/fd-worker/tests/test_llm.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-LLM-001 | `test_complete_success` | LLM completion succeeds | P0 |
| PY-LLM-002 | `test_complete_with_tools` | Tool definitions passed | P0 |
| PY-LLM-003 | `test_token_counting` | Tokens counted correctly | P0 |
| PY-LLM-004 | `test_cost_calculation` | Cost calculated from tokens | P0 |
| PY-LLM-005 | `test_model_fallback` | Fallback model used on error | P1 |
| PY-LLM-006 | `test_rate_limit_handling` | Rate limit triggers retry | P0 |

**File**: `python/packages/fd-worker/tests/test_validation.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-VAL-001 | `test_detect_script_tag` | `<script>` in output detected | P0 |
| PY-VAL-002 | `test_detect_template_injection` | `{{}}` injection detected | P0 |
| PY-VAL-003 | `test_detect_command_injection` | `; rm -rf /` detected | P0 |
| PY-VAL-004 | `test_clean_output_passes` | Normal output passes | P0 |
| PY-VAL-005 | `test_json_schema_validation` | Output matches schema | P1 |

**File**: `python/packages/fd-worker/tests/test_queue.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-QUE-001 | `test_connect_to_redis` | Connection established | P0 |
| PY-QUE-002 | `test_poll_returns_job` | Poll returns job when available | P0 |
| PY-QUE-003 | `test_poll_timeout_returns_none` | Poll timeout returns None | P0 |
| PY-QUE-004 | `test_ack_removes_message` | Ack removes from pending | P0 |
| PY-QUE-005 | `test_reconnect_on_disconnect` | Auto-reconnect on disconnect | P1 |

### 4.2.3 fd-mcp-router (Tool Routing)

**File**: `python/packages/fd-mcp-router/tests/test_router.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-MCP-001 | `test_route_to_correct_server` | Tool routed to right server | P0 |
| PY-MCP-002 | `test_unknown_tool_error` | Unknown tool raises error | P0 |
| PY-MCP-003 | `test_server_startup` | MCP servers start correctly | P0 |
| PY-MCP-004 | `test_server_shutdown` | MCP servers stop gracefully | P1 |
| PY-MCP-005 | `test_tool_result_parsing` | Tool result parsed correctly | P0 |

**File**: `python/packages/fd-mcp-router/tests/test_allowlist.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-ALW-001 | `test_allowed_tool_passes` | Allowed tool returns "allowed" | P0 |
| PY-ALW-002 | `test_denied_tool_blocks` | Denied tool returns "denied" | P0 |
| PY-ALW-003 | `test_approval_required` | Approval tool returns "requires_approval" | P0 |
| PY-ALW-004 | `test_default_deny` | Unknown tool returns "denied" | P0 |

### 4.2.4 fd-mcp-tools (MCP Servers)

**File**: `python/packages/fd-mcp-tools/tests/test_git_server.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-GIT-001 | `test_git_clone` | Clone repository | P0 |
| PY-GIT-002 | `test_git_status` | Get repo status | P0 |
| PY-GIT-003 | `test_git_diff` | Get diff | P0 |
| PY-GIT-004 | `test_git_commit` | Create commit | P0 |
| PY-GIT-005 | `test_git_push` | Push to remote | P0 |
| PY-GIT-006 | `test_invalid_repo_error` | Invalid repo path errors | P1 |

**File**: `python/packages/fd-mcp-tools/tests/test_test_runner_server.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-TST-001 | `test_run_pytest` | Run pytest tests | P0 |
| PY-TST-002 | `test_run_jest` | Run jest tests | P0 |
| PY-TST-003 | `test_run_cargo_test` | Run cargo tests | P0 |
| PY-TST-004 | `test_lint_check` | Run lint check | P1 |
| PY-TST-005 | `test_command_injection_blocked` | Injection in args blocked | P0 |
| PY-TST-006 | `test_path_traversal_blocked` | Path traversal blocked | P0 |
| PY-TST-007 | `test_timeout_handling` | Long tests timeout | P1 |

### 4.2.5 fd-evals (Evaluation Framework)

**File**: `python/packages/fd-evals/tests/test_runner.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-EVL-001 | `test_run_suite` | Run evaluation suite | P0 |
| PY-EVL-002 | `test_load_tasks` | Load tasks from JSONL | P0 |
| PY-EVL-003 | `test_parallel_execution` | Parallel task execution | P1 |
| PY-EVL-004 | `test_result_aggregation` | Results aggregated correctly | P0 |
| PY-EVL-005 | `test_report_generation` | JSON report generated | P0 |

**File**: `python/packages/fd-evals/tests/test_scorers.py`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| PY-SCR-001 | `test_schema_valid_scorer` | Schema validation scoring | P0 |
| PY-SCR-002 | `test_files_changed_scorer` | File changes scoring | P0 |
| PY-SCR-003 | `test_pr_created_scorer` | PR creation scoring | P0 |
| PY-SCR-004 | `test_test_pass_scorer` | Test pass scoring | P0 |
| PY-SCR-005 | `test_no_policy_violations_scorer` | No violations scoring | P0 |
| PY-SCR-006 | `test_llm_judge_scorer` | LLM-as-judge scoring | P1 |
| PY-SCR-007 | `test_scorer_composition` | Multiple scorers combined | P1 |

## 4.3 Next.js Dashboard

### 4.3.1 Component Tests

**File**: `nextjs/src/components/runs/__tests__/run-list.test.tsx`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-RUN-001 | `renders run list` | List renders with runs | P0 |
| UI-RUN-002 | `shows loading state` | Shows skeleton while loading | P1 |
| UI-RUN-003 | `shows empty state` | Shows message when no runs | P1 |
| UI-RUN-004 | `renders status badges` | Correct status colors | P0 |
| UI-RUN-005 | `handles click to detail` | Navigate on row click | P1 |
| UI-RUN-006 | `filters by status` | Status filter works | P1 |
| UI-RUN-007 | `filters by agent` | Agent filter works | P1 |
| UI-RUN-008 | `pagination works` | Next/prev page works | P1 |

**File**: `nextjs/src/components/runs/__tests__/run-detail.test.tsx`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-RDT-001 | `renders run header` | Header with ID and status | P0 |
| UI-RDT-002 | `renders step timeline` | Steps shown in timeline | P0 |
| UI-RDT-003 | `shows token usage` | Token counts displayed | P1 |
| UI-RDT-004 | `shows cost` | Cost displayed correctly | P1 |
| UI-RDT-005 | `cancel button works` | Cancel triggers API call | P0 |
| UI-RDT-006 | `shows threat badge` | Threat count shown | P0 |
| UI-RDT-007 | `expands step details` | Click expands step | P1 |

**File**: `nextjs/src/components/approvals/__tests__/approval-card.test.tsx`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-APR-001 | `renders approval details` | Shows action and reason | P0 |
| UI-APR-002 | `approve button works` | Approve triggers API | P0 |
| UI-APR-003 | `reject button works` | Reject triggers API | P0 |
| UI-APR-004 | `shows pending state` | Loading state on submit | P1 |
| UI-APR-005 | `shows success feedback` | Toast on success | P1 |

**File**: `nextjs/src/components/security/__tests__/threat-table.test.tsx`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-THR-001 | `renders threat list` | Threats shown in table | P0 |
| UI-THR-002 | `risk level badges` | Correct colors for levels | P0 |
| UI-THR-003 | `filter by risk level` | Risk level filter works | P1 |
| UI-THR-004 | `filter by action` | Action filter works | P1 |
| UI-THR-005 | `click to detail` | Navigate to threat detail | P1 |

**File**: `nextjs/src/components/security/__tests__/airlock-settings.test.tsx`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-AIR-001 | `shows current mode` | Shadow/enforce displayed | P0 |
| UI-AIR-002 | `toggle mode works` | Mode toggle calls API | P0 |
| UI-AIR-003 | `shows confirmation` | Confirm before enforce | P0 |
| UI-AIR-004 | `shows loading state` | Loading during toggle | P1 |

### 4.3.2 Hook Tests

**File**: `nextjs/src/hooks/__tests__/use-runs.test.ts`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-HRN-001 | `useRuns fetches list` | API called correctly | P0 |
| UI-HRN-002 | `useRuns polls` | Refetches at interval | P0 |
| UI-HRN-003 | `useRun fetches single` | Single run fetched | P0 |
| UI-HRN-004 | `useRun stops polling` | Stops when terminal status | P1 |
| UI-HRN-005 | `useSteps fetches steps` | Steps fetched for run | P0 |

**File**: `nextjs/src/hooks/__tests__/use-security.test.ts`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-HSC-001 | `useThreats fetches list` | Threats fetched | P0 |
| UI-HSC-002 | `useAirlockConfig fetches` | Config fetched | P0 |
| UI-HSC-003 | `useUpdateAirlockConfig` | Config update works | P0 |
| UI-HSC-004 | `invalidates on update` | Query invalidated | P1 |

### 4.3.3 API Route Tests

**File**: `nextjs/src/app/api/v1/runs/__tests__/route.test.ts`

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-API-001 | `GET proxies to gateway` | Request forwarded | P0 |
| UI-API-002 | `POST proxies to gateway` | Request forwarded | P0 |
| UI-API-003 | `adds auth header` | Authorization added | P0 |
| UI-API-004 | `handles gateway error` | Error propagated | P1 |
| UI-API-005 | `handles timeout` | Timeout handled | P1 |

---

# 5. Integration Tests

## 5.1 Rust Integration Tests

**Location**: `rust/tests/`

### 5.1.1 Database Integration

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| INT-DB-001 | `test_migrations_run` | All migrations apply successfully | P0 |
| INT-DB-002 | `test_run_lifecycle` | Create → update → complete | P0 |
| INT-DB-003 | `test_concurrent_updates` | Concurrent updates don't conflict | P0 |
| INT-DB-004 | `test_transaction_rollback` | Failed transaction rolls back | P0 |
| INT-DB-005 | `test_large_json_storage` | Large JSONB stored correctly | P1 |
| INT-DB-006 | `test_tenant_isolation` | Queries respect tenant_id | P0 |
| INT-DB-007 | `test_cascade_delete` | Deleting run deletes steps | P1 |
| INT-DB-008 | `test_index_performance` | Indexed queries are fast | P2 |

### 5.1.2 Redis Integration

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| INT-RD-001 | `test_stream_operations` | XADD/XREAD work correctly | P0 |
| INT-RD-002 | `test_consumer_group` | Consumer group operates | P0 |
| INT-RD-003 | `test_pending_entries` | Pending entries tracked | P0 |
| INT-RD-004 | `test_reconnection` | Reconnects after disconnect | P0 |
| INT-RD-005 | `test_high_throughput` | 1000 msg/sec sustained | P1 |

### 5.1.3 Gateway Integration

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| INT-GW-001 | `test_full_run_creation` | API → DB → Queue | P0 |
| INT-GW-002 | `test_step_submission` | Worker → API → DB | P0 |
| INT-GW-003 | `test_approval_flow` | Request → Resolve → Resume | P0 |
| INT-GW-004 | `test_threat_recording` | Airlock → DB → API | P0 |
| INT-GW-005 | `test_rate_limiting` | Multi-request rate limit | P0 |
| INT-GW-006 | `test_auth_middleware` | Full auth flow | P0 |
| INT-GW-007 | `test_cors_headers` | CORS headers correct | P1 |

## 5.2 Python Integration Tests

**Location**: `tests/integration/`

### 5.2.1 Worker Integration

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| INT-WK-001 | `test_worker_processes_job` | Job dequeue → execute → ack | P0 |
| INT-WK-002 | `test_worker_reports_result` | Result posted to gateway | P0 |
| INT-WK-003 | `test_worker_handles_policy_denial` | Denial reported correctly | P0 |
| INT-WK-004 | `test_worker_handles_approval` | Approval wait works | P0 |
| INT-WK-005 | `test_worker_handles_budget_kill` | Budget kill works | P0 |
| INT-WK-006 | `test_worker_graceful_shutdown` | In-flight jobs complete | P0 |

### 5.2.2 MCP Integration

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| INT-MC-001 | `test_mcp_server_lifecycle` | Start → call → stop | P0 |
| INT-MC-002 | `test_mcp_tool_execution` | Tool executes correctly | P0 |
| INT-MC-003 | `test_mcp_error_handling` | Tool errors handled | P0 |
| INT-MC-004 | `test_multiple_servers` | Multiple servers run | P1 |

### 5.2.3 Full Workflow Integration

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| INT-WF-001 | `test_linear_workflow` | A → B → C executes in order | P0 |
| INT-WF-002 | `test_parallel_workflow` | A → (B, C) → D executes | P0 |
| INT-WF-003 | `test_conditional_workflow` | Conditional branches work | P0 |
| INT-WF-004 | `test_approval_workflow` | Workflow pauses for approval | P0 |
| INT-WF-005 | `test_failure_recovery` | Failed step retries | P0 |
| INT-WF-006 | `test_timeout_workflow` | Timeout terminates workflow | P0 |

---

# 6. End-to-End Tests

## 6.1 Core User Journeys

### 6.1.1 Agent Run Journey

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| E2E-RUN-001 | `test_create_and_complete_run` | Full run from API to completion | P0 |
| E2E-RUN-002 | `test_run_with_tool_calls` | Run with multiple tool calls | P0 |
| E2E-RUN-003 | `test_run_with_approval` | Run pauses and resumes | P0 |
| E2E-RUN-004 | `test_run_budget_kill` | Run killed on budget exceed | P0 |
| E2E-RUN-005 | `test_run_policy_block` | Run blocked on denied tool | P0 |
| E2E-RUN-006 | `test_run_airlock_block` | Run blocked by Airlock | P0 |
| E2E-RUN-007 | `test_run_cancellation` | User cancels in-flight run | P0 |
| E2E-RUN-008 | `test_run_timeout` | Run times out | P0 |

### 6.1.2 Dashboard Journey

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| E2E-UI-001 | `test_view_runs_list` | Dashboard shows runs | P0 |
| E2E-UI-002 | `test_view_run_detail` | Run detail page works | P0 |
| E2E-UI-003 | `test_approve_from_dashboard` | Approve action works | P0 |
| E2E-UI-004 | `test_cancel_from_dashboard` | Cancel action works | P0 |
| E2E-UI-005 | `test_view_threats` | Threat list shows | P0 |
| E2E-UI-006 | `test_toggle_airlock_mode` | Mode toggle works | P0 |
| E2E-UI-007 | `test_real_time_updates` | Polling shows new data | P1 |

### 6.1.3 Multi-Tenant Journey

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| E2E-MT-001 | `test_tenant_isolation` | Tenants can't see each other's data | P0 |
| E2E-MT-002 | `test_tenant_rate_limits` | Each tenant has own limits | P0 |
| E2E-MT-003 | `test_tenant_policies` | Tenant policies apply | P0 |
| E2E-MT-004 | `test_cross_tenant_blocked` | Cross-tenant access denied | P0 |

## 6.2 Agent Scenarios

### 6.2.1 Safe PR Agent

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| E2E-PR-001 | `test_read_repo_files` | Agent reads repo files | P0 |
| E2E-PR-002 | `test_analyze_code` | Agent analyzes code | P0 |
| E2E-PR-003 | `test_propose_changes` | Agent proposes changes | P0 |
| E2E-PR-004 | `test_approval_for_write` | Write requires approval | P0 |
| E2E-PR-005 | `test_create_pr` | PR creation succeeds | P0 |
| E2E-PR-006 | `test_blocked_dangerous_action` | Dangerous action blocked | P0 |

---

# 7. API Contract Tests

## 7.1 OpenAPI Validation

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| API-VAL-001 | `validate_openapi_spec` | Spec is valid OpenAPI 3.0 | P0 |
| API-VAL-002 | `validate_all_endpoints_documented` | All routes in spec | P0 |
| API-VAL-003 | `validate_request_schemas` | Request schemas correct | P0 |
| API-VAL-004 | `validate_response_schemas` | Response schemas correct | P0 |
| API-VAL-005 | `validate_error_schemas` | Error responses documented | P1 |

## 7.2 Contract Compliance

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| API-CON-001 | `test_create_run_contract` | POST /v1/runs matches spec | P0 |
| API-CON-002 | `test_get_run_contract` | GET /v1/runs/{id} matches spec | P0 |
| API-CON-003 | `test_list_runs_contract` | GET /v1/runs matches spec | P0 |
| API-CON-004 | `test_error_format_contract` | Errors match spec format | P0 |
| API-CON-005 | `test_pagination_contract` | Pagination follows spec | P1 |

## 7.3 Backward Compatibility

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| API-BWC-001 | `test_v1_backward_compatible` | V1 API unchanged from baseline | P0 |
| API-BWC-002 | `test_deprecated_fields_work` | Deprecated fields still work | P1 |
| API-BWC-003 | `test_new_fields_optional` | New fields don't break old clients | P0 |

---

# 8. Security Tests

## 8.1 Authentication & Authorization

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| SEC-AUTH-001 | `test_unauthenticated_blocked` | No auth → 401 | P0 |
| SEC-AUTH-002 | `test_invalid_key_blocked` | Invalid key → 401 | P0 |
| SEC-AUTH-003 | `test_expired_key_blocked` | Expired key → 401 | P0 |
| SEC-AUTH-004 | `test_revoked_key_blocked` | Revoked key → 401 | P0 |
| SEC-AUTH-005 | `test_admin_only_endpoint` | Non-admin → 403 | P0 |
| SEC-AUTH-006 | `test_write_only_endpoint` | Read-only key → 403 | P0 |
| SEC-AUTH-007 | `test_tenant_isolation` | Cross-tenant → 404 | P0 |
| SEC-AUTH-008 | `test_brute_force_protection` | Rate limit on auth failures | P0 |

## 8.2 Policy Engine Security

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| SEC-POL-001 | `test_deny_by_default` | Unknown tool blocked | P0 |
| SEC-POL-002 | `test_policy_bypass_attempt` | Can't bypass with crafted input | P0 |
| SEC-POL-003 | `test_policy_injection` | Policy rules can't be injected | P0 |
| SEC-POL-004 | `test_concurrent_policy_changes` | Policy changes apply safely | P0 |

## 8.3 Airlock Security

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| SEC-AIR-001 | `test_rce_eval_blocked` | `eval()` blocked | P0 |
| SEC-AIR-002 | `test_rce_exec_blocked` | `exec()` blocked | P0 |
| SEC-AIR-003 | `test_rce_os_system_blocked` | `os.system()` blocked | P0 |
| SEC-AIR-004 | `test_rce_subprocess_blocked` | `subprocess.run()` blocked | P0 |
| SEC-AIR-005 | `test_rce_pickle_blocked` | `pickle.loads()` blocked | P0 |
| SEC-AIR-006 | `test_rce_import_blocked` | `__import__()` blocked | P0 |
| SEC-AIR-007 | `test_rce_base64_bypass` | Base64 encoded blocked | P0 |
| SEC-AIR-008 | `test_rce_unicode_bypass` | Unicode obfuscation blocked | P0 |
| SEC-AIR-009 | `test_rce_nested_json_blocked` | Nested in JSON blocked | P0 |
| SEC-AIR-010 | `test_exfil_unauthorized_domain` | Non-whitelist blocked | P0 |
| SEC-AIR-011 | `test_exfil_raw_ip` | Raw IP blocked | P0 |
| SEC-AIR-012 | `test_exfil_private_ip` | Private IP blocked | P0 |
| SEC-AIR-013 | `test_velocity_spend_limit` | Velocity limit enforced | P0 |
| SEC-AIR-014 | `test_velocity_loop_detection` | Loop detection triggers | P0 |
| SEC-AIR-015 | `test_shadow_mode_logs` | Shadow mode logs but allows | P0 |
| SEC-AIR-016 | `test_enforce_mode_blocks` | Enforce mode blocks | P0 |

## 8.4 Input Validation Security

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| SEC-INP-001 | `test_sql_injection_blocked` | SQL injection blocked | P0 |
| SEC-INP-002 | `test_nosql_injection_blocked` | NoSQL injection blocked | P0 |
| SEC-INP-003 | `test_xss_blocked` | XSS in input blocked | P0 |
| SEC-INP-004 | `test_path_traversal_blocked` | `../` blocked | P0 |
| SEC-INP-005 | `test_command_injection_blocked` | `; rm -rf /` blocked | P0 |
| SEC-INP-006 | `test_oversized_payload_rejected` | Large payload rejected | P0 |
| SEC-INP-007 | `test_malformed_json_rejected` | Bad JSON rejected | P1 |
| SEC-INP-008 | `test_null_byte_injection` | Null bytes blocked | P1 |

## 8.5 Audit Trail Security

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| SEC-AUD-001 | `test_audit_immutability` | Audit logs can't be modified | P0 |
| SEC-AUD-002 | `test_audit_completeness` | All actions logged | P0 |
| SEC-AUD-003 | `test_pii_redaction` | PII redacted in logs | P0 |
| SEC-AUD-004 | `test_audit_timestamp_integrity` | Timestamps are accurate | P0 |

## 8.6 OWASP LLM Top 10

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| SEC-LLM-001 | `test_llm01_prompt_injection` | Prompt injection mitigated | P0 |
| SEC-LLM-002 | `test_llm02_insecure_output` | Output validated before use | P0 |
| SEC-LLM-003 | `test_llm04_denial_of_service` | Budget limits prevent DoS | P0 |
| SEC-LLM-004 | `test_llm06_sensitive_disclosure` | PII redacted in outputs | P0 |
| SEC-LLM-005 | `test_llm07_insecure_plugin` | Tool policy prevents abuse | P0 |
| SEC-LLM-006 | `test_llm09_overreliance` | Approval gates for critical | P0 |

---

# 9. Performance Tests

## 9.1 Load Tests

| Test ID | Test Name | Description | Target |
|---------|-----------|-------------|--------|
| PERF-LD-001 | `test_concurrent_runs` | 100 concurrent runs | < 2s p95 |
| PERF-LD-002 | `test_sustained_throughput` | 50 runs/min for 10 min | Stable |
| PERF-LD-003 | `test_burst_traffic` | 200 runs in 10s | No errors |
| PERF-LD-004 | `test_large_payload` | 1MB input JSON | < 5s |
| PERF-LD-005 | `test_many_steps` | Run with 100 steps | < 30s |

## 9.2 Latency Tests

| Test ID | Test Name | Description | Target |
|---------|-----------|-------------|--------|
| PERF-LAT-001 | `test_create_run_latency` | POST /v1/runs | < 100ms p95 |
| PERF-LAT-002 | `test_get_run_latency` | GET /v1/runs/{id} | < 50ms p95 |
| PERF-LAT-003 | `test_policy_check_latency` | Policy evaluation | < 10ms p95 |
| PERF-LAT-004 | `test_airlock_latency` | Airlock inspection | < 5ms p95 |
| PERF-LAT-005 | `test_queue_enqueue_latency` | Redis enqueue | < 5ms p95 |
| PERF-LAT-006 | `test_queue_dequeue_latency` | Redis dequeue | < 10ms p95 |

## 9.3 Benchmark Tests

| Test ID | Test Name | Description | Metric |
|---------|-----------|-------------|--------|
| PERF-BM-001 | `bench_policy_evaluation` | Policy engine throughput | ops/sec |
| PERF-BM-002 | `bench_airlock_rce_check` | RCE pattern matching | ops/sec |
| PERF-BM-003 | `bench_pii_redaction` | Redaction throughput | MB/sec |
| PERF-BM-004 | `bench_id_generation` | ULID generation | ops/sec |
| PERF-BM-005 | `bench_json_serialization` | JSON roundtrip | ops/sec |

## 9.4 Scalability Tests

| Test ID | Test Name | Description | Target |
|---------|-----------|-------------|--------|
| PERF-SC-001 | `test_horizontal_worker_scale` | Add workers dynamically | Linear speedup |
| PERF-SC-002 | `test_database_connection_pool` | Pool under load | No exhaustion |
| PERF-SC-003 | `test_redis_memory` | Memory under sustained load | < 1GB |
| PERF-SC-004 | `test_many_tenants` | 1000 tenants | No degradation |

---

# 10. Chaos Engineering Tests

## 10.1 Failure Injection

| Test ID | Test Name | Description | Expected Behavior |
|---------|-----------|-------------|-------------------|
| CHAOS-001 | `test_database_unavailable` | Kill Postgres | Gateway returns 503, queued jobs wait |
| CHAOS-002 | `test_redis_unavailable` | Kill Redis | Gateway queues fail gracefully |
| CHAOS-003 | `test_worker_crash` | Kill worker mid-job | Job redelivered to another worker |
| CHAOS-004 | `test_gateway_restart` | Restart gateway | In-flight requests fail, retried |
| CHAOS-005 | `test_network_partition` | Block worker ↔ gateway | Worker reconnects |
| CHAOS-006 | `test_slow_database` | Add 500ms latency | Timeout handling |
| CHAOS-007 | `test_full_disk` | Fill disk | Graceful degradation |
| CHAOS-008 | `test_memory_pressure` | Limit memory | OOM handling |

## 10.2 Recovery Tests

| Test ID | Test Name | Description | Expected Behavior |
|---------|-----------|-------------|-------------------|
| CHAOS-R-001 | `test_database_recovery` | Postgres restarts | Connections restored |
| CHAOS-R-002 | `test_redis_recovery` | Redis restarts | Queue resumes |
| CHAOS-R-003 | `test_worker_recovery` | Worker restarts | Pending jobs processed |
| CHAOS-R-004 | `test_partial_failure` | 1 of 3 workers fails | Remaining handle load |

---

# 11. UI/Frontend Tests

## 11.1 Component Rendering

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-RND-001 | `test_app_shell_renders` | Main layout renders | P0 |
| UI-RND-002 | `test_sidebar_renders` | Sidebar with navigation | P0 |
| UI-RND-003 | `test_all_pages_render` | Each page renders without error | P0 |
| UI-RND-004 | `test_error_boundary` | Errors caught by boundary | P0 |
| UI-RND-005 | `test_loading_states` | Loading skeletons shown | P1 |

## 11.2 User Interactions

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-INT-001 | `test_navigation_works` | Click sidebar navigates | P0 |
| UI-INT-002 | `test_form_submission` | Forms submit correctly | P0 |
| UI-INT-003 | `test_modal_open_close` | Modals open and close | P1 |
| UI-INT-004 | `test_toast_notifications` | Toasts appear correctly | P1 |
| UI-INT-005 | `test_keyboard_navigation` | Tab order correct | P2 |

## 11.3 Accessibility

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-A11Y-001 | `test_aria_labels` | All interactive elements labeled | P1 |
| UI-A11Y-002 | `test_color_contrast` | Contrast ratio meets WCAG | P1 |
| UI-A11Y-003 | `test_screen_reader` | Screen reader can navigate | P2 |
| UI-A11Y-004 | `test_focus_visible` | Focus indicators visible | P2 |

## 11.4 Responsive Design

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| UI-RSP-001 | `test_mobile_layout` | Works on 320px width | P1 |
| UI-RSP-002 | `test_tablet_layout` | Works on 768px width | P1 |
| UI-RSP-003 | `test_desktop_layout` | Works on 1280px width | P0 |
| UI-RSP-004 | `test_sidebar_collapse` | Sidebar collapses on mobile | P1 |

---

# 12. Database Tests

## 12.1 Migration Tests

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| DB-MIG-001 | `test_fresh_migration` | Fresh DB migrates | P0 |
| DB-MIG-002 | `test_incremental_migration` | Each migration applies | P0 |
| DB-MIG-003 | `test_rollback` | Migrations can rollback | P1 |
| DB-MIG-004 | `test_idempotent` | Migrations are idempotent | P0 |
| DB-MIG-005 | `test_data_preservation` | Data survives migration | P0 |

## 12.2 Data Integrity

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| DB-INT-001 | `test_foreign_key_constraints` | FK constraints enforced | P0 |
| DB-INT-002 | `test_unique_constraints` | Unique constraints enforced | P0 |
| DB-INT-003 | `test_check_constraints` | Check constraints enforced | P0 |
| DB-INT-004 | `test_not_null_constraints` | NOT NULL enforced | P0 |
| DB-INT-005 | `test_enum_values` | Enums only accept valid values | P0 |

## 12.3 Query Performance

| Test ID | Test Name | Description | Target |
|---------|-----------|-------------|--------|
| DB-QRY-001 | `test_run_lookup_indexed` | Run lookup uses index | < 1ms |
| DB-QRY-002 | `test_threat_query_indexed` | Threat query uses index | < 5ms |
| DB-QRY-003 | `test_list_query_efficient` | List queries are efficient | < 50ms |
| DB-QRY-004 | `test_no_full_table_scan` | No full table scans | EXPLAIN |

---

# 13. Queue & Messaging Tests

## 13.1 Redis Streams

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| QUE-STR-001 | `test_stream_creation` | Stream auto-created | P0 |
| QUE-STR-002 | `test_message_ordering` | Messages in order | P0 |
| QUE-STR-003 | `test_consumer_groups` | Consumer groups work | P0 |
| QUE-STR-004 | `test_message_acknowledgment` | Ack removes from pending | P0 |
| QUE-STR-005 | `test_pending_timeout` | Pending messages timeout | P0 |
| QUE-STR-006 | `test_claim_pending` | Timed-out messages claimed | P0 |

## 13.2 Message Handling

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| QUE-MSG-001 | `test_message_serialization` | Messages serialize correctly | P0 |
| QUE-MSG-002 | `test_large_message` | Large messages handled | P1 |
| QUE-MSG-003 | `test_message_deduplication` | Duplicate messages handled | P1 |
| QUE-MSG-004 | `test_dead_letter_queue` | Failed messages to DLQ | P1 |

---

# 14. Evaluation Framework Tests

## 14.1 Suite Execution

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| EVL-STE-001 | `test_smoke_suite_runs` | Smoke suite completes | P0 |
| EVL-STE-002 | `test_regression_suite_runs` | Regression suite completes | P0 |
| EVL-STE-003 | `test_custom_suite` | Custom suite loads | P1 |
| EVL-STE-004 | `test_suite_filtering` | Task filtering works | P1 |

## 14.2 Scoring

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| EVL-SCR-001 | `test_score_aggregation` | Scores aggregate correctly | P0 |
| EVL-SCR-002 | `test_weighted_scoring` | Weights apply correctly | P1 |
| EVL-SCR-003 | `test_pass_threshold` | Threshold determines pass/fail | P0 |
| EVL-SCR-004 | `test_scorer_errors` | Scorer errors handled | P1 |

## 14.3 Reporting

| Test ID | Test Name | Description | Priority |
|---------|-----------|-------------|----------|
| EVL-RPT-001 | `test_json_report` | JSON report generated | P0 |
| EVL-RPT-002 | `test_report_completeness` | Report has all fields | P0 |
| EVL-RPT-003 | `test_regression_comparison` | Compare with baseline | P1 |
| EVL-RPT-004 | `test_ci_summary` | GitHub summary generated | P1 |

---

# 15. Test Data Management

## 15.1 Fixtures

### Rust Fixtures

```rust
// In test module
fn create_test_run() -> Run {
    Run {
        id: RunId::new(),
        status: RunStatus::Created,
        input: json!({"task": "test"}),
        // ...
    }
}

fn create_test_policy() -> ToolAllowlist {
    ToolAllowlist {
        allowed_tools: vec!["read_file".into()],
        approval_required: vec!["write_file".into()],
        denied_tools: vec!["delete_file".into()],
    }
}
```

### Python Fixtures

```python
# In conftest.py
@pytest.fixture
def sample_run():
    return {
        "id": "run_01HGXK...",
        "status": "created",
        "input": {"task": "test"},
    }

@pytest.fixture
def mock_gateway(httpx_mock):
    httpx_mock.add_response(
        url="http://localhost:8080/v1/runs",
        json={"id": "run_01HGXK..."},
    )
    yield httpx_mock
```

## 15.2 Test Database

```bash
# Setup test database
createdb ferrumdeck_test

# Run with test database
DATABASE_URL=postgres://localhost/ferrumdeck_test cargo test

# Cleanup
dropdb ferrumdeck_test
```

## 15.3 Mock Data Generation

```python
from faker import Faker
fake = Faker()

def generate_run():
    return {
        "id": f"run_{fake.uuid4()[:8]}",
        "agent_id": f"agt_{fake.uuid4()[:8]}",
        "input": {"task": fake.sentence()},
    }
```

---

# 16. CI/CD Integration

## 16.1 GitHub Actions Workflow

```yaml
name: Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Rust tests
        run: cargo test --workspace
      - name: Python tests
        run: uv run pytest python/packages/

  integration-tests:
    needs: unit-tests
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
      redis:
        image: redis:7-alpine
    steps:
      - uses: actions/checkout@v4
      - name: Run integration tests
        run: make test-integration

  e2e-tests:
    needs: integration-tests
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Start services
        run: make quickstart &
      - name: Run E2E tests
        run: make test-e2e

  security-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Security scan
        run: make security-scan
```

## 16.2 Test Commands

```bash
# Unit tests only
make test-unit

# Integration tests
make test-integration

# E2E tests
make test-e2e

# Security tests
make test-security

# Performance tests
make test-perf

# All tests
make test-all

# With coverage
make test-coverage
```

## 16.3 Coverage Requirements

| Component | Minimum Coverage |
|-----------|-----------------|
| fd-policy | 90% |
| fd-core | 85% |
| fd-storage | 80% |
| fd-worker | 85% |
| Gateway handlers | 80% |
| Dashboard components | 70% |

---

# 17. Test Execution Matrix

## 17.1 When to Run

| Test Type | PR | Merge | Nightly | Release |
|-----------|----|----|---------|---------|
| Unit | ✓ | ✓ | ✓ | ✓ |
| Integration | ✓ | ✓ | ✓ | ✓ |
| E2E | - | ✓ | ✓ | ✓ |
| Security | ✓ | ✓ | ✓ | ✓ |
| Performance | - | - | ✓ | ✓ |
| Chaos | - | - | Weekly | ✓ |

## 17.2 Test Environments

| Environment | Database | Redis | Workers |
|-------------|----------|-------|---------|
| Local | SQLite/Postgres | Local | 1 |
| CI | Postgres container | Redis container | 1 |
| Staging | Managed Postgres | Managed Redis | 2 |
| Production | Managed Postgres | Managed Redis | 3+ |

## 17.3 Parallelization

```bash
# Rust tests (parallel by default)
cargo test --workspace -j $(nproc)

# Python tests
pytest -n auto  # pytest-xdist

# E2E tests (sequential)
pytest tests/e2e/ -n 1
```

---

# Appendix: Test Case Catalog

## Summary Statistics

| Category | Count | Priority P0 | Priority P1 | Priority P2 |
|----------|-------|-------------|-------------|-------------|
| **fd-core** | 21 | 12 | 7 | 2 |
| **fd-policy** | 68 | 48 | 16 | 4 |
| **fd-storage** | 24 | 15 | 8 | 1 |
| **fd-audit** | 15 | 8 | 6 | 1 |
| **fd-dag** | 10 | 6 | 4 | 0 |
| **Gateway** | 39 | 25 | 13 | 1 |
| **Python** | 58 | 40 | 16 | 2 |
| **Frontend** | 42 | 20 | 18 | 4 |
| **Integration** | 32 | 24 | 8 | 0 |
| **E2E** | 25 | 20 | 5 | 0 |
| **Security** | 52 | 48 | 4 | 0 |
| **Performance** | 20 | 8 | 8 | 4 |
| **Chaos** | 12 | 8 | 4 | 0 |
| **Database** | 14 | 10 | 4 | 0 |
| **Queue** | 10 | 8 | 2 | 0 |
| **Evals** | 12 | 8 | 4 | 0 |
| **TOTAL** | **454** | **308** | **127** | **19** |

## Test ID Convention

```
<CATEGORY>-<COMPONENT>-<NUMBER>

Categories:
- CORE: fd-core crate
- POL: fd-policy crate
- AIR: Airlock subsystem
- STO: fd-storage crate
- AUD: fd-audit crate
- DAG: fd-dag crate
- GW: Gateway service
- PY: Python packages
- UI: Frontend tests
- INT: Integration tests
- E2E: End-to-end tests
- SEC: Security tests
- PERF: Performance tests
- CHAOS: Chaos engineering
- DB: Database tests
- QUE: Queue tests
- EVL: Evaluation framework
- API: API contract tests
```

---

## Appendix: Test Implementation Checklist

### Phase 1: Foundation (Week 1-2)
- [ ] Set up test infrastructure
- [ ] Configure CI/CD pipelines
- [ ] Create test fixtures and utilities
- [ ] Implement all P0 unit tests

### Phase 2: Integration (Week 3-4)
- [ ] Database integration tests
- [ ] Redis integration tests
- [ ] Worker integration tests
- [ ] API contract tests

### Phase 3: E2E & Security (Week 5-6)
- [ ] E2E user journey tests
- [ ] All security tests
- [ ] Frontend component tests
- [ ] Hook tests

### Phase 4: Performance & Chaos (Week 7-8)
- [ ] Load tests
- [ ] Latency benchmarks
- [ ] Chaos engineering tests
- [ ] Recovery tests

### Phase 5: Completion (Week 9-10)
- [ ] P1 and P2 tests
- [ ] Coverage analysis
- [ ] Documentation
- [ ] Training

---

*This testing plan is a living document and should be updated as the system evolves.*
