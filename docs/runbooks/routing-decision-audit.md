# Routing-decision audit (multi-agent coordination)

> Anchor: **AgensFlow — Auditable, Replayable Multi-Agent Coordination**,
> [arXiv:2605.27466](https://arxiv.org/abs/2605.27466).

## What it records

Every time the workflow orchestrator binds a coordination subtask to a
concrete agent / role / model, the Rust governance plane writes a
`RoutingDecision` audit record to the existing immutable audit trail. Each
record captures:

| Field | Semantics |
| --- | --- |
| `id` | `rtg_*` ULID; unique per record. |
| `run_id` | Workflow run the decision belongs to. |
| `subtask_id` | DAG step id this decision bound. |
| `candidates[]` | Every candidate the orchestrator considered, in evaluation order — role + optional `agent_id` + model + optional score. |
| `chosen` | The candidate that won — role + optional `agent_id` + model. |
| `reason` | `{code, detail}` — the machine-readable reason code (`policy_match` / `budget_within_limits` / `approval_gate` / `skip` / `fallback_default`) plus an operator-readable explanation. |
| `content_hash` | SHA-256 over a stable JSON projection of the structural fields. Used by replays to detect coordination drift. |
| `decided_at` | Wall-clock UTC stamp. |
| `anchor` | `arXiv:2605.27466`. |

The record is written through the same path every other audit event uses —
`Repos::spawn_audit(event)` → `AuditRepo::create(event)` →
`audit_events` table — so there is no parallel store, no new exporter, no
behaviour change to runs that don't use multi-agent coordination.

## Existing API (verified)

**Audit writer** (`fd-storage::repos::AuditRepo` +
`fd-storage::models::audit::AuditEventBuilder`):

```rust
let event = AuditEventBuilder::new(action, resource_type)
    .actor(actor_type, Some(actor_id))
    .resource_id(&id).tenant(tenant_id).project(&project_id).run(&run_id)
    .details(serde_json::json!({...}))
    .build();
repos.spawn_audit(event);   // fire-and-forget into `audit_events`
// Queryable: AuditRepo::list_by_run(run_id) → Vec<AuditEvent>
// New projection: AuditRepo::list_routing_decisions(run_id)
```

**Dispatch site** (`gateway::handlers::orchestrator::create_and_enqueue_step`):

```rust
async fn create_and_enqueue_step(
    &self, run_id: &str,
    step: &StepDefinition,            // step.config carries role/model
    project_id: &str, tenant_id: &str,
    _input: &serde_json::Value,
) -> Result<String, ApiError>
```

The orchestrator now calls `self.record_routing_decision(...)` immediately
after the step is created + enqueued, so every dispatched subtask emits
exactly one routing-decision audit row.

## Action / resource keys

`fd-storage::models::audit`:

```rust
pub const ROUTING_DECIDED: &str = "routing.decided";   // action filter
pub const ROUTING_DECISION: &str = "routing_decision"; // resource type
```

## Read endpoint

```
GET /v1/runs/{run_id}/routing → RoutingResponse
```

utoipa-documented; returns the chain ordered oldest → newest. Each entry
deserialises via `RoutingDecision::from_audit_details(&event.details)`;
malformed rows are skipped with a `warn` log so a single bad row never
prevents the rest of the chain from rendering.

## SSE event

The BFF mock generator emits `routing.decision.recorded` on the per-run
channel `run:{run_id}` so the dashboard's wire shape is locked in ahead of
the gateway → BFF push wiring (same lock-first pattern as
`policy.decision.explained`, `run.forecast.updated`, and the SchemaDriftGuard
surface). The payload matches `RoutingDecisionResponse` plus a `run_id` /
`at` envelope.

## Replay

`fd_evals.routing` exposes the Python projection:

- `RoutingDecision.from_audit_details(details)` parses a single decision.
- `extract_chain_from_audit(audit_events)` filters by
  `action == "routing.decided"` and parses every match.
- `verify_chain(decisions, expected_subtask_ids=...)` returns a
  `RoutingChainReport` with `is_complete` (every expected subtask present)
  and `is_hash_consistent` (every decision's stored hash matches the
  recomputed projection).

The Python `RoutingDecision.expected_hash` produces the SHA-256 of the same
JSON projection the Rust `compute_content_hash` writes — field order, field
selection, and JSON-encoding behaviour all match byte-for-byte. The
contract is pinned at both ends:

- Rust integration test:
  `rust/crates/fd-policy/tests/routing_hash_export.rs::fixture_hash_is_pinned`
- Python coverage test:
  `python/packages/fd-evals/tests/test_routing_decision_chain.py::TestCrossPlaneHash::test_python_hash_matches_rust_pin`
- Pinned digest:
  `b24284a106e28a41f408a96694ca410772719bc9d5dcc23f629707c75dfe4410`

A hash mismatch on either side fails CI and the maintainer must renegotiate
both sides + the runbook in a single commit.

## Anti-pivot guarantees

- **Dual-plane split preserved.** The record originates in the Rust
  governance plane; the Python data plane and the Next.js dashboard consume
  it without ever owning it.
- **MCP unchanged.** Tool dispatch still goes through MCP — this audit
  layer sits one level up at the *coordination* boundary.
- **OTel / Jaeger / GenAI semconv intact.** No new span attribute keys are
  added; the routing record is an audit-table artefact, not a tracing
  primitive.
- **No new store.** The records live in the same `audit_events` table
  every other audit row uses. The read path is a filter on `action`.
- **Schema renegotiation is loud.** Any change to the
  `RoutingDecision` shape changes the SHA-256 hash, which both the Rust
  unit test and the Python cross-plane test catch immediately.
