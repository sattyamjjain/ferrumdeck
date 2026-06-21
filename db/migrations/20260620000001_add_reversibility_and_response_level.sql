-- FerrumDeck — reversibility-aware graduated response (DeepMind AI Control
-- Roadmap R1–R3 ladder).
--
-- Adds an axis ORTHOGONAL to the existing `risk_level` taxonomy:
--   * tools.reversibility    — how recoverable a tool's effect is.
--   * runs.response_level     — the graduated response last applied on the run.
--
-- Both are additive and nullable-or-defaulted so historical rows need no
-- backfill. Stored as TEXT (parsed by `fd_policy::reversibility`) rather than a
-- new PG enum type, to keep the migration self-contained. Deny-by-default: an
-- unclassified tool defaults to 'irreversible' (the most consequential rung).

ALTER TABLE tools
    ADD COLUMN IF NOT EXISTS reversibility TEXT NOT NULL DEFAULT 'irreversible';

ALTER TABLE runs
    ADD COLUMN IF NOT EXISTS response_level TEXT;
