//! Schema-drift regression for the [`AuditEvent`] receipts substrate.
//!
//! The audit-record shape is the wire contract documented in
//! [`docs/receipts-schema.md`](../../../../docs/receipts-schema.md), and that
//! contract has downstream consumers (Foundation Protocol, mnemo, anything
//! else listening to the audit feed). Any change to the struct's serde
//! projection must be intentional — this test serializes a deterministic
//! fixture instance and diffs it against
//! [`fixtures/audit_record_schema.golden.json`](fixtures/audit_record_schema.golden.json).
//!
//! When the schema *must* legitimately change:
//! 1. Update `docs/receipts-schema.md` first so the contract is renegotiated.
//! 2. Re-bless this golden by running `BLESS=1 cargo test -p fd-audit
//!    --test audit_record_schema_drift`.
//! 3. Include both diffs in the same commit so reviewers see the schema
//!    change *and* its receipts implication together.

use std::fs;
use std::path::PathBuf;

use chrono::DateTime;
use fd_audit::event::{AuditActor, AuditOutcome, AuditResource};
use fd_audit::{AuditEvent, AuditEventKind};
use fd_core::{AuditEventId, RunId, TenantId};
use ulid::Ulid;

const GOLDEN_PATH: &str = "tests/fixtures/audit_record_schema.golden.json";

/// Build the canonical fixture event. Every field is deterministic so the
/// JSON projection is byte-stable across runs and across machines.
fn fixture_event() -> AuditEvent {
    let id = AuditEventId::from_ulid(
        Ulid::from_string("01H8XGJWBWBAQ4N5G7E1Y3J7AA").expect("valid audit ulid"),
    );
    let tenant_id = TenantId::from_ulid(
        Ulid::from_string("01H8XGJWBWBAQ4N5G7E1Y3J7BB").expect("valid tenant ulid"),
    );
    let run_id =
        RunId::from_ulid(Ulid::from_string("01H8XGJWBWBAQ4N5G7E1Y3J7CC").expect("valid run ulid"));

    AuditEvent {
        id,
        timestamp: DateTime::from_timestamp(1_700_000_000, 0).expect("valid timestamp"),
        tenant_id,
        kind: AuditEventKind::PolicyDecision {
            run_id,
            action: "tool.execute".to_string(),
            allowed: false,
        },
        actor: AuditActor::ApiKey {
            key_id: "key_fixture_001".to_string(),
        },
        resource: AuditResource {
            resource_type: "run".to_string(),
            resource_id: "run_fixture_001".to_string(),
        },
        action: "policy.denied".to_string(),
        outcome: AuditOutcome::Failure,
        metadata: serde_json::json!({
            "policy_decision_id": "pol_fixture_001",
            "reason": "tool 'shell_exec' is not in allowlist",
            "tool": "shell_exec",
            "trace": {
                "precedence": "deny > requires_approval > budget_cap > allow",
                "winning_source": "allowlist:denied"
            }
        }),
    }
}

fn golden_path() -> PathBuf {
    // `CARGO_MANIFEST_DIR` is always set by cargo when running tests; the
    // single-arg form keeps rust-analyzer happy across versions.
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(GOLDEN_PATH)
}

/// Canonical serialisation: pretty-printed JSON with a trailing newline. We
/// use `to_string_pretty` because the golden is read by humans during PR
/// review — the whole point of the file is to make schema diffs visible.
fn render(event: &AuditEvent) -> String {
    let mut s = serde_json::to_string_pretty(event)
        .expect("AuditEvent must always serialise — schema invariant");
    s.push('\n');
    s
}

#[test]
fn audit_record_schema_does_not_drift() {
    let actual = render(&fixture_event());
    let path = golden_path();

    // BLESS=1 rewrites the golden in place. Use this when the schema change
    // is intentional and `docs/receipts-schema.md` has already been updated.
    if std::env::var("BLESS").as_deref() == Ok("1") {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create fixtures dir");
        }
        fs::write(&path, &actual).expect("write golden");
        eprintln!("BLESS=1 — golden rewritten at {}", path.display());
        return;
    }

    let expected = fs::read_to_string(&path).unwrap_or_else(|err| {
        panic!(
            "golden file {} not found ({err}); generate it once with \
             `BLESS=1 cargo test -p fd-audit --test audit_record_schema_drift`",
            path.display()
        )
    });

    assert_eq!(
        actual,
        expected,
        "\n\nAuditEvent JSON projection drifted from the receipts contract.\n\
         If this is intentional:\n  \
         1. Update docs/receipts-schema.md to describe the new shape.\n  \
         2. Re-bless with: BLESS=1 cargo test -p fd-audit --test audit_record_schema_drift\n  \
         3. Commit both the schema doc and the golden together.\n\n\
         Golden: {}\n",
        path.display(),
    );
}

/// Sanity check: the fixture itself must round-trip through serde so the
/// regression isn't gated on a struct that we can't deserialise.
#[test]
fn fixture_round_trips_through_serde() {
    let event = fixture_event();
    let json = serde_json::to_string(&event).expect("serialise");
    let parsed: AuditEvent = serde_json::from_str(&json).expect("deserialise");

    assert_eq!(parsed.id, event.id);
    assert_eq!(parsed.tenant_id, event.tenant_id);
    assert_eq!(parsed.action, event.action);
    assert_eq!(parsed.outcome, event.outcome);
    // Spot-check that the metadata envelope survives intact — this is where
    // FP consumers project policy / metering primitives out of.
    assert_eq!(parsed.metadata["tool"], "shell_exec");
    assert_eq!(
        parsed.metadata["trace"]["winning_source"],
        "allowlist:denied"
    );
}
