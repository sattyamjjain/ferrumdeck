//! End-to-end: an extracted W3C trace-id (MCP SEP-414) lands on the persisted
//! enforcement decision record.
//!
//! This mirrors how `gateway::check_tool_policy` builds the decision audit
//! record: extract the trace context from the request `_meta`, then thread the
//! trace-id + parent span-id onto the `audit_events` row via
//! [`AuditEventBuilder::trace`] and record the full linkage in `details`. The
//! `CreateAuditEvent` built here is exactly what `AuditRepo::create` inserts, so
//! asserting on it proves the field reaches the persisted record — no DB needed
//! and no parallel store.

use fd_storage::models::{action, resource, AuditEventBuilder};

const SEP414_TP: &str = "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01";

#[test]
fn extracted_trace_id_lands_on_the_persisted_decision_record() {
    let meta = serde_json::json!({ "traceparent": SEP414_TP });
    let tc = fd_otel::extract_trace_context(&meta).expect("valid traceparent");

    // Build the decision audit record the way the gateway handler does.
    let mut details = serde_json::json!({
        "tool_name": "shell_exec",
        "decision": "Deny",
    });
    details.as_object_mut().unwrap().insert(
        "trace_context".to_string(),
        serde_json::json!({
            "trace_id": tc.trace_id,
            "parent_span_id": tc.parent_id,
            "sampled": tc.sampled,
        }),
    );
    let event = AuditEventBuilder::new(action::POLICY_DENIED, resource::RUN)
        .run("run_fixture_001")
        .trace(tc.trace_id.clone(), tc.parent_id.clone())
        .details(details)
        .build();

    // The dedicated columns carry the linkage (first-class join key).
    assert_eq!(
        event.trace_id.as_deref(),
        Some("0af7651916cd43dd8448eb211c80319c")
    );
    assert_eq!(event.span_id.as_deref(), Some("00f067aa0ba902b7"));
    // And the details carry the full context for a reader.
    assert_eq!(
        event.details["trace_context"]["trace_id"],
        "0af7651916cd43dd8448eb211c80319c"
    );
    assert_eq!(event.details["trace_context"]["sampled"], true);
}

#[test]
fn no_meta_leaves_the_decision_record_trace_free() {
    // Regression guard: a decision with no propagated trace context persists
    // exactly as before — no trace_id/span_id, no trace_context in details.
    let event = AuditEventBuilder::new(action::POLICY_ALLOWED, resource::RUN)
        .run("run_fixture_002")
        .details(serde_json::json!({ "tool_name": "read_file", "decision": "Allow" }))
        .build();

    assert!(event.trace_id.is_none());
    assert!(event.span_id.is_none());
    assert!(event.details.get("trace_context").is_none());
}
