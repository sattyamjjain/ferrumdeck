-- FerrumDeck — per-run Claim Grounding Rate reliability metric (VeriGraph,
-- arXiv:2606.16603).
--
-- Records, on the run row (next to cost/tokens), the fraction of the final
-- output's claims reachable from a tool-output source node, plus a flag set
-- when an OPTIONAL per-project `min_claim_grounding_rate` threshold is breached.
-- The flag is a reliability *signal* — it never changes run status or blocks a
-- tool. Both columns are additive + nullable-or-defaulted so historical runs
-- need no backfill.

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS claim_grounding_rate REAL,
    ADD COLUMN IF NOT EXISTS claim_grounding_flagged BOOLEAN NOT NULL DEFAULT FALSE;
