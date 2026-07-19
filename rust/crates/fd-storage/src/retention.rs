//! Audit-record retention floor — Colorado SB 26-189 (2026).
//!
//! SB 26-189 requires records necessary to demonstrate compliance to be retained
//! for **at least 3 years**. That floor is enforced in two independent places so
//! it cannot be bypassed:
//!
//! 1. **At the database** — the `20260719000001_add_audit_retention_floor`
//!    migration installs a trigger on `audit_events` that rejects any UPDATE and
//!    rejects a DELETE of a row younger than 3 years.
//! 2. **In this crate** — any prune path must first pass [`check_retention_floor`],
//!    which refuses a requested retention below the statutory minimum *before*
//!    issuing SQL. [`AuditRepo::prune_admt_expired`](crate::repos::AuditRepo::prune_admt_expired)
//!    is the only prune entry point and it is gated by this guard.
//!
//! [`AUDIT_RETENTION_FLOOR_YEARS`] mirrors
//! `fd_policy::colorado_sb26_189::RETENTION_FLOOR_YEARS` (the statutory source of
//! truth) and the `INTERVAL '3 years'` in the migration; keep all three in
//! lockstep.

/// Minimum audit-record retention, in years, required by Colorado SB 26-189.
/// Mirrors `fd_policy::colorado_sb26_189::RETENTION_FLOOR_YEARS`.
pub const AUDIT_RETENTION_FLOOR_YEARS: i64 = 3;

/// Error returned when a prune would retain records for less than the statutory
/// floor.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "retention floor violated: requested {requested} years but Colorado SB 26-189 requires at least {floor} years"
)]
pub struct RetentionFloorError {
    /// The requested retention (years) that was rejected.
    pub requested: i64,
    /// The statutory floor ([`AUDIT_RETENTION_FLOOR_YEARS`]).
    pub floor: i64,
}

/// Error from a guarded audit prune — either the requested retention was below
/// the statutory floor (rejected before any SQL ran) or the delete itself failed.
#[derive(Debug, thiserror::Error)]
pub enum PruneError {
    /// The requested retention was below the statutory floor.
    #[error(transparent)]
    RetentionFloor(#[from] RetentionFloorError),
    /// The underlying delete failed.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Reject a prune whose retention is below the statutory floor.
///
/// Returns the validated retention (in years) when it meets the floor, or a
/// [`RetentionFloorError`] otherwise — a pure check with no database access, so
/// an "early prune" is refused before any SQL runs.
pub fn check_retention_floor(requested_years: i64) -> Result<i64, RetentionFloorError> {
    if requested_years < AUDIT_RETENTION_FLOOR_YEARS {
        Err(RetentionFloorError {
            requested: requested_years,
            floor: AUDIT_RETENTION_FLOOR_YEARS,
        })
    } else {
        Ok(requested_years)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_retention_below_the_floor() {
        // An "early prune" — anything under 3 years — is refused.
        for y in [0, 1, 2] {
            let err = check_retention_floor(y).expect_err("must reject early prune");
            assert_eq!(err.requested, y);
            assert_eq!(err.floor, AUDIT_RETENTION_FLOOR_YEARS);
        }
    }

    #[test]
    fn accepts_retention_at_or_above_the_floor() {
        for y in [3, 4, 7, 10] {
            assert_eq!(check_retention_floor(y).unwrap(), y);
        }
    }

    #[test]
    fn floor_is_three_years() {
        assert_eq!(AUDIT_RETENTION_FLOOR_YEARS, 3);
    }
}
