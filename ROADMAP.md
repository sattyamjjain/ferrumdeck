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

### Push the four remaining run-channel events over SSE
- **Shipped in 0.8.13 ([#5](https://github.com/sattyamjjain/ferrumdeck/issues/5), closed):**
  the transport and the first event. The gateway serves
  `GET /v1/events/{channel}` and pushes `policy.response.recorded` from **inside**
  the audit write, after the row commits, so the `record_id` it carries resolves
  via `GET /v1/audit/{id}`. Reconnect replay honours `Last-Event-ID` and
  `?last_event_id=`, and a gap that cannot be served emits `stream.gap` naming the
  range rather than a stream that merely looks quiet.
- **Problem:** four sibling run-channel events still have a defined wire shape and
  **no gateway emitter** — `run.forecast.updated`, `policy.decision.explained`,
  `routing.decision.recorded`, `coherence.divergence.detected` — so the console
  reads those from the polled run endpoint. The BFF *can* synthesize them for
  wire-shape development behind `FERRUMDECK_SSE_MOCK_EVENTS`, but that flag is
  **OFF by default in every environment** — a fabricated enforcement verdict must
  never reach an operator's console.
- **Lives in:** the emitters under `rust/services/gateway/src/`; the transport is
  `crate::events` + `handlers::events`, and the shapes are in
  `nextjs/src/lib/realtime/channels.ts`.
- **Done:** each of the four is emitted after the state it reports is durable
  (the `spawn_audit_and_publish` pattern), and the dashboard updates from the push
  rather than a poll. Two transport limits are fixed or explicitly accepted: the
  replay buffer is per-process, so a multi-replica reconnect cannot be served
  completely, and every SSE connection counts against `RATE_LIMIT_PER_MINUTE`.
- **Tracking:** [#47](https://github.com/sattyamjjain/ferrumdeck/issues/47)

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

### Dispatch an eval run from the dashboard (the write half of the eval surface)
- **Shipped in 0.8.13 ([#7](https://github.com/sattyamjjain/ferrumdeck/issues/7), closed):**
  the **read** path. `/api/v1/evals/{suites,suites/{id},runs,regression-report}`
  serve the gateway's real on-disk reports, every figure carries `measured_at`
  with its precision and source, and the round-trip was verified against a live
  stack — 36 runs served, the newest matching its file field for field.
- **Problem:** the eval store is **read-only committed records**
  (`evals/reports/*.json`). A run dispatched at request time has nowhere to
  persist, so `POST /api/v1/evals/runs` returns 501 with no invented id rather
  than a synthetic 201.
- **Lives in:** `nextjs/src/app/api/v1/evals/runs/route.ts` (POST),
  `rust/services/gateway/src/handlers/evals.rs`; needs a durable eval-run store.
- **Done:** a suite can be dispatched from the dashboard, the run persists to a
  durable store rather than a committed file, and an in-flight run is
  distinguishable from a finished one — `mapGatewayRun` currently hardcodes
  `status: "completed"` because the store only ever holds finished runs, and that
  assumption has to go at the same time.
- **Tracking:** [#46](https://github.com/sattyamjjain/ferrumdeck/issues/46)

### Harden the audit chain-head anchor: robust remote sink + off-host key custody
- **Shipped in 0.7.16 ([#8](https://github.com/sattyamjjain/ferrumdeck/issues/8), closed):**
  the audit trail is append-only (repo API + `trg_audit_events_append_only`
  trigger) **and hash-chained** — migration `20260801000001` adds
  `prev_hash`/`record_hash`/`chain_seq`, `rust/crates/fd-audit/src/chain.rs`
  computes a per-record SHA-256 chained to its predecessor, and
  `AuditRepo::verify_chain` detects any insertion/deletion/edit within a tenant's
  chain.
- **Shipped in 0.8.0 ([#14](https://github.com/sattyamjjain/ferrumdeck/issues/14)):**
  the chain head is now **anchored out-of-band**. `rust/crates/fd-audit/src/checkpoint.rs`
  signs a `(tenant_id, chain_seq, record_hash, checkpointed_at)` head record with
  an Ed25519 key **that is not the database's** (`CheckpointSigner`), appends it to
  an out-of-band sink (`FileCheckpointSink`; the `CheckpointSink` trait takes object
  storage / a transparency log later), and `verify_against_checkpoints` /
  `AuditRepo::verify_against_checkpoints` catch a wholesale self-consistent tail
  rewrite up to the most recent checkpoint. Detectable **up to the last
  checkpoint**; a missing checkpoint degrades to the in-chain guarantee and says so.
- **Problem (the residual):** this is **detection, not prevention — not
  tamper-proof**, and the anchor is only as strong as its deployment. A
  `FileCheckpointSink` on the *same host* as the database is a **weak anchor**: a
  root actor who rewrites `audit_events` can usually rewrite the file too and read
  the signing key if it lives on that host. A robust anchor wants a **remote,
  append-only medium** (object-lock bucket / transparency log) and **off-host key
  custody** (KMS / HSM), plus a scheduled checkpoint driver so the unprotected
  window after the last checkpoint stays small.
- **Regulatory context:** the audit trail is the evidence base for **EU AI Act
  Art. 12/19** (record-keeping / kept logs, applicable **2026-08-02**) and
  **Colorado SB 26-189** (3-year retention floor, effective **2027-01-01**,
  <https://leg.colorado.gov/bills/sb26-189>). Retention says the records still
  exist; the hash-chain + anchored head let a deployer show they were not altered.
- **Lives in:** `rust/crates/fd-audit/src/checkpoint.rs` (the `CheckpointSink`
  trait + signer to extend) + deployment (sink host / key custody separated from
  the DB) + a scheduled checkpoint driver.
- **Done:** checkpoints are written to a remote append-only medium the DB actor
  cannot rewrite, signed by an off-host key, on a configurable schedule, and
  `verify_against_checkpoints` is wired into an operator-facing verify path.
- **Tracking:** [#14](https://github.com/sattyamjjain/ferrumdeck/issues/14)

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

### ~~Dashboard auth/session + SSO/RBAC + API-key self-service~~ — declined
- **Status: not planned.** [#10](https://github.com/sattyamjjain/ferrumdeck/issues/10)
  was closed as not planned on 2026-08-18. It is the feature set of a hosted
  product, and the trusted-operator posture it would replace is stated in two
  places in the README. An identity-aware proxy in front of the dashboard is the
  better answer than a bespoke credential store in a repository whose argument is
  about not granting components more authority than they need.
- Kept here, struck through rather than deleted, because a roadmap that silently
  drops an item leaves the reader unsure whether it was done or forgotten. This
  entry sat here as live work for four days after the issue was declined.

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
