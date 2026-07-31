//! #13: a tool version registered AFTER the guard is constructed must be
//! schema-drift-checked without a rebuild or a gateway restart.
//!
//! The gateway seeds the [`SchemaDriftGuard`] once at boot from the
//! `tool_versions` table (`state.rs`) and shares it via `Arc`. Before this fix
//! the guard was immutable, so a tool registered after boot was silently
//! fail-open — never drift-checked until the next restart, and those are exactly
//! the newest, most-likely-to-drift tools. The registry write path now calls
//! `guard.upsert(id, schema)` (`create_tool` in `handlers/registry.rs`); this
//! test pins that the guard, held only behind a shared `&self`, sees the new
//! version immediately.

use std::sync::Arc;

use fd_policy::airlock::config::SchemaDriftConfig;
use fd_policy::airlock::SchemaDriftGuard;
use fd_policy::ViolationType;
use serde_json::json;

fn strict_schema() -> serde_json::Value {
    json!({
        "type": "object",
        "required": ["path"],
        "additionalProperties": false,
        "properties": { "path": { "type": "string" } }
    })
}

/// The exact case #13 fixes: a shared guard (as the gateway holds it, behind an
/// `Arc`) gains a new tool version live and immediately enforces its schema.
#[test]
fn shared_guard_enforces_a_version_registered_after_boot() {
    // Boot state: the guard is populated from whatever existed at startup —
    // model that as empty, then a new tool is registered while the gateway runs.
    let guard: Arc<SchemaDriftGuard> = Arc::new(SchemaDriftGuard::empty());
    let cfg = SchemaDriftConfig::default();
    let tv_id = fd_core::ToolVersionId::new();

    // A payload for the not-yet-registered version is fail-open (default): the
    // pre-#13 behaviour, preserved for the unknown case.
    assert!(guard
        .check(&tv_id, &json!({ "path": "/etc/passwd", "rm": "-rf" }), &cfg)
        .is_none());
    assert!(!guard.contains(&tv_id));

    // The registry write path calls this — note it is `&self`, so the same Arc
    // the inspector holds sees the update.
    let registered = guard.upsert(tv_id, &strict_schema());
    assert!(registered, "a valid schema must register");
    assert!(guard.contains(&tv_id));

    // A drifted payload (unknown field `rm`) is now caught, no restart.
    let violation = guard
        .check(&tv_id, &json!({ "path": "/etc/passwd", "rm": "-rf" }), &cfg)
        .expect("a version registered after boot must be drift-checked");
    assert_eq!(violation.violation_type, ViolationType::SchemaDrift);

    // A conforming payload for the same version passes.
    assert!(guard
        .check(&tv_id, &json!({ "path": "/tmp/ok" }), &cfg)
        .is_none());
}

/// Fail-closed is opt-in and, when set, blocks a call whose tool version the
/// guard has never seen — the deny-by-default posture for schema coverage.
#[test]
fn fail_closed_is_opt_in_and_blocks_unknown_versions() {
    let guard = SchemaDriftGuard::empty();
    let tv_id = fd_core::ToolVersionId::new();

    let mut cfg = SchemaDriftConfig::default();
    assert!(
        !cfg.fail_closed_on_unregistered,
        "default must remain fail-open"
    );
    assert!(guard
        .check(&tv_id, &json!({ "any": "thing" }), &cfg)
        .is_none());

    cfg.fail_closed_on_unregistered = true;
    let violation = guard
        .check(&tv_id, &json!({ "any": "thing" }), &cfg)
        .expect("fail-closed blocks an unregistered version");
    assert_eq!(violation.violation_type, ViolationType::SchemaDrift);
}
