//! Permissions and credentials in force at the moment of a decision.
//!
//! Most agent stacks resolve permission at call time and never persist it. The
//! call is allowed or refused, the allowlist that decided it stays in a config
//! file that has since been edited, and afterwards nobody can answer *what was
//! this agent allowed to do at 14:32 on the 3rd*. FerrumDeck has a policy plane
//! in the path of every tool call, which makes it one of the few places that
//! can answer it — but only if the answer is written down at decision time.
//!
//! This module is that record. It is the evidence class SAFE calls
//! "permissions and credentials available during the run"
//! (see `docs/compliance/safe-evidence-coverage.md`).
//!
//! ## What goes in the log, and what does not
//!
//! A [`PermissionSnapshot`] rides on every decision's audit record. It carries
//! the identity the decision was made *for*, the budget actually remaining, and
//! a [`PolicyDocument::content_hash`] — **not** the policy document itself.
//!
//! The document is stored once, keyed by that hash, in a separate map
//! (`policy_documents`). Two properties follow, and both matter:
//!
//! * **The log stays small.** An allowlist is unbounded and identical across
//!   millions of decisions; a hash is 71 bytes and constant.
//! * **The answer stays reconstructable, and tamper-evident.** The hash is
//!   inside the audit row, so it is covered by the audit chain's
//!   `record_hash`. Editing the allowlist a decision was made under means
//!   either leaving a hash that no longer resolves, or breaking the chain.
//!   Storing the allowlist inline would be weaker: it would be one more mutable
//!   blob rather than a commitment.
//!
//! A small [`AllowlistDigest`] (counts only) is kept inline so a reader
//! skimming raw rows can tell a 3-tool agent from a 300-tool one without
//! resolving anything. It is a convenience, never the source of truth.
//!
//! ## The invariant
//!
//! Given only `audit_events` and `policy_documents` — no running gateway, no
//! agent registry, no config repo — a reader can reconstruct the complete
//! answer to "what was this identity permitted to do at time T" for any T in
//! the log. `rust/crates/fd-storage/tests/permission_reconstruction.rs` asserts
//! exactly that, across a policy change, against a real database.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::budget::{Budget, BudgetUsage};
use crate::rules::ToolAllowlist;

/// Schema marker on a stored policy document. Bump when the document's shape
/// changes in a way that changes its meaning — the hash is over the whole
/// document including this field, so a bump re-keys every document and old
/// records keep resolving to the old shape.
pub const POLICY_DOCUMENT_SCHEMA: &str = "ferrumdeck.policy-document.v1";

/// Schema marker on the per-decision snapshot embedded in `audit_events.details`.
pub const PERMISSION_SNAPSHOT_SCHEMA: &str = "ferrumdeck.permission-snapshot.v1";

/// An allowlist in canonical form: sorted and de-duplicated, so that two
/// logically identical allowlists hash identically regardless of the order the
/// registry happened to return them in.
///
/// Without this, a harmless reordering in the agent registry would mint a new
/// policy document on every decision and the map would grow without bound.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CanonicalAllowlist {
    pub allowed: Vec<String>,
    pub approval_required: Vec<String>,
    pub denied: Vec<String>,
}

fn canonical(items: &[String]) -> Vec<String> {
    let mut v: Vec<String> = items.to_vec();
    v.sort();
    v.dedup();
    v
}

impl From<&ToolAllowlist> for CanonicalAllowlist {
    fn from(a: &ToolAllowlist) -> Self {
        Self {
            allowed: canonical(&a.allowed_tools),
            approval_required: canonical(&a.approval_required),
            denied: canonical(&a.denied_tools),
        }
    }
}

/// Counts only — an at-a-glance shape for raw-row readers. Never authoritative;
/// resolve [`PermissionSnapshot::policy_hash`] for the real list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AllowlistDigest {
    pub allowed: usize,
    pub approval_required: usize,
    pub denied: usize,
}

impl From<&CanonicalAllowlist> for AllowlistDigest {
    fn from(a: &CanonicalAllowlist) -> Self {
        Self {
            allowed: a.allowed.len(),
            approval_required: a.approval_required.len(),
            denied: a.denied.len(),
        }
    }
}

/// The complete set of permissions in force for one identity at one instant —
/// everything that determines *what the agent could have done*, independent of
/// what it actually attempted.
///
/// Content-addressed: see [`Self::content_hash`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PolicyDocument {
    pub schema: String,
    pub allowlist: CanonicalAllowlist,
    pub budget: Budget,
    /// `enforce` or `shadow`. A shadow-mode decision permitted everything it
    /// logged as blocked, which is a different fact about the run, so it is
    /// part of the document rather than the snapshot.
    pub enforcement_mode: String,
}

impl PolicyDocument {
    pub fn new(allowlist: &ToolAllowlist, budget: &Budget, enforcement_mode: &str) -> Self {
        Self {
            schema: POLICY_DOCUMENT_SCHEMA.to_string(),
            allowlist: CanonicalAllowlist::from(allowlist),
            budget: budget.clone(),
            enforcement_mode: enforcement_mode.to_string(),
        }
    }

    /// Stable `sha256:<hex>` over the canonical JSON encoding.
    ///
    /// Deterministic because every field is a struct or a sorted `Vec` — there
    /// is no map anywhere in the document, so `serde_json` emits fields in
    /// declaration order and the bytes are reproducible across processes and
    /// releases. `hash_is_stable_across_field_order` pins that.
    pub fn content_hash(&self) -> String {
        let bytes = serde_json::to_vec(self).expect("PolicyDocument is always serializable");
        format!("sha256:{}", hex::encode(Sha256::digest(&bytes)))
    }

    /// Whether this document permitted `tool` outright at the instant it was in
    /// force. Deny beats approval beats allow, matching
    /// [`ToolAllowlist::check`] and the engine's precedence order.
    pub fn permits(&self, tool: &str) -> ToolPermission {
        let t = tool.to_string();
        if self.allowlist.denied.contains(&t) {
            ToolPermission::Denied
        } else if self.allowlist.approval_required.contains(&t) {
            ToolPermission::RequiresApproval
        } else if self.allowlist.allowed.contains(&t) {
            ToolPermission::Allowed
        } else {
            // Deny-by-default: absence is a denial, not an omission.
            ToolPermission::Denied
        }
    }
}

/// What a policy document said about one tool.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermission {
    Allowed,
    RequiresApproval,
    Denied,
}

/// Who the decision was made *for*, and under which credential.
///
/// Distinct from the audit record's `actor`, which is the component that
/// performed the evaluation (the gateway). SAFE asks for "agent and workload
/// identities"; this is both, plus the credential id that presented the call.
///
/// `api_key_id` is an identifier only. No secret, hash or prefix of a secret
/// ever enters an audit record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DecisionIdentity {
    pub tenant_id: String,
    pub project_id: String,
    /// `None` when the run's agent version could not be resolved — which is
    /// itself the deny-by-default path, and worth recording as absent rather
    /// than papering over with a placeholder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    pub agent_version_id: String,
    pub run_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key_id: Option<String>,
}

/// Budget headroom at decision time, as quantities.
///
/// The pre-existing record carried a single boolean (`budget_headroom`). A
/// boolean answers "was there room" but not "how much", so it cannot
/// distinguish a run that stopped with 99% of its budget unspent from one that
/// stopped one cent short — which is exactly the question asked after an
/// incident involving spend.
///
/// `*_remaining` is `None` when the corresponding cap is unset (unbounded).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BudgetRemaining {
    pub cost_cents_limit: Option<u64>,
    pub cost_cents_used: u64,
    pub cost_cents_remaining: Option<u64>,
    pub tool_calls_limit: Option<u32>,
    pub tool_calls_used: u32,
    pub tool_calls_remaining: Option<u32>,
    pub total_tokens_limit: Option<u64>,
    pub total_tokens_used: u64,
    pub total_tokens_remaining: Option<u64>,
}

impl BudgetRemaining {
    pub fn new(budget: &Budget, usage: &BudgetUsage) -> Self {
        Self {
            cost_cents_limit: budget.max_cost_cents,
            cost_cents_used: usage.cost_cents,
            cost_cents_remaining: budget.cost_remaining_cents(usage),
            tool_calls_limit: budget.max_tool_calls,
            tool_calls_used: usage.tool_calls,
            tool_calls_remaining: budget
                .max_tool_calls
                .map(|cap| cap.saturating_sub(usage.tool_calls)),
            total_tokens_limit: budget.max_total_tokens,
            total_tokens_used: usage.total_tokens(),
            total_tokens_remaining: budget
                .max_total_tokens
                .map(|cap| cap.saturating_sub(usage.total_tokens())),
        }
    }
}

/// The per-decision permission record written into `audit_events.details`
/// under the `permissions` key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionSnapshot {
    pub schema: String,
    pub identity: DecisionIdentity,
    /// Resolves against `policy_documents.content_hash`.
    pub policy_hash: String,
    pub budget_remaining: BudgetRemaining,
    pub allowlist_digest: AllowlistDigest,
}

impl PermissionSnapshot {
    pub fn new(
        identity: DecisionIdentity,
        document: &PolicyDocument,
        usage: &BudgetUsage,
    ) -> (Self, String) {
        let policy_hash = document.content_hash();
        let snapshot = Self {
            schema: PERMISSION_SNAPSHOT_SCHEMA.to_string(),
            identity,
            policy_hash: policy_hash.clone(),
            budget_remaining: BudgetRemaining::new(&document.budget, usage),
            allowlist_digest: AllowlistDigest::from(&document.allowlist),
        };
        (snapshot, policy_hash)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowlist(allowed: &[&str], approval: &[&str], denied: &[&str]) -> ToolAllowlist {
        ToolAllowlist {
            allowed_tools: allowed.iter().map(|s| s.to_string()).collect(),
            approval_required: approval.iter().map(|s| s.to_string()).collect(),
            denied_tools: denied.iter().map(|s| s.to_string()).collect(),
        }
    }

    // =========================================================================
    // PERM-001: the hash is a content hash, not an identity hash
    // =========================================================================
    #[test]
    fn hash_is_stable_across_field_order() {
        let a = PolicyDocument::new(
            &allowlist(&["git_read", "test_run"], &["git_write"], &["shell_exec"]),
            &Budget::default(),
            "enforce",
        );
        // Same content, different declaration order from the registry.
        let b = PolicyDocument::new(
            &allowlist(&["test_run", "git_read"], &["git_write"], &["shell_exec"]),
            &Budget::default(),
            "enforce",
        );
        assert_eq!(a.content_hash(), b.content_hash());
        assert_eq!(a, b);
    }

    #[test]
    fn hash_is_stable_across_duplicates() {
        let a = PolicyDocument::new(
            &allowlist(&["git_read"], &[], &[]),
            &Budget::default(),
            "enforce",
        );
        let b = PolicyDocument::new(
            &allowlist(&["git_read", "git_read"], &[], &[]),
            &Budget::default(),
            "enforce",
        );
        assert_eq!(a.content_hash(), b.content_hash());
    }

    #[test]
    fn hash_is_reproducible_across_calls() {
        let d = PolicyDocument::new(
            &allowlist(&["a"], &["b"], &["c"]),
            &Budget::default(),
            "enforce",
        );
        assert_eq!(d.content_hash(), d.content_hash());
        assert!(d.content_hash().starts_with("sha256:"));
        // sha256: + 64 hex
        assert_eq!(d.content_hash().len(), 7 + 64);
    }

    // =========================================================================
    // PERM-002: every field that changes what is permitted changes the hash
    // =========================================================================
    #[test]
    fn changing_the_allowlist_changes_the_hash() {
        let before = PolicyDocument::new(
            &allowlist(&["git_read", "git_write"], &[], &[]),
            &Budget::default(),
            "enforce",
        );
        let after = PolicyDocument::new(
            &allowlist(&["git_read"], &[], &[]),
            &Budget::default(),
            "enforce",
        );
        assert_ne!(before.content_hash(), after.content_hash());
    }

    #[test]
    fn changing_the_budget_changes_the_hash() {
        let tighter = Budget {
            max_cost_cents: Some(1),
            ..Budget::default()
        };
        let a = PolicyDocument::new(&allowlist(&["x"], &[], &[]), &Budget::default(), "enforce");
        let b = PolicyDocument::new(&allowlist(&["x"], &[], &[]), &tighter, "enforce");
        assert_ne!(a.content_hash(), b.content_hash());
    }

    #[test]
    fn changing_the_enforcement_mode_changes_the_hash() {
        let a = PolicyDocument::new(&allowlist(&["x"], &[], &[]), &Budget::default(), "enforce");
        let b = PolicyDocument::new(&allowlist(&["x"], &[], &[]), &Budget::default(), "shadow");
        assert_ne!(a.content_hash(), b.content_hash());
    }

    // =========================================================================
    // PERM-003: `permits` reproduces the engine's precedence, deny-by-default
    // =========================================================================
    #[test]
    fn permits_follows_deny_then_approval_then_allow() {
        let doc = PolicyDocument::new(
            &allowlist(
                &["git_read", "both"],
                &["git_write", "both"],
                &["shell_exec", "both"],
            ),
            &Budget::default(),
            "enforce",
        );
        assert_eq!(doc.permits("git_read"), ToolPermission::Allowed);
        assert_eq!(doc.permits("git_write"), ToolPermission::RequiresApproval);
        assert_eq!(doc.permits("shell_exec"), ToolPermission::Denied);
        // Listed in all three tiers: deny wins.
        assert_eq!(doc.permits("both"), ToolPermission::Denied);
    }

    #[test]
    fn an_unlisted_tool_is_denied_not_unknown() {
        let doc = PolicyDocument::new(
            &allowlist(&["git_read"], &[], &[]),
            &Budget::default(),
            "enforce",
        );
        assert_eq!(doc.permits("anything_else"), ToolPermission::Denied);
    }

    // =========================================================================
    // PERM-004: budget is recorded as a quantity, not a boolean
    // =========================================================================
    #[test]
    fn budget_remaining_records_quantities() {
        let budget = Budget {
            max_cost_cents: Some(500),
            max_tool_calls: Some(50),
            max_total_tokens: Some(150_000),
            ..Budget::default()
        };
        let usage = BudgetUsage {
            input_tokens: 1_000,
            output_tokens: 500,
            tool_calls: 7,
            wall_time_ms: 0,
            cost_cents: 499,
        };
        let r = BudgetRemaining::new(&budget, &usage);
        // One cent short of the cap is a different fact from "has headroom".
        assert_eq!(r.cost_cents_remaining, Some(1));
        assert_eq!(r.cost_cents_used, 499);
        assert_eq!(r.tool_calls_remaining, Some(43));
        assert_eq!(r.total_tokens_remaining, Some(148_500));
    }

    #[test]
    fn an_unset_cap_is_unbounded_not_zero() {
        let budget = Budget {
            max_cost_cents: None,
            max_tool_calls: None,
            max_total_tokens: None,
            ..Budget::default()
        };
        let r = BudgetRemaining::new(&budget, &BudgetUsage::default());
        assert_eq!(r.cost_cents_remaining, None);
        assert_eq!(r.tool_calls_remaining, None);
        assert_eq!(r.total_tokens_remaining, None);
    }

    #[test]
    fn overspend_saturates_at_zero_rather_than_underflowing() {
        let budget = Budget {
            max_cost_cents: Some(100),
            ..Budget::default()
        };
        let usage = BudgetUsage {
            cost_cents: 250,
            ..BudgetUsage::default()
        };
        assert_eq!(
            BudgetRemaining::new(&budget, &usage).cost_cents_remaining,
            Some(0)
        );
    }

    // =========================================================================
    // PERM-005: the snapshot carries no secret
    // =========================================================================
    #[test]
    fn snapshot_round_trips_and_carries_the_hash_not_the_document() {
        let doc = PolicyDocument::new(
            &allowlist(&["git_read"], &["git_write"], &["shell_exec"]),
            &Budget::default(),
            "enforce",
        );
        let identity = DecisionIdentity {
            tenant_id: "tnt_1".into(),
            project_id: "prj_1".into(),
            agent_id: Some("agt_1".into()),
            agent_version_id: "agv_1".into(),
            run_id: "run_1".into(),
            api_key_id: Some("key_1".into()),
        };
        let (snap, hash) = PermissionSnapshot::new(identity, &doc, &BudgetUsage::default());

        assert_eq!(snap.policy_hash, hash);
        assert_eq!(snap.allowlist_digest.allowed, 1);
        assert_eq!(snap.allowlist_digest.approval_required, 1);
        assert_eq!(snap.allowlist_digest.denied, 1);

        let json = serde_json::to_string(&snap).unwrap();
        // The tool names live behind the hash, not in the row.
        assert!(
            !json.contains("git_read"),
            "allowlist must not be inlined: {json}"
        );
        assert!(json.contains("sha256:"));
        assert!(json.contains("agt_1"));

        let back: PermissionSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(back, snap);
    }
}
