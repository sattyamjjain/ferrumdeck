# ADR 0005: Colorado SB 26-189 ADMT record-keeping before the EU AI Act Art. 12 path

## Status

Accepted

## Date

2026-07-19

## Context

FerrumDeck's enforcement plane already carries one regulatory rule — EU AI Act
**Article 50** transparency (`fd_policy::transparency_art50`). Two *record-keeping*
regimes for automated decisions are now on the roadmap, and implementation
bandwidth only allowed one to go first:

1. **Colorado SB 26-189 (2026)** — "Automated Decision-Making Technology." Signed
   **2026-05-14**, effective **2027-01-01**. It rewrote and replaced the 2024
   Colorado AI Act (SB 24-205), retaining a transparency-plus-recordkeeping core
   enforced by the Attorney General. Relevant obligations: notice/disclosure that
   an ADMT was used in a *consequential decision*, and retention of the records
   necessary to demonstrate compliance for **at least 3 years**.
2. **EU AI Act Art. 12 / Art. 19** — record-keeping for high-risk AI systems.
   Art. 12 requires automatic event logging over the system lifetime; Art. 19
   requires providers to keep those logs for a period appropriate to the purpose,
   **at least 6 months** unless other law says otherwise. These high-risk
   obligations phase in on the EU AI Act's later, staggered timeline.

We had to choose which record-keeping rule to build into the enforcement plane
first.

> **Honesty caveat (carried from the implementation).** The bill and its
> requirements (3-year retention, ADMT + consequential-decision definitions,
> effective date) are confirmed from the official bill page and multiple
> independent legal analyses, but the public sources expose the **summary**, not
> the codified C.R.S. subsection numbers. The code and this ADR therefore cite
> SB 26-189 by bill number and requirement rather than inventing `§ 6-1-####`
> strings; confirm the precise subsections against the enrolled act before
> representing compliance.

## Decision

**Implement the Colorado SB 26-189 ADMT record-keeping rule first**
(`fd_policy::colorado_sb26_189` + the storage-layer 3-year retention floor + the
`ferrumdeck.admt_disclosure` decision-span attribute), ahead of the EU AI Act
Art. 12 / Art. 19 logging path. Three reasons:

1. **Nearer effective date.** Colorado's ADMT obligations are operative on
   **2027-01-01** — concrete and imminent. The EU high-risk record-keeping
   obligations apply on a later, staggered schedule, so Colorado is the sooner
   binding constraint.
2. **US buyers.** FerrumDeck's near-term buyers are US enterprises. Colorado is
   the first US state with an operative ADMT record-keeping regime, so this rule
   is the one those buyers ask about first.
3. **The 3-year floor is stricter, so it dominates.** Colorado's **3-year**
   retention floor exceeds the EU Art. 19 **≥6-month** minimum. Building the
   audit trail to the *stricter* floor first means the retention design already
   satisfies the weaker EU minimum; doing the looser one first would have meant
   re-tightening later. Strictest-constraint-first is the safe order.

The rule follows the existing Art. 50 shape exactly (a standalone,
deterministic, pure module: config + status + `check`/`enforce`/`response_level`
on the R1–R3 ladder + a stable anchor), reuses the append-only `audit_events`
trail for the queryable "what decided this" record, and reuses the shared
`fd_otel::emit_tool_decision_span` emitter for the disclosure flag — no parallel
mechanisms.

## Consequences

### Positive

- **Near-term, US-relevant compliance value** for the buyers actually in the
  pipeline, on the sooner deadline.
- **The strictest retention floor is in place first**, so later regimes with
  weaker minimums are already satisfied on the retention axis.
- **Reuses existing patterns** — the Art. 50 rule shape, the append-only audit
  trail with a decision round-trip (`ROUTING_DECIDED`/`PROMOTION_DECIDED`
  precedent), and the one decision-span emitter — so the surface added is small
  and consistent.
- **The retention floor is enforced in storage, not just policy** — a DB trigger
  rejects UPDATE and rejects DELETE within the floor, so the promise cannot be
  bypassed by a future repo method.

### Negative

- **Scope is Colorado-specific.** The rule models ADMT disclosure + a retention
  floor + a decision record; it is **not** the EU Art. 12 lifetime event-logging
  regime, which is broader (granular automatic logs, not just a per-decision
  record). The EU path is still owed.
- **Structural, not legal, compliance.** As with Art. 50, this enforces the
  *form* the statute requires (was a covered decision disclosed? is the record
  retained?), not a legal certification of adequacy. It is not legal advice.
- **Section-number precision deferred.** The exact C.R.S. citations are marked
  "confirm against the enrolled act" rather than asserted.

### Mitigations

- The EU Art. 12 path will be **additive**: it reuses the same R1–R3
  `ResponseLevel` ladder and the same append-only audit trail, so building
  Colorado first does not close the door on it — it lays shared groundwork.
- The retention floor is a single source of truth
  (`fd_policy::colorado_sb26_189::RETENTION_FLOOR_YEARS`) mirrored by
  `fd_storage::AUDIT_RETENTION_FLOOR_YEARS` and the migration's `INTERVAL '3
  years'`, kept in lockstep so a future regime with a different floor changes one
  place.

## Alternatives Considered

### 1. EU AI Act Art. 12 / Art. 19 first
Build the high-risk logging + ≥6-month retention path first.
Rejected: later effective date, its retention minimum is *weaker* than
Colorado's (so it would need re-tightening), and it is less relevant to the
current US buyer pipeline.

### 2. Both at once
Rejected: implementation bandwidth. One well-tested rule beats two half-wired
ones, and the shared ladder/audit design means the second is cheaper later.

### 3. Wait for regulatory guidance
Rejected: Colorado's obligations are operative 2027-01-01; a structural,
opt-in-by-mode enforcement (shadow default) is useful now and safe to ship
before every ambiguity is resolved, given the conservative-reading posture.

## References

- [Colorado SB 26-189 (2026) — Automated Decision-Making Technology](https://leg.colorado.gov/bills/sb26-189)
- EU AI Act (Regulation (EU) 2024/1689) — Art. 12 (record-keeping), Art. 19
  (automatically generated logs, ≥6 months), Art. 50 (transparency)
- [ADR 0004: OpenTelemetry GenAI Semantic Conventions](0004-otel-genai-conventions.md)
  — the decision-span path the `ferrumdeck.admt_disclosure` flag rides
- `rust/crates/fd-policy/src/colorado_sb26_189.rs`,
  `rust/crates/fd-storage/src/retention.rs`,
  `db/migrations/20260719000001_add_audit_retention_floor.sql`
