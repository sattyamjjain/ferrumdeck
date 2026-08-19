-- FerrumDeck — the hash → policy-document map behind the per-decision permission record.
--
-- SAFE ("Shared AI Findings Exchange", Open Secure AI Alliance RFC, 2026-08-04)
-- asks members to preserve "permissions and credentials available during the
-- run". Before this migration the audit trail answered that with a single
-- boolean, `audit_events.details.budget_headroom`. A boolean says whether there
-- was room; it cannot say what the agent was allowed to do, how much budget it
-- had left, or which version of the policy decided — which is the whole of the
-- question an investigator asks after the fact. See
-- docs/compliance/safe-evidence-coverage.md.
--
-- Each decision now carries a `permissions` block in `audit_events.details`
-- holding the identity, the budget remaining as quantities, and a content hash
-- of the policy document that produced the decision. This table resolves that
-- hash back to the document.
--
-- WHY A MAP AND NOT AN INLINE COPY
--   An allowlist is unbounded and identical across millions of decisions, so
--   inlining it would bloat the log without adding information. Storing the
--   hash instead is also *stronger* evidence, not merely smaller: the hash sits
--   inside the audit row, so it is covered by that row's `record_hash` and the
--   per-tenant chain. Editing the allowlist a decision was made under therefore
--   leaves either a hash that resolves to nothing or a broken chain. An inline
--   copy would just be one more mutable blob.
--
-- WHY THE ROWS ARE IMMUTABLE
--   The table is content-addressed: the primary key IS the hash of the value.
--   A row whose document could be edited would break that identity silently and
--   make every historical decision referencing it a lie, while still verifying.
--   So UPDATE is rejected outright.
--
-- WHY DELETE IS RESTRICTED
--   `audit_events` carries a 3-year retention floor (migration
--   20260719000001, Colorado SB 26-189). A decision record that outlives the
--   document it points at is unreconstructable, so documents are held to the
--   same floor. The table is tiny — one row per DISTINCT policy configuration,
--   not per decision — so there is no pressure to prune it.

CREATE TABLE policy_documents (
    -- "sha256:<64 lowercase hex>", computed by fd_policy::PolicyDocument::content_hash
    -- over the canonical JSON encoding (sorted, de-duplicated tool lists).
    content_hash TEXT PRIMARY KEY,

    -- The full fd_policy::PolicyDocument: schema marker, canonical allowlist,
    -- budget caps, enforcement mode.
    document JSONB NOT NULL,

    -- When this configuration was FIRST observed. Not "when it was created" —
    -- the control plane never creates a policy document, it observes the one in
    -- force at a decision and records it if it has not seen it before.
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT policy_documents_hash_format
        CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$')
);

COMMENT ON TABLE policy_documents IS
    'Content-addressed map from a policy-document hash to the document, so an audit record can name the permissions in force without inlining them. Immutable.';

CREATE INDEX idx_policy_documents_first_seen_at ON policy_documents(first_seen_at DESC);

CREATE OR REPLACE FUNCTION enforce_policy_documents_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'policy_documents is content-addressed and immutable: UPDATE is not permitted (content_hash=%). The key is the hash of the value; changing the value silently invalidates every audit record that references it.',
            OLD.content_hash
            USING ERRCODE = 'restrict_violation';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'policy_documents is retained for as long as the audit records that reference it (3-year floor, migration 20260719000001): cannot delete % first seen %.',
            OLD.content_hash, OLD.first_seen_at
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_policy_documents_immutable ON policy_documents;
CREATE TRIGGER trg_policy_documents_immutable
    BEFORE UPDATE OR DELETE ON policy_documents
    FOR EACH ROW
    EXECUTE FUNCTION enforce_policy_documents_immutable();
