# SAFE evidence coverage

What the [Shared AI Findings Exchange (SAFE)][safe] proposal asks members to preserve, against what
FerrumDeck's hash-chained audit log actually records — one row per evidence class, with the schema
location and a status.

SAFE is a proposal in the Open Secure AI Alliance's `RFCs` repository (`rfc-safe-proposal.md`),
published 2026-08-04. It is not an IETF RFC and carries no formal status. Its **Evidence
Preservation** section is the eight-item list below, quoted verbatim; the wording in the "What SAFE
asks for" column is SAFE's, not ours.

[safe]: https://github.com/OpenSecureAIAlliance/RFCs/blob/main/rfc-safe-proposal.md

## Why this page exists, and why it leads with the gaps

This repository has a documented run of "exists but never executed" defects: a suite declared and
never scheduled, 18 test files CI never collected, a generated page built from gitignored files, a
route returning plausible fixture data. See [`eval-verdicts.md`](../eval-verdicts.md) and
[`eval-health.md`](../eval-health.md).

The analogue for an evidence claim is worse than a broken test, because it fails silently and only
at the moment it matters. Claiming coverage of an evidence class that is recorded in a form no
investigator can use — a boolean where a quantity is needed, an identifier that resolves to
nothing, a constant that is declared but never written — looks identical to real coverage until
someone asks the question under time pressure.

So every status below was checked against a running stack at the commit named, not read off the
source. Where the answer was "the column exists", the follow-up question was "and is anything ever
written to it?". Three times, it was not.

## Coverage table

**Status** is the verdict at the tip of this branch. Where it changed, the **Baseline** column
keeps the verdict at commit `2266581` (the branch point), because the gap analysis is the
evidence for the work and deleting it would leave a table that looks like it was always true.

| # | What SAFE asks for | What the audit log records today | Where in the schema | Baseline | Status |
|---|---|---|---|---|---|
| 1 | "Prompts, traces, tool calls, logs, configurations, model and safeguard versions and third-party dependencies" | Step input/output, model, tool name + version. W3C trace id on audit rows (MCP SEP-414). Tool calls recorded as policy decisions carrying `tool_name`. **The safeguard configuration is now versioned**: every decision names the content hash of the policy document that produced it. Still no third-party dependency inventory, and prompts are not committed to the chain. | `steps.*`, `audit_events.trace_id`, `audit_events.details.permissions.policy_hash`, `policy_documents` | PARTIAL | **PARTIAL** |
| 2 | "Agent and workload identities" | Tenant, project, agent, agent version, run and the API key id that presented the call, on every decision record. Inside `details`, so covered by the row's `record_hash`. No secret or secret prefix is ever written. | `audit_events.details.permissions.identity` | MISSING | **CONFORMS** |
| 3 | "Permissions and credentials available during the run" | The full allowlist (behind its content hash), budget remaining as quantities rather than a boolean, and the credential id. Reconstructable from the log alone: `PoliciesRepo::reconstruct_permissions_at` answers "what was this identity permitted to do at time T" by reading `audit_events` joined to `policy_documents` and nothing else. | `audit_events.details.permissions`, `policy_documents` | MISSING | **CONFORMS** |
| 4 | "Human approval and intervention events" | All four now written and reachable: escalation (`policy.approval_required`, with the deadline), approval, denial and timeout — each with the resolving identity and the wall-clock latency. A timeout is attributed to `system`, which is what distinguishes "somebody decided" from "the clock decided". | `audit_events.action` (`policy.approval_required`, `approval.*`), `.details.latency_ms`, `approval_requests` | MISSING | **CONFORMS** |
| 5 | "Files and external artifacts created or modified" | The control plane records the *decision* to call a tool, never the tool's effect. `steps.output` holds whatever the tool returned, unstructured and unindexed. No artifact inventory, no before/after, no content hashes. | `steps.output` only | MISSING | **MISSING** |
| 6 | "Detection, containment and recovery events" | Detection and containment are real: Airlock violations are recorded with risk score, violation type and the blocked payload, and an in-path denial is a first-class event. Recovery has no event type at all. | `audit_events.action='airlock.violation_detected'`, `threats.*`, `audit_events.action='policy.denied'` | PARTIAL | **PARTIAL** |
| 7 | "A complete incident timeline" | Ordering and tamper-evidence are strong, the escalation hole is closed, and as of 0.8.12 **concurrent writes no longer drop records** (per-tenant advisory lock; 17-of-24 collisions became 0, asserted by `audit_chain_collision.rs`). One gap remains: several declared action types are still never written — no `run.started`, `step.started` or `step.failed` — so the timeline is ordered and complete *for the events that are emitted*, and those do not cover the full run lifecycle. | `audit_events.occurred_at`, `.chain_seq`, `.prev_hash`, `.record_hash` | PARTIAL | **PARTIAL** |
| 8 | "Reproduction testing and remediation evidence" | Repo-level reproduction is unusually good — every published figure is re-derivable by one command, and eval verdicts are written down with run ids. None of it is linked to a run or an incident. | `evals/reports/`, [`eval-verdicts.md`](../eval-verdicts.md), `make reproduce-readme-figures` | PARTIAL | **PARTIAL** |

SAFE also requires a preliminary control-failure analysis within 30 days and the reporting of near
misses. Those are process obligations on a member organisation, not properties of a log, and
FerrumDeck does not implement them. See [Scope](#scope).

## How each status was determined

Not from reading the source. Against a stack booted with `make dev-up` at commit `2266581`, after a
full run of `tests/security tests/chaos tests/e2e`:

```
SELECT action, count(*) FROM audit_events GROUP BY action ORDER BY 2 DESC;

 policy.denied              | 120
 run.created                | 115
 airlock.violation_detected |  54
 run.completed              |  44
 step.completed             |  44
 policy.allowed             |  22
```

Six action types written; 24 declared in `rust/crates/fd-storage/src/models/audit.rs`. That gap is
the evidence for rows 4 and 7.

Three findings behind the **MISSING** verdicts, each confirmed against the live stack rather than
inferred:

**`policy_decisions` is empty, but the API hands out decision ids.** `POST /v1/runs/{id}/check-tool`
returns `"decision_id": "pdc_01M0DEZ7YER9Y94MACR495D1Q6"`. `SELECT count(*) FROM policy_decisions`
returns `0`. `PoliciesRepo::create_decision` exists and has no callers. The id is a ULID minted in
memory and discarded — a client that stores it and later asks for the decision gets nothing.

**No approval request is ever created.** `PoliciesRepo::create_approval` has no callers, there is no
`POST /approvals` route, and `SELECT count(*) FROM approval_requests` returns `0`. The two
resolution handlers are well-written and carry the approver identity, but nothing can reach them.

**An escalated call is recorded as an allowed one.** The audit action is derived from the raw
allowlist verdict rather than the effective one:

```rust
let audit_action = if decision.is_allowed() {          // <-- raw allowlist decision
    action::POLICY_ALLOWED
} else if decision.needs_approval() {
    action::POLICY_APPROVAL_REQUIRED
} else { action::POLICY_DENIED };
```

When the reversibility ladder escalates `Allow` → `RequiresApproval`, `decision.is_allowed()` is
still true, so the row is written as `policy.allowed`. Observed directly: a `git_read` call that the
gateway gated for approval (`"requires_approval": true`, `"response_level": "require_approval"`) was
written to the chain as `policy.allowed`. `details.effective_decision` holds the truth, so the fact
is recoverable — but `action` is the indexed, filtered, human-read field, and it says the opposite.
`policy.approval_required` has never been written, which is why it does not appear in the counts
above.

## What this branch changed

Rows 2, 3 and 4 moved from **MISSING** to **CONFORMS**. Nothing else moved; rows 5–8 are unchanged
and are stated as they are.

**Permissions and credentials (rows 2 and 3).** Every decision now carries a `permissions` block in
`audit_events.details`: the identity the decision was made *for* (tenant, project, agent, agent
version, run, API key id), the budget remaining as quantities, and a SHA-256 content hash of the
policy document that produced the decision. The document itself — canonical allowlist, budget caps,
enforcement mode — is stored once in the new content-addressed `policy_documents` table, keyed by
that hash and immutable by trigger.

The hash rather than the document, for two reasons. An allowlist is unbounded and identical across
millions of decisions, so inlining it adds bytes and no information. More importantly the hash sits
*inside* the audit row and is therefore covered by that row's `record_hash` and the per-tenant
chain, so editing the allowlist a decision was made under leaves either a hash that resolves to
nothing or a broken chain. An inline copy would be one more mutable blob.

The invariant — *given only the audit log and the policy map, a reader can reconstruct what this
identity was permitted to do at time T* — is asserted by
`rust/crates/fd-storage/tests/permission_reconstruction.rs` against a real database, across a policy
change, which is the case that matters: an agent permitted to write on Monday and not on Tuesday.
The reconstruction ships as `PoliciesRepo::reconstruct_permissions_at` rather than living in the
test, because a capability only a test can perform is not a capability an investigator has. CI executes
that test: it is `#[ignore]`d for the database, and until this branch nothing in CI ran `--ignored`,
so the assertion existed and had never once been made. The `live-stack-tests` job now runs it
against the migrated schema and checks each test reported by name. Its SQL
reads two tables and names neither `agents` nor `runs`, so the answer survives the agent being
deleted or re-permissioned.

**Human approval and intervention (row 4).** The gap was larger than "a missing field". No approval
request was ever created — `create_approval` had no callers and there is no `POST /approvals` route
— so `approval_requests` was empty in every deployment, `GET /approvals` always returned `[]`, and
the two resolution handlers could not be reached. `approval.expired` had never been written since
the schema was created. Escalations were recorded as `policy.allowed`.

So this branch wired the gate open as well as recording it: the two paths that park a run in
`WaitingApproval` now create the policy-decision and approval rows and write
`policy.approval_required` with the deadline; the two auto-expiry paths write `approval.expired`
instead of silently resolving the row; and approve, deny and expire share one event builder that
carries the resolving identity and `latency_ms`. Adding the expiry event without wiring creation
would have been the same defect this repository keeps finding — code that exists and never runs.

Latency is not decoration. An approval that took 40 minutes and one that took 4 seconds are
different facts about the control, and only one of them is a control that works under load.

**Also fixed, incidentally.** The dev seed registered its four tools without a `reversibility`, so
they inherited the column default `irreversible` and every tool on the demo agent's own allowlist
required approval — the allow path was undemonstrable and several security tests were failing
against a correctly-functioning engine. Migration `20260819000002` classifies them
(`git_read`/`test_run` reversible, `git_write` costly, `github_create_pr` left irreversible so the
R3 gate still has something to demonstrate).

## Known gaps found while checking

Two of the three gaps recorded here at 0.8.11 were closed in 0.8.12. They are
kept, struck through in prose rather than deleted, because a page that only ever
shows what is currently fine teaches a reader nothing about what to check.

**~~The anti-RCE layer is name-matched and matches nothing on a seeded stack.~~
Fixed in 0.8.12.** Layer 1 and Layer 3 both filtered by tool name against
default lists of literal guesses — eight shell-shaped names and eight
HTTP-shaped ones — neither of which matched a domain-named registry. Both
inspected zero of the four seeded tools. Both defaults are now empty, meaning
inspect everything; the same payload moved from `risk_score: 0` to
`risk_score: 90, violation: rcepattern`. Narrowing is still supported and is
reported per layer at boot and on `GET /ready`. **Airlock still defaults to
`shadow`**, so a detected violation is recorded and not blocked — detection and
refusal are different, and the second is `FERRUMDECK_AIRLOCK_MODE=enforce`.

**~~Concurrent audit writes to one tenant collide and are dropped.~~ Fixed in
0.8.12.** A transaction-scoped per-tenant advisory lock makes read-tip-then-insert
atomic. The 24-writer race that previously lost 17 events now loses none, with a
contiguous `chain_seq` asserted. Residual: a write failing for a non-collision
reason is still dropped by the fire-and-forget caller (logged at ERROR with
tenant and index), and anything bypassing `AuditRepo::create` is outside the
guarantee.

**~~A NUL byte in a tool name reaches Postgres.~~ Fixed in 0.8.12.** `tool_name`
now rejects the whole C0/C1 control range plus DEL at validation, returning 422
with the offending code point instead of a 500 from the database driver.

### Still open

**Most declared audit actions are never written.** 24 action constants are
defined in `fd-storage`; a full run exercises 6. `run.started`, `step.started`
and `step.failed` in particular have never been emitted, so the timeline in row
7 covers decisions and completions but not the full lifecycle. This is the
largest remaining item on this page.

**No artifact inventory (row 5).** The control plane records the decision to
call a tool, never the tool's effect. Closing it means capturing what a tool
changed, which is a data-model question, not a logging one.

**No third-party dependency inventory (row 1).** An SBOM would close the
"third-party dependencies" half of that class.

## Scope

FerrumDeck is an enforcement engine and an evidence producer. It is not a compliance product, it
does not file reports, and it is not a member of the Open Secure AI Alliance. This page exists so
that anyone assessing FerrumDeck against SAFE can see exactly which evidence classes its log covers
and which it does not, without having to take a marketing claim on trust.

A **CONFORMS** on this page means "the log records this, in a form an investigator could use, and a
test asserts it stays that way". It does not mean the deploying organisation is SAFE-conformant;
that depends on process obligations no library can discharge.
