-- FerrumDeck — per-run coherence-divergence signal (Strained Coherence,
-- arXiv:2606.07889).
--
-- Records, on the run row (next to the claim-grounding flag), whether the live
-- CoherenceMonitor surfaced at least one stated-blocking-fact → contradicting-
-- closure-action divergence on this run's trajectory. The column is nullable
-- with NO default so historical runs that predate the live consumer read as
-- NULL (null-for-legacy) and the dashboard hides the card for them; a run that
-- completes under the live consumer is set to TRUE/FALSE explicitly.
--
-- This is a reliability *signal* — it never changes run status or blocks a
-- tool, mirroring claim_grounding_flagged.

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS coherence_divergence_flagged BOOLEAN;
