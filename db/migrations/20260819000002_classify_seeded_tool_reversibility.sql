-- FerrumDeck — classify the four dev-seed tools on the reversibility ladder.
--
-- Migration 20260620000001 added `tools.reversibility` with a deliberate
-- `NOT NULL DEFAULT 'irreversible'`: an unclassified tool is treated as
-- unrecoverable, which is the deny-by-default direction and is correct for a
-- tool nobody has assessed.
--
-- What it did NOT do is classify the tools the dev seed
-- (20241223000002_seed_dev_data.sql) inserts. So every seeded tool -- including
-- `git_read`, which reads a file -- has been sitting at `irreversible` and
-- therefore at rung R3, which always requires approval. The visible effect is
-- that on a freshly seeded stack the demo agent cannot execute ANY of the four
-- tools on its own allowlist: every call comes back
-- `requires_approval: true, reason: "reversibility ladder (irreversible, R3)"`.
--
-- That makes the quickstart misrepresent the product in both directions. The
-- allow path is never demonstrated, and the R1-R3 ladder looks like a blanket
-- gate rather than a graduated one, which is the opposite of the claim. It also
-- meant the security and chaos suites could not test the allow path at all --
-- several of them assert "an allowlisted, benign tool is permitted" and were
-- failing against a correctly-functioning engine.
--
-- Classification, matching the definitions in fd_policy::reversibility:
--   git_read          reversible    -- reads a file; undoing it is a no-op
--   test_run          reversible    -- runs the suite in a sandbox, no durable effect
--   git_write         costly        -- recoverable from git history, but real work (R2)
--   github_create_pr  irreversible  -- an external send; the notification cannot be unsent
--
-- Scoped by id to the seeded rows only. A deployment that has since edited
-- these tools keeps its own values, and no tool outside the seed is touched --
-- in particular this does not weaken the `irreversible` default for anything
-- unclassified.

UPDATE tools SET reversibility = 'reversible'
 WHERE id IN ('tol_01JFVX0000000000000000001',   -- git_read
              'tol_01JFVX0000000000000000003')   -- test_run
   AND reversibility = 'irreversible';

UPDATE tools SET reversibility = 'costly'
 WHERE id = 'tol_01JFVX0000000000000000002'      -- git_write
   AND reversibility = 'irreversible';

-- github_create_pr is left at 'irreversible' deliberately: it is an external
-- send, and it is the one seeded tool that SHOULD demonstrate the R3 approval
-- gate. Stated here rather than left implicit, so a later reader does not
-- "finish the job" by reclassifying it.
