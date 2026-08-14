# OpenTelemetry GenAI mapping

Generated from `observability/genai_mapping.py`. Do not edit by hand.

## What this is, and what it is not

FerrumDeck emits its audit and eval records with OpenTelemetry GenAI attribute names **where an equivalent exists**, keeping every native `ferrumdeck.*` field alongside rather than replacing it.

**This is a mapping, not a conformance claim.** The GenAI semantic conventions describe model calls. Most of what FerrumDeck records is an *enforcement decision* about a call, which those conventions have no vocabulary for. The gaps below are real and are listed rather than papered over.

- Audit events: **7 of 23** native fields have a GenAI equivalent.
- Eval results: **4 of 16** native fields have a GenAI equivalent.

The unmapped remainder is the governance surface: policy decision kind, Airlock layer and risk score, the R1-R3 reversibility rung, hash-chain links and checkpoint anchors, budget leases, and AP2 mandates. None of these has an OTel GenAI name today.

## Audit events (`fd_audit::AuditEvent`)

| Native field | Emitted as | OTel GenAI equivalent | Note |
| --- | --- | --- | --- |
| `id` | `ferrumdeck.audit.id` | **none today** | Audit-event ULID. No GenAI equivalent; not a span id. |
| `timestamp` | `ferrumdeck.audit.timestamp` | **none today** | Carried by the span/log record timestamp itself. |
| `tenant_id` | `ferrumdeck.audit.tenant_id` | **none today** | Multi-tenancy is outside the GenAI conventions. |
| `kind` | `ferrumdeck.audit.kind` | `gen_ai.operation.name` | Mapped only for model/tool-shaped kinds; governance kinds keep the native value too. |
| `actor` | `ferrumdeck.audit.actor` | **none today** | Enforcement actor (agent, human approver, system). No equivalent. |
| `resource` | `ferrumdeck.audit.resource` | **none today** | Governed resource identity. No equivalent. |
| `action` | `ferrumdeck.audit.action` | `gen_ai.tool.name` | Only when the action is a tool invocation. |
| `outcome` | `ferrumdeck.audit.outcome` | **none today** | allow / deny / require_approval. No GenAI equivalent. |
| `trace_id` | `ferrumdeck.audit.trace_id` | **none today** | Already the W3C trace id; belongs to trace context, not gen_ai.*. |
| `trace_sampled` | `ferrumdeck.audit.trace_sampled` | **none today** | W3C sampled flag; trace context, not gen_ai.*. |
| `metadata.model` | `ferrumdeck.audit.metadata.model` | `gen_ai.request.model` | Model requested for the governed call. |
| `metadata.response_model` | `ferrumdeck.audit.metadata.response_model` | `gen_ai.response.model` | Model that actually answered. |
| `metadata.input_tokens` | `ferrumdeck.audit.metadata.input_tokens` | `gen_ai.usage.input_tokens` | Direct equivalent. |
| `metadata.output_tokens` | `ferrumdeck.audit.metadata.output_tokens` | `gen_ai.usage.output_tokens` | Direct equivalent. |
| `metadata.tool_call_id` | `ferrumdeck.audit.metadata.tool_call_id` | `gen_ai.tool.call_id` | Direct equivalent. |
| `metadata.policy_decision` | `ferrumdeck.audit.metadata.policy_decision` | **none today** | Deny-by-default decision kind. No equivalent. |
| `metadata.airlock_layer` | `ferrumdeck.audit.metadata.airlock_layer` | **none today** | Which RASP layer fired (-1..3). No equivalent. |
| `metadata.risk_score` | `ferrumdeck.audit.metadata.risk_score` | **none today** | Airlock risk score 0-100. No equivalent. |
| `metadata.reversibility` | `ferrumdeck.audit.metadata.reversibility` | **none today** | R1-R3 reversibility rung. No equivalent. |
| `metadata.chain_hash` | `ferrumdeck.audit.metadata.chain_hash` | **none today** | Hash-chain link for tamper evidence. No equivalent. |
| `metadata.checkpoint_id` | `ferrumdeck.audit.metadata.checkpoint_id` | **none today** | Out-of-band chain anchor. No equivalent. |
| `metadata.budget_lease_id` | `ferrumdeck.audit.metadata.budget_lease_id` | **none today** | Budget lease identity. No equivalent. |
| `metadata.mandate_id` | `ferrumdeck.audit.metadata.mandate_id` | **none today** | AP2 signed payment mandate. No equivalent. |

## Eval results (`fd_evals.task.EvalResult`)

| Native field | Emitted as | OTel GenAI equivalent | Note |
| --- | --- | --- | --- |
| `task_id` | `ferrumdeck.eval.task_id` | **none today** | Eval task identity. GenAI conventions have no eval concept. |
| `task_name` | `ferrumdeck.eval.task_name` | **none today** | Eval task label. No equivalent. |
| `run_id` | `ferrumdeck.eval.run_id` | **none today** | Control-plane run id. No equivalent. |
| `passed` | `ferrumdeck.eval.passed` | **none today** | Scorer verdict. No equivalent. |
| `total_score` | `ferrumdeck.eval.total_score` | **none today** | Weighted scorer average. No equivalent. |
| `scorer_results` | `ferrumdeck.eval.scorer_results` | **none today** | Per-scorer breakdown. No equivalent. |
| `execution_time_ms` | `ferrumdeck.eval.execution_time_ms` | **none today** | Span duration already carries this. |
| `input_tokens` | `ferrumdeck.eval.input_tokens` | `gen_ai.usage.input_tokens` | Direct equivalent. |
| `output_tokens` | `ferrumdeck.eval.output_tokens` | `gen_ai.usage.output_tokens` | Direct equivalent. |
| `cost_cents` | `ferrumdeck.eval.cost_cents` | **none today** | Cost is not in the GenAI conventions. |
| `error` | `ferrumdeck.eval.error` | `error.type` | General OTel attribute, not gen_ai.*; set when present. |
| `trace_id` | `ferrumdeck.eval.trace_id` | **none today** | W3C trace context, not gen_ai.*. |
| `timestamp` | `ferrumdeck.eval.timestamp` | **none today** | Record timestamp. |
| `model` | `ferrumdeck.eval.model` | `gen_ai.request.model` | Model under evaluation. |
| `claim_grounding` | `ferrumdeck.eval.claim_grounding` | **none today** | Grounding-rate reliability metric. No equivalent. |
| `cost_breakdown` | `ferrumdeck.eval.cost_breakdown` | **none today** | Debt-vs-tax decomposition. No equivalent. |

## Fields with no OTel GenAI equivalent

**Audit** (16):

- `id` — Audit-event ULID. No GenAI equivalent; not a span id.
- `timestamp` — Carried by the span/log record timestamp itself.
- `tenant_id` — Multi-tenancy is outside the GenAI conventions.
- `actor` — Enforcement actor (agent, human approver, system). No equivalent.
- `resource` — Governed resource identity. No equivalent.
- `outcome` — allow / deny / require_approval. No GenAI equivalent.
- `trace_id` — Already the W3C trace id; belongs to trace context, not gen_ai.*.
- `trace_sampled` — W3C sampled flag; trace context, not gen_ai.*.
- `metadata.policy_decision` — Deny-by-default decision kind. No equivalent.
- `metadata.airlock_layer` — Which RASP layer fired (-1..3). No equivalent.
- `metadata.risk_score` — Airlock risk score 0-100. No equivalent.
- `metadata.reversibility` — R1-R3 reversibility rung. No equivalent.
- `metadata.chain_hash` — Hash-chain link for tamper evidence. No equivalent.
- `metadata.checkpoint_id` — Out-of-band chain anchor. No equivalent.
- `metadata.budget_lease_id` — Budget lease identity. No equivalent.
- `metadata.mandate_id` — AP2 signed payment mandate. No equivalent.

**Eval** (12):

- `task_id` — Eval task identity. GenAI conventions have no eval concept.
- `task_name` — Eval task label. No equivalent.
- `run_id` — Control-plane run id. No equivalent.
- `passed` — Scorer verdict. No equivalent.
- `total_score` — Weighted scorer average. No equivalent.
- `scorer_results` — Per-scorer breakdown. No equivalent.
- `execution_time_ms` — Span duration already carries this.
- `cost_cents` — Cost is not in the GenAI conventions.
- `trace_id` — W3C trace context, not gen_ai.*.
- `timestamp` — Record timestamp.
- `claim_grounding` — Grounding-rate reliability metric. No equivalent.
- `cost_breakdown` — Debt-vs-tax decomposition. No equivalent.

These are emitted under the `ferrumdeck.*` namespace. A consumer that understands only `gen_ai.*` will not see them; that is a limitation of the conventions, and we would rather say so than map a governance decision onto a name that means something else.
