# Claim Grounding Rate (grounding rate per VeriGraph)

## What it is

A per-run **reliability** metric (`0.0–1.0`): the fraction of the final agent
output's **claims** that are **reachable from a tool-output source node** via
the run's evidence graph. This is the claim-level grounding definition from
**VeriGraph** ([arXiv:2606.16603](https://arxiv.org/abs/2606.16603)) — a lineage
to the claim-level auditability literature, **not a ferrumdeck-original metric**.

```
claim_grounding_rate = (claims reachable from a source node) / (total claims)
```

- **Claim** — a sentence in the run's final output (`runs.output`).
- **Source node** — a tool-step output (`steps[].output` where `step_type = "tool"`):
  the raw data the agent actually observed.

## Honest scope — a deterministic proxy

"Reachable evidence path" is operationalized as a **deterministic
lexical-overlap reachability proxy**: lowercase, split the output into claims,
tokenize into significant tokens (ASCII-alphanumeric, length ≥ 3), and mark a
claim **grounded** when ≥ `GROUNDING_OVERLAP` (0.5) of its distinct tokens are
covered by the union of source-node tokens. Claims with fewer than
`MIN_CLAIM_TOKENS` (3) significant tokens are dropped as non-claims.

It is **pure and CI-stable** — same inputs → same output on every machine, no
model call — in the same spirit as the tool-call firing rate. It is **not** an
LLM judge or a semantic-entailment model. A run that makes no claims scores
`1.0` (nothing to ground ⇒ nothing ungrounded), never a failure.

## Dual implementation, one contract

| Plane | Module | Role |
|---|---|---|
| Rust | `fd_otel::claim_grounding` | computed at the gateway run-completion choke point; persists + emits |
| Python | `fd_evals.claim_grounding` | the eval-plane metric (`EvalResult.claim_grounding`) |

A shared golden fixture (`fd-evals/tests/fixtures/claim_grounding.golden.json`)
is asserted by **both** a Rust test and a Python test, pinning that the two
planes score an identical run identically.

## Where it surfaces

- **Run row**: `runs.claim_grounding_rate` + `runs.claim_grounding_flagged`
  (next to cost/tokens), returned on `GET /v1/runs/{id}`.
- **Span**: `ferrumdeck.reliability.claim_grounding_rate` (+ `_below_threshold`,
  `_threshold`) on the run-completion span.
- **Dashboard**: a "Grounding" stat card on the run header, next to Cost.
- **Audit**: when flagged, a `reliability.claim_grounding_below_threshold`
  event (a signal — the run status is untouched).

## Optional flagging gate (off by default)

A project may set `min_claim_grounding_rate` in its `projects.settings` JSONB:

```json
{ "min_claim_grounding_rate": 0.7 }
```

When set, a completed run whose rate is `< threshold` is **flagged**
(`claim_grounding_flagged = true` + the audit signal + an amber dashboard
badge). It **never** blocks a tool or kills a run — the deny-by-default posture
is for *tool permissions*, not reliability scoring. Absent the setting, the
metric is still computed and surfaced but never flags.

## Verifying

- Rust: `cargo test -p fd-otel claim_grounding`.
- Python (CI-gated): `uv run pytest python/packages/fd-evals/tests/test_claim_grounding.py`.
- Cross-plane: the Rust `golden_cross_plane_fixture` test and the Python
  `TestGoldenParity` test assert the same numbers on the shared fixture.
