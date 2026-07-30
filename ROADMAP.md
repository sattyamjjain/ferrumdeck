# FerrumDeck Roadmap

FerrumDeck is **Apache-2.0 open source**. There is **no paid tier, no hosted
control plane, and no enterprise SKU** — and **nothing on this roadmap is gated
behind one**. Everything below is a gap in the OSS project, tracked in the open.

This list is not aspirational scope — it is the honest "what's not wired yet"
map from the README's [Project Status &
Limitations](README.md#project-status--limitations), given a destination. Each
item has a one-line problem, the file/endpoint it lives in, and what *done*
means. Each links to a tracking issue labelled
[`roadmap`](https://github.com/sattyamjjain/ferrumdeck/issues?q=is%3Aissue+label%3Aroadmap).

Found a gap not listed here? Please [open an
issue](https://github.com/sattyamjjain/ferrumdeck/issues/new) — accurate status
is a feature.

---

## Now

### Push `policy.response.recorded` over SSE (gateway → BFF)
- **Problem:** the `policy.response.recorded` realtime event **shape is defined**
  and the dashboard already consumes it, but the gateway does not yet **push** it —
  so the R1/R2/R3 response level only updates on a polled read, not live. The same
  is true of the four sibling run-channel events
  (`run.forecast.updated`, `policy.decision.explained`, `routing.decision.recorded`,
  `coherence.divergence.detected`): wire shapes exist, no gateway emitter. Until
  this lands the realtime channel carries **heartbeats only**. The BFF *can*
  synthesize these events for wire-shape development behind
  `FERRUMDECK_SSE_MOCK_EVENTS`, but that flag is **OFF by default in every
  environment** — a fabricated enforcement verdict must never reach an operator's
  console — so the honest default is: no live governance events until the emitter
  ships.
- **Lives in:** the BFF SSE consumer at
  `nextjs/src/app/api/sse/[channel]/route.ts` (handles `policy.response.recorded`);
  the gateway run-stream emitter under `rust/services/gateway/src/` needs to emit it.
- **Done:** the gateway emits `policy.response.recorded` on the run stream when a
  tool-policy check records a response level, and the dashboard renders the badge
  update without a poll.
- **Tracking:** _(good first issue)_ — [#5](https://github.com/sattyamjjain/ferrumdeck/issues/5)

---

## Next

### Harden `tests/security`, `tests/chaos`, `tests/e2e` to assert behaviour, not just liveness
- **Problem:** these suites require a live stack (`make dev-up`) and currently
  **assert liveness more than behaviour** — they must not be read as proof that a
  given attack is blocked. For a project whose pitch is safe agent execution, this
  is the most important credibility gap.
- **Lives in:** `tests/security/`, `tests/chaos/`, `tests/e2e/`.
- **Done:** each attack case asserts the *outcome* (e.g. the exfil/RCE/IDOR attempt
  returns `allowed=false` and the tool never runs), not merely that the endpoint
  responded; they are wired into a live-stack CI job separate from `ci-check`.
- **Tracking:** [#6](https://github.com/sattyamjjain/ferrumdeck/issues/6)

### Serve evals dashboard data from a gateway backend (unstub `/api/v1/evals/*`)
- **Problem:** the **evals dashboard data is BFF-stubbed** — `/api/v1/evals/*`
  returns empty until a gateway eval backend lands, so the full
  eval → gateway → dashboard round-trip is only demonstrable with a live stack and
  a non-stub feed.
- **Lives in:** `nextjs/src/app/api/v1/evals/*` (`runs`, `suites`, `regression-report`);
  needs a corresponding gateway eval-read backend.
- **Done:** `/api/v1/evals/*` proxies real eval results from the gateway, and the
  eval-run dashboard renders a real run end-to-end.
- **Tracking:** [#7](https://github.com/sattyamjjain/ferrumdeck/issues/7)

### Audit tamper-evidence: cryptographic hash-chain
- **Problem:** the audit trail is append-only — enforced by the repo API (no
  `UPDATE`/`DELETE` path) **and** a DB trigger (`trg_audit_events_append_only`,
  migration `20260719000001`) that rejects every `UPDATE` and rejects `DELETE`
  within the 3-year retention floor. What is still missing is a **cryptographic
  hash-chain**: without one the trail is not tamper-*evident* against a privileged
  DB actor who could drop the trigger or `TRUNCATE` the table. Do not represent
  the trail as immutable/tamper-proof for compliance until this ships.
- **Regulatory context:** the retention *floor* already ships
  (`RETENTION_FLOOR_YEARS = 3` in `rust/crates/fd-policy/src/colorado_sb26_189.rs`,
  enforced by migration `db/migrations/20260719000001_add_audit_retention_floor.sql`),
  motivated by **Colorado SB 26-189** (effective **2027-01-01**), which requires
  developers and deployers to retain compliance records for **not less than three
  years** (<https://leg.colorado.gov/bills/sb26-189>). Tamper-*evidence* is the
  remaining gap between "we keep the records for 3 years" and "we can prove they
  weren't altered."
- **Lives in:** `rust/crates/fd-audit/` (event write path) + `db/migrations/`.
- **Done:** each audit event carries a hash chained to its predecessor and a
  verifier can detect any insertion/deletion/edit — including one made by a
  privileged actor who bypasses the existing `UPDATE`/`DELETE`-rejecting trigger
  (e.g. by dropping it or `TRUNCATE`-ing). The DB-level `UPDATE`/`DELETE` reject
  trigger already ships (see Problem); the hash-chain is the remaining work.
- **Tracking:** [#8](https://github.com/sattyamjjain/ferrumdeck/issues/8)

---

## Later

### Let an approved harness suggestion apply a policy/allowlist/budget change (guarded)
- **Problem:** approving a harness suggestion **records** the decision but **never
  auto-applies** a policy/allowlist/budget change — applying is still fully manual.
- **Lives in:** the harness-suggestion endpoints
  `/v1/harness-suggestions` + `/v1/harness-suggestions/{id}/resolve`
  (`rust/services/gateway/src/routes.rs` → `handlers::harness_suggestions`).
- **Done:** a resolved-approved suggestion can, behind an explicit second
  confirmation and a full audit record, apply its proposed delta to the live
  policy/allowlist/budget — deny-by-default, never silent.
- **Tracking:** [#9](https://github.com/sattyamjjain/ferrumdeck/issues/9)

### Dashboard auth/session + SSO/RBAC + API-key self-service
- **Problem:** tenant isolation is enforced, but there is **no dashboard
  auth/session layer, no SSO/RBAC, and no API-key self-service** — the dashboard +
  gateway must be treated as a **trusted-operator** deployment.
- **Lives in:** `nextjs/` (no auth/session module today) + the gateway API-key
  middleware.
- **Done:** the dashboard requires authenticated sessions, roles gate write actions
  (RBAC), and operators can mint/rotate API keys without a manual DB seed.
- **Tracking:** [#10](https://github.com/sattyamjjain/ferrumdeck/issues/10)

### Optional enforcement for the coherence + claim-grounding reliability signals
- **Problem:** the coherence-divergence monitor and the claim-grounding-rate metric
  are **signals only** — they surface and record, but never block a tool or kill a
  run (coherence enforcement is opt-in and shadow-by-default).
- **Lives in:** `rust/crates/fd-policy/src/airlock/coherence.rs` and
  `rust/crates/fd-otel/src/claim_grounding.rs`.
- **Done:** an operator can opt a high-consequence agent into blocking on a
  high-confidence coherence divergence / low claim-grounding rate, with the
  false-positive posture documented and the default left at signal-only.
- **Tracking:** [#11](https://github.com/sattyamjjain/ferrumdeck/issues/11)
