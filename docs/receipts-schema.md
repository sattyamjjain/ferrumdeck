# Receipts Schema

> FerrumDeck's audit-record shape, exposed as a receipts substrate compatible
> with [Foundation Protocol][fp] (Mila + MetaGPT, 22 May 2026).

[fp]: https://arxiv.org/abs/2605.23218

## What this is

FerrumDeck already maintains an append-only audit log of every governance
decision the control plane makes — policy verdicts, approval gates, budget
breaches, tool dispatches, run lifecycle events. This document names that log
as a **receipts substrate**: a stable, versioned wire shape that downstream
consumers can rely on without scraping the dashboard or replaying
Postgres-internal projections. It is intentionally written *before* the
companion `fd-receipts` crate is built, so the API contract is fixed in prose
and protected by a schema-drift regression before the export wiring lands. The
audit log itself is unchanged — this document is naming, not migration.

## Existing shape (verified v0.1.0)

The canonical struct lives in
[`rust/crates/fd-audit/src/event.rs:9-19`](../rust/crates/fd-audit/src/event.rs):

```rust
pub struct AuditEvent {
    pub id: AuditEventId,
    pub timestamp: DateTime<Utc>,
    pub tenant_id: TenantId,
    pub kind: AuditEventKind,
    pub actor: AuditActor,
    pub resource: AuditResource,
    pub action: String,
    pub outcome: AuditOutcome,
    pub metadata: serde_json::Value,
}
```

Field semantics — every field below is part of the schema contract from this
point forward; a change without a corresponding `audit_record_schema.golden.json`
update fails the regression test in CI:

| Field         | Semantics                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------|
| `id`          | ULID-based, time-sortable `aud_*` identifier; unique per record, immutable.                     |
| `timestamp`   | Server-generated wall-clock UTC instant of when the record was created. Never client-supplied. |
| `tenant_id`   | Multi-tenant boundary key (`ten_*`); every record is namespaced to a tenant.                    |
| `kind`        | Tagged enum (`AuditEventKind`) — `run_*`, `step_*`, `policy_decision`, `approval_*`, `budget_exceeded`, `tool_*`, `api_key_*`, `custom`. Serde-tagged with `type` discriminator. |
| `actor`       | Tagged enum (`AuditActor`) — `system`, `user{user_id}`, `api_key{key_id}`, `agent{agent_id,run_id}`. Identifies *who* caused the event. |
| `resource`    | `{resource_type, resource_id}` pair — the thing the event is about (a run, a step, a tool…).    |
| `action`      | Short snake-case verb string (`policy.denied`, `run.created`, `tool.invoked`). The closest field to an FP "event type" string. |
| `outcome`     | `success` \| `failure` \| `pending` — the terminal status of the action.                        |
| `metadata`    | Open-shape `serde_json::Value` carrying decision-specific context (policy reason, budget axis, redacted tool args, etc.). PII redaction is applied at insert time by `fd_audit::redaction`. |

The on-disk persistence projection in
[`rust/crates/fd-storage/src/models/audit.rs`](../rust/crates/fd-storage/src/models/audit.rs)
is a denormalised flattening of this same struct for SQLx and is *not* a
separate schema — it is the persistence shim. The wire contract is the
`fd-audit` shape above.

## Foundation-Protocol mapping

Foundation Protocol decomposes any agent-economy interaction into a fixed set
of **event-substrate primitives**: metering (resource consumption), receipts
(immutable provenance of a single interaction), settlement (downstream
billing / clearing), policy (the rule that gated the action), provenance (who
acted on what), and audit (the durable trail itself). The table below maps
each `AuditEvent` field onto these primitives so an FP-aware consumer can
project the FerrumDeck stream into FP's expected shape without re-modelling.

| ferrumdeck field                                  | FP event-substrate primitive                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `id`                                              | **receipt** — unique receipt id; FP's `receipt.id` maps directly.                              |
| `timestamp`                                       | **receipt** — `receipt.issued_at`; UTC instant is FP's required format.                        |
| `tenant_id`                                       | **provenance** — `provenance.tenant`; multi-tenant scoping is an FP-first-class field.         |
| `kind` (enum discriminator + payload)             | **audit** / **policy** — the discriminator names the audit subtype (FP `audit.kind`); for `policy_decision` / `approval_*` variants, the inner payload (`allowed`, `approver`) projects onto FP's `policy` primitive. |
| `actor`                                           | **provenance** — `provenance.actor`; FP's actor union has `system / human / api_key / agent` slots that match 1:1. |
| `resource`                                        | **provenance** — `provenance.subject`; FP's `{type, id}` pair is the same shape.               |
| `action`                                          | **audit** — `audit.action`; FP recommends `noun.verb` strings, which is the convention already used (`run.created`, `policy.denied`). |
| `outcome`                                         | **audit** — `audit.outcome`; FP's three-state enum (`ok / fail / pending`) matches our `success / failure / pending`. |
| `metadata.cost_cents` / `metadata.tokens_*` (when set) | **metering** — when the recorded kind carries cost or token counts (e.g. `step_completed` for an LLM step, `budget_exceeded`), the relevant `metadata` keys project onto FP's `metering` primitive. |
| `metadata.policy_decision_id` / `metadata.trace`  | **policy** — when the audit kind is `policy_decision`, the policy `DecisionTrace` lives under `metadata` and projects onto FP's `policy.trace`. |
| `metadata.airlock_violations`                     | **policy** — Airlock RASP violations attached as policy-substrate detail.                      |
| `metadata` (all other keys)                       | **FerrumDeck-specific (out of FP scope)** — runtime context FerrumDeck preserves for forensics that has no FP counterpart (e.g. internal request ids, dashboard breadcrumbs). Surfaced verbatim under FP's free-form `extensions` slot. |
| **(not in FerrumDeck)**                          | **settlement** — **FerrumDeck-specific (out of FP scope)**: settlement is an explicit non-goal for the control plane. FP consumers that need settlement build it from `metering` + their own pricing tables. The audit log carries the metering inputs but does not clear them. |

The mapping is intentionally narrow — every audit field has a single dominant
FP primitive, and the `metadata` envelope is the only place we project into
two (audit + extensions). This keeps the schema legible to an FP consumer and
prevents accidental coupling: future control-plane fields can be added to
`metadata` without renegotiating the FP contract.

## Wrapping vs replacing

FP's stated stance is to **wrap and bridge existing protocols rather than
replace them** — FP is an event substrate, not a competitor to whatever
already produces the events. FerrumDeck takes the same position: it is the
*producer* of audit records, and FP is *one possible downstream consumer*. So
is [mnemo][mnemo] (a memory / replay-substrate alternative), and so is anything
else that wants an immutable provenance feed (a SIEM, a billing aggregator, an
external compliance archive). The receipts substrate published here is the
producer-side wire shape; mapping documents like the table above are the only
thing a new consumer needs in order to integrate. We do not gate
FerrumDeck's audit log on FP adoption, and we do not coerce FP's vocabulary
back into FerrumDeck's internal types.

[mnemo]: https://github.com/mnemo-project/mnemo

## Per-call p95 budget

> **TODO** — write-path overhead for a single `AuditEvent` is currently
> instrumented only via OpenTelemetry's per-span timing (every audit insert
> sits inside the request span that produced it), with no dedicated histogram.
> The agreed budget target is **p95 ≤ 5 ms** for the
> `fd_audit::AuditEvent::new() → fd_storage::AuditRepository::insert()` path
> (ULID generation + serde-JSON metadata roundtrip + single Postgres insert).
> A criterion bench plus a per-insert OTel metric (`fd.audit.insert.duration`)
> will land alongside the `fd-receipts` crate (deferred per the follow-up PR
> referenced in this PR's CHANGELOG entry) so the receipts export does not
> regress this budget. Recording the target here, in the receipts contract,
> is what makes the bench actionable: any change to the audit shape, the
> redaction path, or the storage adapter must keep the p95 under 5 ms or
> explicitly negotiate a new ceiling.
