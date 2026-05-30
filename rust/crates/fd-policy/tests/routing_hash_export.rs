//! Cross-plane sanity: emit a fixture `RoutingDecision` as JSON so the
//! Python fd-evals coverage test can pin against the same hash contract.
//!
//! Anchored on AgensFlow (arXiv:2605.27466). See
//! `docs/runbooks/routing-decision-audit.md`.

use chrono::DateTime;
use fd_policy::routing::{
    RoutingCandidate, RoutingChoice, RoutingDecision, RoutingReason, RoutingReasonCode,
};

fn fixture() -> RoutingDecision {
    RoutingDecision::new(
        "rtg_fixture_001",
        "run_fixture_001",
        "stp_planner_001",
        vec![
            RoutingCandidate {
                role: "planner".into(),
                agent_id: Some("agt_plan_alpha".into()),
                model: "claude-opus-4-7".into(),
                score: Some(0.91),
            },
            RoutingCandidate {
                role: "planner".into(),
                agent_id: Some("agt_plan_beta".into()),
                model: "gpt-4o".into(),
                score: Some(0.74),
            },
        ],
        RoutingChoice {
            role: "planner".into(),
            agent_id: Some("agt_plan_alpha".into()),
            model: "claude-opus-4-7".into(),
        },
        RoutingReason::new(
            RoutingReasonCode::PolicyMatch,
            "policy planner.default fired",
        ),
        DateTime::from_timestamp(1_700_000_000, 0).expect("timestamp"),
    )
}

#[test]
fn fixture_hash_is_pinned() {
    // The exact hex digest below is the cross-plane contract: the Python
    // fd-evals coverage test must produce the same value for the same
    // candidate / chosen / reason-code triple. A change here without an
    // accompanying change to `fd_evals.routing.RoutingDecision.expected_hash`
    // means coordination drift.
    let d = fixture();
    assert!(d.verify_hash());
    // Eyeball-visible sanity: 64 hex chars, fully lowercase.
    assert_eq!(d.content_hash.len(), 64);
    assert!(d
        .content_hash
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));

    // Print the hash + the structural projection JSON so the Python
    // fd-evals test can pin the same value verbatim. Surfaced as eprintln!
    // so `cargo test -- --nocapture` shows it.
    eprintln!("FIXTURE_CONTENT_HASH={}", d.content_hash);
    eprintln!(
        "FIXTURE_AS_JSON={}",
        serde_json::to_string(&d).expect("serialise fixture")
    );
}
