-- FerrumDeck — cryptographic hash-chain over audit_events (tamper-evidence, #8).
--
-- audit_events is already append-only: no repo exposes UPDATE/DELETE, and
-- migration 20260719000001 added trg_audit_events_append_only, which rejects
-- every UPDATE and rejects DELETE within the 3-year retention floor. But a
-- privileged DB actor can drop that trigger and rewrite rows. This migration
-- adds a per-tenant SHA-256 hash-chain so such tampering is *detectable*: each
-- row commits to its predecessor's record_hash, and fd_audit::chain::verify_chain
-- flags any insertion, deletion, or edit within the chain.
--
-- Regulatory context: the audit trail is the evidence base for
--   * EU AI Act Art. 12 (record-keeping / automatic logging) and Art. 19
--     (kept logs) — applicable to GPAI/high-risk obligations from 2026-08-02; and
--   * Colorado SB 26-189 (effective 2027-01-01), whose 3-year retention floor
--     already ships (migration 20260719000001).
-- Retention says "the records still exist"; a hash-chain is what lets a deployer
-- show the retained records "were not altered".
--
-- Residual limitation (documented, not solved here): a hash-chain makes
-- tampering DETECTABLE, not IMPOSSIBLE. An actor who rewrites the entire tail
-- can forge a self-consistent chain unless the chain HEAD is anchored out-of-band
-- (a signed checkpoint / attestation the actor cannot rewrite). That external
-- anchor is tracked in issue #14.

ALTER TABLE audit_events
    ADD COLUMN prev_hash   TEXT,   -- predecessor's record_hash (NULL only at genesis)
    ADD COLUMN record_hash TEXT,   -- lowercase-hex SHA-256 over prev_hash || 0x1f || canonical(record)
    ADD COLUMN chain_seq   BIGINT; -- monotonic per-tenant position (genesis = 1)

-- One chain per tenant, with a sentinel for the NULL tenant so global (system)
-- events form a single chain rather than N distinct NULL "tenants" (NULLs are
-- distinct in a UNIQUE index by default). Partial on chain_seq IS NOT NULL so it
-- constrains only chained rows.
CREATE UNIQUE INDEX idx_audit_events_chain
    ON audit_events (COALESCE(tenant_id, '__ferrumdeck_global__'), chain_seq)
    WHERE chain_seq IS NOT NULL;

-- No backfill. Existing (pre-migration) rows keep NULL prev_hash / record_hash /
-- chain_seq and sit OUTSIDE the chain by design: we do not invent hashes for
-- history we cannot cryptographically vouch for. The chain's genesis is the
-- FIRST row inserted per tenant AFTER this migration (chain_seq = 1, prev_hash
-- NULL); verification runs over the chained rows only.
--
-- No new trigger is needed to protect these columns: enforce_audit_events_append_only()
-- (migration 20260719000001) rejects EVERY UPDATE on audit_events unconditionally,
-- which already covers prev_hash / record_hash / chain_seq. The hashes are
-- write-once via the same guarantee as the rest of the row.
