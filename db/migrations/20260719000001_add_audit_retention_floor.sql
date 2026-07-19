-- FerrumDeck — Colorado SB 26-189 (2026) audit-record retention floor.
--
-- SB 26-189 requires records necessary to demonstrate compliance to be retained
-- for at least 3 years. The `audit_events` table was already append-only by
-- convention (no UPDATE/DELETE path exists in any repo method or prior
-- migration). This migration makes that guarantee a hard, database-level
-- property so a retention promise does not live only in a policy struct:
--
--   * BEFORE UPDATE  → always rejected. Audit content is immutable.
--   * BEFORE DELETE  → rejected while the row is younger than the 3-year floor.
--                      A row may be pruned only once it is OLDER than the floor
--                      (the floor is a minimum retention, not a maximum).
--
-- Note on scope: row-level triggers do NOT fire on TRUNCATE, so this does not
-- interfere with whole-table test teardown; it blocks exactly the per-row
-- UPDATE/DELETE paths that could violate the retention promise. The floor here
-- (3 years) mirrors `fd_policy::colorado_sb26_189::RETENTION_FLOOR_YEARS` and
-- `fd_storage::AUDIT_RETENTION_FLOOR_YEARS`; keep the three in lockstep.

CREATE OR REPLACE FUNCTION enforce_audit_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION
            'audit_events is append-only: UPDATE is not permitted (id=%)', OLD.id
            USING ERRCODE = 'restrict_violation';
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.occurred_at > NOW() - INTERVAL '3 years' THEN
            RAISE EXCEPTION
                'audit_events retention floor (Colorado SB 26-189, 3 years): cannot delete record % occurred_at % — still within the retention window',
                OLD.id, OLD.occurred_at
                USING ERRCODE = 'restrict_violation';
        END IF;
    END IF;
    -- DELETE of a row older than the floor falls through and is permitted.
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_events_append_only ON audit_events;
CREATE TRIGGER trg_audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW
    EXECUTE FUNCTION enforce_audit_events_append_only();
