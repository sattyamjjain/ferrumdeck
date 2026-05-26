# Runbook — Policy-Conflict Resolution & Decision Traces

## Purpose

When more than one policy matches a tool call (e.g. one allows by glob, one
denies by risk-tier, a third requires approval), FerrumDeck's governance
plane picks a winner deterministically using a named, testable precedence
function. Every decision carries an **explanation trace** so dashboards and
audit consumers can answer "why was this denied / approved" without re-
running the engine.

## The precedence

Single canonical ordering, encoded once in `fd_policy::precedence`:

```
Deny  >  RequiresApproval  >  BudgetCap  >  Allow
```

- `Deny`: explicit denylist match or risk-tier critical match.
- `RequiresApproval`: policy demands a human approval before execution.
- `BudgetCap`: a budget axis (cost / tokens / wall-time / tool-call count)
  would be exceeded. Distinct from `Deny` so operators can tell "denied
  because allowlist said no" from "denied because over budget".
- `Allow`: allowlist match.

Within the same tier, **first-submitted wins**. The other entries are
recorded in the trace as overrides — nothing is silently dropped.

If zero policies match, the engine returns deny-by-default. The trace
records the empty match set so audit can prove the allowlist saw nothing
for the action.

## API contract

`POST /v1/runs/{run_id}/check-tool` — response (additive `decision_trace`
field):

```json
{
  "allowed": false,
  "requires_approval": false,
  "decision_id": "pld_01HZX…",
  "reason": "tool 'write_file' is on the explicit denylist",
  "decision_trace": {
    "matched": [
      {
        "kind": "deny",
        "source": "allowlist:denied",
        "reason": "tool 'write_file' is on the explicit denylist"
      },
      {
        "kind": "requires_approval",
        "source": "allowlist:approval",
        "reason": "tool 'write_file' requires approval before execution"
      },
      {
        "kind": "allow",
        "source": "allowlist:allowed",
        "reason": "tool 'write_file' is in the allowlist"
      }
    ],
    "winning_kind": "deny",
    "winning_source": "allowlist:denied",
    "overrides": [
      {
        "verdict": { "kind": "requires_approval", "source": "allowlist:approval", "reason": "…" },
        "overridden_by": "deny",
        "reason": "overridden by higher-precedence deny verdict (deny > requires_approval > budget_cap > allow)"
      },
      {
        "verdict": { "kind": "allow", "source": "allowlist:allowed", "reason": "…" },
        "overridden_by": "deny",
        "reason": "overridden by higher-precedence deny verdict (deny > requires_approval > budget_cap > allow)"
      }
    ],
    "precedence": "deny > requires_approval > budget_cap > allow"
  }
}
```

Optional fields (`winning_kind`, `winning_source`, `overrides`) are omitted
when there's nothing to report — older clients can ignore `decision_trace`
entirely.

## SSE contract

Event type: **`policy.decision.explained`** on the per-run channel
`run:{run_id}`. Same shape as the API trace, plus run/tool routing fields:

```json
{
  "type": "policy.decision.explained",
  "channel": "run:run_…",
  "payload": {
    "run_id": "run_…",
    "tool_name": "write_file",
    "decision_id": "pld_…",
    "winning_kind": "deny",
    "winning_source": "allowlist:denied",
    "overrides": [
      {
        "kind": "allow",
        "source": "allowlist:allowed",
        "overridden_by": "deny",
        "reason": "overridden by higher-precedence deny verdict (deny > requires_approval > budget_cap > allow)"
      }
    ],
    "precedence": "deny > requires_approval > budget_cap > allow",
    "at": "2026-05-26T…"
  }
}
```

**Status — gateway push wiring is deferred** (same pattern as
SchemaDriftGuard and `run.forecast.updated`). The BFF SSE endpoint emits
this shape via the mock generator so dashboard consumers and the schema
are locked in. The 2 s polling on `check-tool`'s decision-id surfaces the
trace immediately in the meantime.

## What to do when a trace shows overrides

1. Open the decision row in the dashboard; the `overrides` list reads top-
   to-bottom in the same order policies were submitted to the resolver.
2. If you didn't expect the winning verdict, look at the matched set
   first. The most common surprise is two rules that both "match" because
   the same tool name appears on multiple lists (denylist + allowlist) —
   that's an authoring mistake, not a bug.
3. The `precedence` field is frozen at decision time. If you change the
   precedence ordering later, old audit rows still read correctly.

## Operations checklist

- The precedence is defined in **one place**:
  `rust/crates/fd-policy/src/precedence.rs::precedence_rank`. Code review
  must reject any new `match` arm on `VerdictKind` that re-implements
  ordering elsewhere.
- `ToolAllowlist::check` (legacy short-circuit API) is kept for back-
  compat with callers that don't need the trace. New code should use
  `ToolAllowlist::matches` + `resolve_conflicts`.
- The `BudgetCap` verdict layer doesn't change run termination semantics —
  budget-exceeded still routes through `RunStatus::BudgetKilled` as
  before. The new label only differentiates the trace's source so
  operators see what tripped the kill switch.
- Per `cargo test -p fd-policy`, the resolution invariants are guarded by
  16 dedicated unit tests in `precedence::tests` and `trace::tests`, plus
  8 integration tests in `engine::tests::conflict_*` /
  `engine::tests::budget_check_attaches_budget_cap_verdict_in_trace`.

## Related links

- Precedence module: `rust/crates/fd-policy/src/precedence.rs`
- Trace module: `rust/crates/fd-policy/src/trace.rs`
- Engine: `rust/crates/fd-policy/src/engine.rs::evaluate_tool_call`
- Gateway handler: `rust/services/gateway/src/handlers/runs.rs::check_tool_policy`
- BFF SSE mock: `nextjs/src/app/api/sse/[channel]/route.ts`

## Design reference

The framing of policy-as-code with typed primitives is adjacent to CUGA
(*Governance by Construction for Generalist Agents*, Shlomov et al.,
arXiv:[2605.20874](https://arxiv.org/abs/2605.20874)). The specific
precedence function and override-record schema in this codebase are
FerrumDeck-original; CUGA influenced the broader idea that policy
checkpoints should produce structured, machine-readable decisions rather
than opaque booleans.
