# Runbook: Champion-Challenger Promotion Gate

## Overview

A registered model / prompt / tool **version** (the *challenger*) cannot
replace the live version (the *champion*) until it clears a deterministic
**promotion gate**:

1. a set of configurable **metric thresholds** (inclusive floors), and
2. a required **human approval**.

Until both are satisfied the challenger stays in **shadow** (deny-by-default).
The decision and its metric evidence are written to the **immutable audit
trail** through the same `fd_policy::PolicyDecision` channel every other gate
uses — there is no parallel decision channel and no parallel store.

## Decision table

| State | `PolicyDecisionKind` | `PromotionStatus` |
| --- | --- | --- |
| No thresholds configured | `Deny` | `denied` (stays shadow) |
| Any threshold fails / metric missing | `Deny` | `denied` (stays shadow) |
| All thresholds pass, approval required but absent | `RequiresApproval` | `awaiting_approval` |
| All thresholds pass, approval satisfied (or not required) | `Allow` | `promoted` |

A missing metric is a **hard fail** — the gate never assumes an unreported
metric succeeded. The metric floor is **inclusive** (`measured >= min_value`).

## API

| Method | Path | Scope | Description |
| --- | --- | --- | --- |
| `POST` | `/v1/promotions/evaluate` | **write** | Evaluate a challenger against the gate; writes the decision + evidence to the audit trail. |
| `GET` | `/v1/promotions/{agent_id}` | read (authenticated) | Promotion history for an agent (champion vs challenger + gate status), newest-first. |

### Evaluate request

```json
{
  "agent_id": "agt_...",
  "champion_version_id": "agv_champion",
  "challenger_version_id": "agv_challenger",
  "thresholds": [
    { "name": "eval_pass_rate", "min_value": 0.90 },
    { "name": "bench_trust_score", "min_value": 0.70 }
  ],
  "require_human_approval": true,
  "metrics": { "eval_pass_rate": 0.96, "bench_trust_score": 0.82 },
  "approval_present": true
}
```

### Decision response

The response (and each audit row's `details`) carries the structured
`PromotionDecision`: `id`, `agent_id`, `champion_version_id`,
`challenger_version_id`, `decision_kind`, `status`, `reason`,
`metric_evidence[]` (name / floor / measured / passed), `approval_present`,
`approval_required`, `content_hash` (SHA-256 tamper-evidence), `decided_at`,
`anchor`.

## Audit trail

Decisions are written with `action = "promotion.decided"` and
`resource_id = <agent_id>`. Read them back via
`AuditRepo::list_promotion_decisions(agent_id, limit)` or the
`GET /v1/promotions/{agent_id}` endpoint. The `content_hash` lets an auditor
verify a row was not tampered after the fact
(`PromotionDecision::verify_hash`).

## Deployment checklist — auth-scope wiring

This feature adds **two** routes that need scope wiring at deploy time. Both
are already wired in `rust/services/gateway/src/routes.rs`; the checklist
below is what an operator verifies when promoting the gateway:

- [ ] `POST /v1/promotions/evaluate` sits **inside** the `require_write()`
  middleware block (it mutates the live champion binding). Confirm the
  caller's API key / JWT carries the `write` (or `admin`) scope.
- [ ] `GET /v1/promotions/{agent_id}` is in the authenticated read block
  (any authenticated tenant with project access; enforced by
  `auth.can_access_project`).
- [ ] No new database migration is required — decisions live in the existing
  `audit_events` table.
- [ ] The dashboard BFF route `/api/v1/promotions/[agentId]` proxies the
  gateway read endpoint; it returns an empty decision list (not a 5xx) when
  the gateway is unreachable, so the panel degrades gracefully.
- [ ] Issue / rotate API keys for any CI system that calls
  `POST /v1/promotions/evaluate` with the `write` scope (e.g. a release
  pipeline that promotes a challenger after the eval suite passes).

## Operational notes

- **Default is deny.** A freshly registered version is `shadow` and serves no
  traffic until it is explicitly promoted.
- **Empty thresholds never auto-promote.** A gate with no thresholds denies —
  configure at least one floor before wiring a CI promotion.
- **First promotion has no champion.** `champion_version_id` is optional; the
  very first promotion for an agent records `None`.
- **The eval suite is the source of metrics.** Wire the release pipeline to
  run the fd-evals suite, collect `eval_pass_rate` / `bench_trust_score` /
  etc., then POST them to `/v1/promotions/evaluate`. The deterministic eval
  `test_promotion_gate.py` pins the below-threshold-denied and
  above-threshold-promoted behaviour.
