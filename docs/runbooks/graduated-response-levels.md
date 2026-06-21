# Reversibility-Aware Graduated Response (R1–R3 ladder)

## What it is

Risk and **reversibility** are orthogonal axes. A high-risk *read* is fully
recoverable; a low-risk *delete* is not. FerrumDeck adds a `Reversibility`
dimension on the tool registry and maps it onto a **graduated response** at the
gateway tool-policy check, modelled on the DeepMind *AI Control Roadmap* R1–R3
control ladder:

| Reversibility | Response level | Rung | Behaviour |
|---|---|---|---|
| `reversible` | `allow_and_log` | **R1** | Monitor: allowed, logged for async review. No gate. |
| `costly` | `allow_under_budget` | **R2** | Allowed **while the run's cost budget has headroom**; escalates to R3 once exhausted. |
| `irreversible` | `require_approval` | **R3** | The existing human-in-the-loop approval gate. |

**Deny-by-default:** an unregistered / unclassified tool defaults to
`irreversible` (R3) — the most consequential rung.

## How it composes

The rung is **folded into the allowlist decision, more-restrictive-wins**
(`fd_policy::reversibility::combine`, ranked the same as the crate precedence
`Deny > RequiresApproval > Allow`). It can therefore only ever **add** friction:
it can upgrade an `Allow` to `RequiresApproval`, but can never loosen a `Deny`
or an existing approval requirement.

```
reversibility (tool registry)  +  budget headroom (run)
        └──────────────► graduated_response() ─► response_level
                                                      │
allowlist decision ──────────────► combine(more-restrictive-wins) ─► effective decision
```

## Where it's emitted

The decision + reasoning is surfaced on every existing channel — no parallel
store:

- **OTel/GenAI span**: `ferrumdeck.policy.response_level` +
  `ferrumdeck.policy.reversibility` on the tool-check span.
- **Immutable audit log**: the `policy.*` audit event `details` carry
  `reversibility`, `response_level`, `response_rung`, `effective_decision`,
  `budget_headroom`.
- **API**: `POST /v1/runs/{id}/check-tool` returns `reversibility` +
  `response_level`; the polled `GET /v1/runs/{id}` returns `response_level`.
- **Dashboard**: the run console renders an R1/R2/R3 badge from the polled run
  endpoint. A realtime `policy.response.recorded` SSE shape is defined for
  parity; the gateway→BFF push is **deferred** (same pattern as
  `run.forecast.updated` / `routing.decision.recorded`).

## Setting a tool's reversibility

`POST /v1/registry/tools` accepts an optional `reversibility` field
(`reversible` | `costly` | `irreversible`); unknown / absent normalizes to
`irreversible`. Stored on `tools.reversibility` (TEXT, default `irreversible`).

## Verifying

- Rust: `cargo test -p fd-policy reversibility` (the ladder + budget-headroom +
  combine unit tests).
- Evals (deterministic, CI-gated): `make test-python` runs
  `tests/test_reversibility_gate.py` — a reversible action passes without a
  gate, an irreversible one blocks until approval, and a costly one flips to
  approval when the budget is breached.

## Design reference

DeepMind, *An Approach to Technical AGI Safety* — the AI Control Roadmap R1–R3
control-level ladder (monitor → conditional → gate). Anchor:
`deepmind-ai-control-roadmap-r1-r3`.
