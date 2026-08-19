//! The invariant: given only the audit log and the policy map, a reader can
//! reconstruct the complete answer to "what was this identity permitted to do
//! at time T" for any T in the log, without access to the running system.
//!
//! This is an integration test on purpose. The claim is about what survives in
//! a database after the process that wrote it is gone, so a unit test on the
//! types would assert the wrong thing: it would prove the structs serialize,
//! not that the answer is recoverable. Everything here goes through the real
//! `AuditRepo::create` (hash chain included) and the real
//! `PoliciesRepo::reconstruct_permissions_at`.
//!
//! The hard case is a POLICY CHANGE mid-log. An agent permitted to write on
//! Monday and not on Tuesday is the whole reason to record permissions per
//! decision rather than reading today's config; a reconstruction that answers
//! "what is it allowed now" is worthless and looks identical to a correct one
//! until exactly the moment it matters.
//!
//! Run with a database:
//!     DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck \
//!         cargo test -p fd-storage --test permission_reconstruction -- --ignored
//!
//! `make test-integration` runs it as part of `cargo test -- --ignored`.

use chrono::Utc;
use fd_policy::budget::{Budget, BudgetUsage};
use fd_policy::{
    DecisionIdentity, PermissionSnapshot, PolicyDocument, ToolAllowlist, ToolPermission,
};
use fd_storage::models::{action, actor, resource, AuditEventBuilder};
use fd_storage::repos::{AuditRepo, PoliciesRepo};

/// The dev database URL, following the convention already set by
/// `fd_storage::migrations`'s own `#[ignore]`d tests: default to the
/// `make dev-up` address rather than skipping when `DATABASE_URL` is unset.
///
/// This used to return `Option<String>`, and each test returned early on
/// `None` after printing a note to stderr -- which still reports `... ok`. That
/// is a vacuous pass: a run with no database was indistinguishable from a run
/// that actually proved the invariant, which is the exact failure mode this
/// file exists to rule out. These tests are `#[ignore]`d, so you only get here
/// by asking for them by name with `--ignored`; failing loudly when the
/// database is absent is the honest answer to that request.
fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck".into())
}

fn allowlist(allowed: &[&str], approval: &[&str], denied: &[&str]) -> ToolAllowlist {
    ToolAllowlist {
        allowed_tools: allowed.iter().map(|s| s.to_string()).collect(),
        approval_required: approval.iter().map(|s| s.to_string()).collect(),
        denied_tools: denied.iter().map(|s| s.to_string()).collect(),
    }
}

/// Write one decision exactly the way `gateway::check_tool_policy` does:
/// record the document under its hash, then write an audit record carrying the
/// snapshot. Returns the `occurred_at` the chain actually stamped.
async fn record_decision(
    audit: &AuditRepo,
    policies: &PoliciesRepo,
    agent_version_id: &str,
    document: &PolicyDocument,
    usage: &BudgetUsage,
    audit_action: &str,
) -> chrono::DateTime<Utc> {
    let (snapshot, policy_hash) = PermissionSnapshot::new(
        DecisionIdentity {
            tenant_id: "tnt_recon_test".to_string(),
            project_id: "prj_recon_test".to_string(),
            agent_id: Some("agt_recon_test".to_string()),
            agent_version_id: agent_version_id.to_string(),
            run_id: format!("run_{agent_version_id}"),
            api_key_id: Some("key_recon_test".to_string()),
        },
        document,
        usage,
    );

    policies
        .record_policy_document(&policy_hash, &serde_json::to_value(document).unwrap())
        .await
        .expect("record policy document");

    // tenant_id / project_id / run_id are left NULL on the columns: they are
    // foreign keys, and seeding a tenant + project + run would make this test
    // depend on rows the reconstruction is not allowed to read anyway. The
    // identity that matters lives inside `details.permissions.identity`, which
    // is exactly where the reconstruction looks.
    let event = AuditEventBuilder::new(audit_action, resource::RUN)
        .actor(actor::SYSTEM, None)
        .details(serde_json::json!({
            "tool_name": "git_write",
            "permissions": snapshot,
        }))
        .build();

    audit
        .create(event)
        .await
        .expect("write audit event")
        .occurred_at
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn permissions_are_reconstructable_from_the_log_alone_across_a_policy_change() {
    let url = database_url();
    let pool = fd_storage::pool::create_pool(&url, 4, 1)
        .await
        .expect("connect to the dev database (make dev-up)");
    let audit = AuditRepo::new(pool.clone());
    let policies = PoliciesRepo::new(pool.clone());

    // Unique per run so repeated invocations against a persistent dev database
    // do not read each other's rows.
    let agent_version_id = format!("agv_recon_{}", Utc::now().timestamp_nanos_opt().unwrap());

    // --- Monday: the agent may write. -------------------------------------
    let monday_doc = PolicyDocument::new(
        &allowlist(
            &["git_read", "git_write"],
            &["github_create_pr"],
            &["shell_exec"],
        ),
        &Budget {
            max_cost_cents: Some(500),
            max_tool_calls: Some(50),
            ..Budget::default()
        },
        "enforce",
    );
    let t_monday = record_decision(
        &audit,
        &policies,
        &agent_version_id,
        &monday_doc,
        &BudgetUsage {
            cost_cents: 120,
            tool_calls: 3,
            ..BudgetUsage::default()
        },
        action::POLICY_ALLOWED,
    )
    .await;

    // --- Tuesday: git_write is revoked, and the budget is tightened. -------
    let tuesday_doc = PolicyDocument::new(
        &allowlist(
            &["git_read"],
            &["github_create_pr"],
            &["shell_exec", "git_write"],
        ),
        &Budget {
            max_cost_cents: Some(200),
            max_tool_calls: Some(10),
            ..Budget::default()
        },
        "enforce",
    );
    let t_tuesday = record_decision(
        &audit,
        &policies,
        &agent_version_id,
        &tuesday_doc,
        &BudgetUsage {
            cost_cents: 190,
            tool_calls: 9,
            ..BudgetUsage::default()
        },
        action::POLICY_DENIED,
    )
    .await;

    assert!(
        t_monday < t_tuesday,
        "the two decisions must be distinguishable in time: {t_monday} vs {t_tuesday}"
    );

    // === THE INVARIANT ====================================================
    // From here on, only `audit_events` and `policy_documents` are consulted.
    // `reconstruct_permissions_at` reads nothing else — see its SQL.

    // --- At Monday's decision: git_write was permitted. --------------------
    let monday = policies
        .reconstruct_permissions_at(&agent_version_id, t_monday)
        .await
        .expect("query")
        .expect("a decision exists at t_monday");

    let monday_rebuilt: PolicyDocument = serde_json::from_value(monday.document.clone())
        .expect("stored document is a PolicyDocument");

    assert_eq!(
        monday_rebuilt, monday_doc,
        "the document recovered from the map must be the one that produced the decision"
    );
    assert_eq!(monday.policy_hash, monday_doc.content_hash());
    assert_eq!(
        monday_rebuilt.permits("git_write"),
        ToolPermission::Allowed,
        "on Monday the agent could write"
    );
    assert_eq!(
        monday_rebuilt.permits("github_create_pr"),
        ToolPermission::RequiresApproval
    );
    assert_eq!(monday_rebuilt.permits("shell_exec"), ToolPermission::Denied);
    assert_eq!(
        monday_rebuilt.permits("a_tool_nobody_registered"),
        ToolPermission::Denied,
        "deny-by-default must survive the round trip"
    );

    // The identity is answerable without joining the registry.
    assert_eq!(
        monday.identity["agent_version_id"],
        agent_version_id.as_str()
    );
    assert_eq!(monday.identity["agent_id"], "agt_recon_test");
    assert_eq!(monday.identity["tenant_id"], "tnt_recon_test");
    assert_eq!(monday.identity["api_key_id"], "key_recon_test");

    // Budget is a quantity, not a boolean: 500 cap, 120 spent, 380 left.
    assert_eq!(monday.budget_remaining["cost_cents_limit"], 500);
    assert_eq!(monday.budget_remaining["cost_cents_used"], 120);
    assert_eq!(monday.budget_remaining["cost_cents_remaining"], 380);
    assert_eq!(monday.budget_remaining["tool_calls_remaining"], 47);

    // --- At Tuesday's decision: git_write was NOT permitted. ---------------
    let tuesday = policies
        .reconstruct_permissions_at(&agent_version_id, t_tuesday)
        .await
        .expect("query")
        .expect("a decision exists at t_tuesday");

    let tuesday_rebuilt: PolicyDocument =
        serde_json::from_value(tuesday.document.clone()).expect("stored document");

    assert_eq!(
        tuesday_rebuilt.permits("git_write"),
        ToolPermission::Denied,
        "by Tuesday the write permission had been revoked — the reconstruction \
         must reflect the policy in force THEN, not the newest one"
    );
    assert_ne!(
        tuesday.policy_hash, monday.policy_hash,
        "a policy change must be visible as a different document hash"
    );
    assert_eq!(tuesday.budget_remaining["cost_cents_remaining"], 10);

    // --- Asking about the moment BETWEEN them yields Monday's policy. ------
    // This is the property that makes the log an answer rather than a feed:
    // the state at an arbitrary instant is the last decision at or before it.
    let between = t_monday + chrono::Duration::microseconds(1);
    if between < t_tuesday {
        let mid = policies
            .reconstruct_permissions_at(&agent_version_id, between)
            .await
            .expect("query")
            .expect("Monday's decision is still the most recent one");
        assert_eq!(
            mid.policy_hash, monday.policy_hash,
            "between the two decisions, Monday's policy was still in force"
        );
    }

    // --- Before any decision: honestly nothing, not a stale guess. ---------
    let before = policies
        .reconstruct_permissions_at(&agent_version_id, t_monday - chrono::Duration::seconds(1))
        .await
        .expect("query");
    assert!(
        before.is_none(),
        "with no decision on record yet the answer is 'nothing was decided', \
         never today's policy backdated"
    );

    // --- Each answer cites the record it came from. ------------------------
    assert!(monday.audit_event_id.starts_with("aud_"));
    assert_ne!(monday.audit_event_id, tuesday.audit_event_id);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_recorded_policy_document_cannot_be_rewritten_under_its_hash() {
    let url = database_url();
    let pool = fd_storage::pool::create_pool(&url, 2, 1)
        .await
        .expect("connect to the dev database (make dev-up)");
    let policies = PoliciesRepo::new(pool.clone());

    let doc = PolicyDocument::new(
        &allowlist(&["git_read"], &[], &[]),
        &Budget::default(),
        "enforce",
    );
    let hash = doc.content_hash();
    let json = serde_json::to_value(&doc).unwrap();
    policies
        .record_policy_document(&hash, &json)
        .await
        .expect("first write");

    // Re-observing the same configuration is a no-op, not an error and not an
    // update — the decision path calls this on every single tool call.
    policies
        .record_policy_document(&hash, &json)
        .await
        .expect("re-observation is idempotent");

    // The whole scheme rests on the key being the hash of the value. If the
    // value behind a hash could be edited, every historical decision citing it
    // would silently become a lie while still verifying.
    let tampered = serde_json::to_value(PolicyDocument::new(
        &allowlist(&["git_read", "shell_exec"], &[], &[]),
        &Budget::default(),
        "enforce",
    ))
    .unwrap();
    let err = sqlx::query("UPDATE policy_documents SET document = $1 WHERE content_hash = $2")
        .bind(&tampered)
        .bind(&hash)
        .execute(&pool)
        .await
        .expect_err("UPDATE on a content-addressed row must be rejected");
    assert!(
        err.to_string().contains("immutable"),
        "expected the immutability trigger to fire, got: {err}"
    );

    // And it must still resolve to the original.
    let stored = policies
        .get_policy_document(&hash)
        .await
        .expect("query")
        .expect("still present");
    let back: PolicyDocument = serde_json::from_value(stored).unwrap();
    assert_eq!(back, doc);
    assert_eq!(back.permits("shell_exec"), ToolPermission::Denied);
}
