//! Delegation-aware budget leases.
//!
//! The existing [`BudgetUsage::check_against`](crate::budget::BudgetUsage::check_against)
//! gate is *stateless*: it compares an accumulated usage snapshot against a
//! [`Budget`](crate::budget::Budget) cap. That is correct for a single linear
//! run, but it has a known failure mode under **delegation fan-out** — the
//! Token-Budgets delegation class ([arXiv:2606.04056]). When a parent task
//! delegates to N children and each child checks its own spend against the same
//! parent cap, the children can collectively spend up to `N ×` the cap: every
//! child believes it owns the whole budget.
//!
//! A [`BudgetLease`] closes that gap. All leases descended from one root share a
//! single atomic remaining-budget pool ([`SharedBudget`]) — the one source of
//! truth for the entire delegation tree. A child is handed a *sub-lease carved
//! from* the parent's authority (not a copy placed alongside it), and every
//! [`BudgetLease::spend`] decrements the single shared pool. Total spend across
//! parent + all children therefore can never exceed the root cap, regardless of
//! how the tree fans out or how concurrently the children run.
//!
//! Ownership does the rest of the work: [`BudgetLease`] is intentionally **not**
//! [`Copy`] and **not** [`Clone`], so a lease moved into a delegated child cannot
//! also be used by the parent — that is a compile error, not a runtime check.
//! The runtime path ([`LeaseError::Inactive`]) only backstops the cases the
//! borrow checker cannot see (e.g. a lease retained past [`BudgetLease::close`]).
//!
//! [arXiv:2606.04056]: https://arxiv.org/abs/2606.04056

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// Paper this primitive is anchored on (Token Budgets, delegation-fanout class).
pub const LEASE_ANCHOR: &str = "arXiv:2606.04056";

/// The single shared remaining-budget pool for one delegation tree.
///
/// Every [`BudgetLease`] descended from a common root holds an `Arc` to the
/// *same* `SharedBudget`. Spending is an atomic, lock-free reservation that can
/// never take the pool below zero — this is the hard ceiling for the whole tree.
#[derive(Debug)]
pub struct SharedBudget {
    /// Budget units still available across the entire delegation tree.
    remaining: AtomicU64,
}

impl SharedBudget {
    fn new(total: u64) -> Arc<Self> {
        Arc::new(Self {
            remaining: AtomicU64::new(total),
        })
    }

    /// Units still spendable across the whole tree, right now.
    pub fn remaining(&self) -> u64 {
        self.remaining.load(Ordering::SeqCst)
    }

    /// Atomically reserve `amount` from the shared pool.
    ///
    /// Returns `true` iff the full `amount` was available and has been removed.
    /// The reservation is all-or-nothing: a failed take removes nothing, so the
    /// pool can never go negative even under concurrent contention.
    fn try_take(&self, amount: u64) -> bool {
        self.remaining
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |cur| {
                cur.checked_sub(amount)
            })
            .is_ok()
    }
}

/// Why a lease operation was rejected.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LeaseError {
    /// The request exceeded this lease's own carved spending authority.
    #[error("lease cap exceeded: requested {requested}, cap {cap}")]
    LocalCapExceeded { requested: u64, cap: u64 },

    /// The shared pool for the whole delegation tree is exhausted.
    #[error("shared budget exhausted: requested {requested}, pool remaining {pool_remaining}")]
    PoolExhausted { requested: u64, pool_remaining: u64 },

    /// The lease was already consumed (e.g. via [`BudgetLease::close`]).
    #[error("lease is no longer active")]
    Inactive,
}

/// A move-only handle to a slice of a shared delegation budget.
///
/// Not [`Copy`], not [`Clone`]: handing a lease to a delegated child *moves* it,
/// so the parent cannot keep spending the same authority. See the module docs.
///
/// # Move semantics are enforced at compile time
///
/// [`close`](BudgetLease::close) consumes the lease by value, so any use after
/// closing fails to compile:
///
/// ```compile_fail
/// use fd_policy::lease::BudgetLease;
/// let mut root = BudgetLease::root(100);
/// let _unused = root.close();          // moves `root`
/// let _ = root.remaining_cap();        // error[E0382]: borrow of moved value
/// ```
#[derive(Debug)]
pub struct BudgetLease {
    /// The single shared pool, shared by every lease in this delegation tree.
    pool: Arc<SharedBudget>,
    /// Spending authority still held *by this lease* (carved from its parent).
    cap: u64,
    /// Cleared once the lease is consumed; gates the runtime-rejected path.
    active: bool,
}

impl BudgetLease {
    /// Create the root lease for a fresh delegation tree.
    ///
    /// The root holds the full `total` as both its shared pool and its own cap.
    pub fn root(total: u64) -> Self {
        Self {
            pool: SharedBudget::new(total),
            cap: total,
            active: true,
        }
    }

    /// Spend `amount` units against this lease.
    ///
    /// Rejected — spending nothing — if it would exceed *either* this lease's own
    /// carved cap *or* the shared pool. The pool decrement is atomic, so this is
    /// the enforcement point that makes total tree spend never exceed the root.
    pub fn spend(&mut self, amount: u64) -> Result<(), LeaseError> {
        if !self.active {
            return Err(LeaseError::Inactive);
        }
        if amount == 0 {
            return Ok(());
        }
        if amount > self.cap {
            return Err(LeaseError::LocalCapExceeded {
                requested: amount,
                cap: self.cap,
            });
        }
        // Reserve from the single shared pool — the hard ceiling for the whole
        // delegation tree. Atomic + all-or-nothing, so concurrent children can
        // never collectively overshoot.
        if !self.pool.try_take(amount) {
            return Err(LeaseError::PoolExhausted {
                requested: amount,
                pool_remaining: self.pool.remaining(),
            });
        }
        self.cap -= amount;
        Ok(())
    }

    /// Carve a sub-lease of `amount` out of this lease's authority.
    ///
    /// The `amount` is moved *out of* the parent's cap (not copied alongside it),
    /// so authority is conserved: the parent can no longer spend the carved
    /// slice. The child shares the *same* pool, so its spend draws down the one
    /// shared remaining-budget. This is the recommended delegation primitive.
    pub fn delegate(&mut self, amount: u64) -> Result<BudgetLease, LeaseError> {
        if !self.active {
            return Err(LeaseError::Inactive);
        }
        if amount > self.cap {
            return Err(LeaseError::LocalCapExceeded {
                requested: amount,
                cap: self.cap,
            });
        }
        self.cap -= amount;
        Ok(BudgetLease {
            pool: Arc::clone(&self.pool),
            cap: amount,
            active: true,
        })
    }

    /// Spawn a child that draws from the shared pool, bounded only by whatever is
    /// globally left right now.
    ///
    /// This models the *dangerous* fan-out the paper warns about — a child handed
    /// authority up to the full remaining budget — done *safely*: because the
    /// child shares the one atomic pool, N such children still cannot collectively
    /// overshoot the root cap. (The naive bug copies the remaining-budget per
    /// child instead of sharing it; that is what overshoots `N ×`.)
    pub fn subordinate(&self) -> BudgetLease {
        BudgetLease {
            pool: Arc::clone(&self.pool),
            cap: self.pool.remaining(),
            active: true,
        }
    }

    /// Spending authority still held by this lease.
    pub fn remaining_cap(&self) -> u64 {
        if self.active {
            self.cap
        } else {
            0
        }
    }

    /// Units still spendable across the whole delegation tree.
    pub fn pool_remaining(&self) -> u64 {
        self.pool.remaining()
    }

    /// Whether this lease can still be spent.
    pub fn is_active(&self) -> bool {
        self.active
    }

    /// Consume the lease, returning its unused carved authority.
    ///
    /// Takes `self` by value: the move makes any later use a compile error (see
    /// the type-level doctest). Unused authority is *not* returned to the pool —
    /// the pool already reflects only actual spend, so under-spending simply
    /// leaves headroom for the rest of the tree.
    pub fn close(mut self) -> u64 {
        let unused = self.cap;
        self.active = false;
        self.cap = 0;
        unused
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn root_holds_full_budget_on_both_axes() {
        let lease = BudgetLease::root(100);
        assert_eq!(lease.remaining_cap(), 100);
        assert_eq!(lease.pool_remaining(), 100);
        assert!(lease.is_active());
    }

    #[test]
    fn spend_decrements_cap_and_pool_together() {
        let mut lease = BudgetLease::root(100);
        lease.spend(30).unwrap();
        assert_eq!(lease.remaining_cap(), 70);
        assert_eq!(lease.pool_remaining(), 70);
    }

    #[test]
    fn spend_beyond_local_cap_is_rejected_and_spends_nothing() {
        let mut lease = BudgetLease::root(100);
        let err = lease.spend(101).unwrap_err();
        assert_eq!(
            err,
            LeaseError::LocalCapExceeded {
                requested: 101,
                cap: 100
            }
        );
        // Nothing was taken.
        assert_eq!(lease.pool_remaining(), 100);
    }

    #[test]
    fn delegate_carves_authority_out_of_parent() {
        let mut parent = BudgetLease::root(100);
        let child = parent.delegate(40).unwrap();
        // Authority conserved: 60 parent + 40 child == 100, pool unchanged.
        assert_eq!(parent.remaining_cap(), 60);
        assert_eq!(child.remaining_cap(), 40);
        assert_eq!(parent.pool_remaining(), 100);
        assert_eq!(child.pool_remaining(), 100);
    }

    #[test]
    fn child_spend_draws_down_the_shared_pool() {
        let mut parent = BudgetLease::root(100);
        let mut child = parent.delegate(40).unwrap();
        child.spend(25).unwrap();
        // The parent sees the child's spend reflected in the shared pool.
        assert_eq!(parent.pool_remaining(), 75);
        assert_eq!(child.remaining_cap(), 15);
        assert_eq!(parent.remaining_cap(), 60); // parent's own authority untouched
    }

    #[test]
    fn delegating_more_than_held_is_rejected() {
        let mut parent = BudgetLease::root(50);
        assert_eq!(
            parent.delegate(51).unwrap_err(),
            LeaseError::LocalCapExceeded {
                requested: 51,
                cap: 50
            }
        );
    }

    #[test]
    fn close_consumes_and_reports_unused_authority() {
        let mut lease = BudgetLease::root(100);
        lease.spend(30).unwrap();
        assert_eq!(lease.close(), 70);
    }

    /// The paper's experiment: 1 parent → 3 children, concurrent spend.
    ///
    /// With a single shared pool the tree can never overshoot the root cap, no
    /// matter how aggressively the children spend. The naive copied-counter
    /// baseline (each child gets its own counter) overshoots `~N ×`.
    #[test]
    fn fanout_under_concurrent_spend_never_overshoots_root_cap() {
        const CAP: u64 = 9_000;
        const CHILDREN: u64 = 3;

        // --- Shared-pool lease: each child may try to spend the WHOLE remaining
        //     budget (over-allocated authority), but all draw from one pool. ---
        let root = BudgetLease::root(CAP);
        let handles: Vec<_> = (0..CHILDREN)
            .map(|_| {
                // subordinate() hands the child a cap equal to the full remaining
                // budget — the worst-case fan-out — yet sharing the one pool.
                let mut child = root.subordinate();
                thread::spawn(move || {
                    let mut spent = 0u64;
                    // Hammer 1 unit at a time until the shared pool refuses.
                    while child.spend(1).is_ok() {
                        spent += 1;
                    }
                    spent
                })
            })
            .collect();

        let lease_total: u64 = handles.into_iter().map(|h| h.join().unwrap()).sum();

        // 0/N overshoot: total actual spend is exactly the cap, never more.
        assert_eq!(lease_total, CAP, "shared-pool fan-out must not overshoot");
        assert_eq!(root.pool_remaining(), 0);

        // --- Naive copied-counter baseline: each child gets its OWN counter
        //     initialized to the full cap. This is the bug the lease fixes. ---
        let baseline_handles: Vec<_> = (0..CHILDREN)
            .map(|_| {
                thread::spawn(move || {
                    // A private copy of "remaining = CAP" per child.
                    let mut remaining = CAP;
                    let mut spent = 0u64;
                    while remaining > 0 {
                        remaining -= 1;
                        spent += 1;
                    }
                    spent
                })
            })
            .collect();

        let baseline_total: u64 = baseline_handles
            .into_iter()
            .map(|h| h.join().unwrap())
            .sum();

        // The baseline overshoots by ~(N-1)× the cap — documents the failure mode
        // the shared pool eliminates.
        assert_eq!(baseline_total, CAP * CHILDREN);
        assert!(
            baseline_total > CAP,
            "naive copied-counter baseline overshoots the cap"
        );
        assert!(
            lease_total < baseline_total,
            "shared-pool lease must spend strictly less than the copied-counter baseline"
        );
    }

    #[test]
    fn carved_fanout_conserves_authority_exactly() {
        // Equal carve across 3 children leaves the parent with nothing and the
        // children collectively holding the whole cap — no slice is duplicated.
        let mut parent = BudgetLease::root(90);
        let a = parent.delegate(30).unwrap();
        let b = parent.delegate(30).unwrap();
        let c = parent.delegate(30).unwrap();
        assert_eq!(parent.remaining_cap(), 0);
        assert_eq!(
            a.remaining_cap() + b.remaining_cap() + c.remaining_cap(),
            90
        );
        // A fourth carve now has no authority to draw from.
        assert_eq!(
            parent.delegate(1).unwrap_err(),
            LeaseError::LocalCapExceeded {
                requested: 1,
                cap: 0
            }
        );
    }

    #[test]
    fn spend_after_close_is_runtime_rejected() {
        // The borrow checker stops use-after-move; for any handle that outlives
        // its logical lifetime by other means, the active flag backstops it.
        let mut lease = BudgetLease::root(10);
        lease.active = false; // simulate a consumed-but-retained handle
        assert_eq!(lease.spend(1).unwrap_err(), LeaseError::Inactive);
        assert_eq!(lease.delegate(1).unwrap_err(), LeaseError::Inactive);
    }
}
