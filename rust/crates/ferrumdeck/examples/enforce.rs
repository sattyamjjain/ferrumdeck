//! Minimal runnable example of the FerrumDeck enforcement decision path.
//!
//! In CI this is built with `cargo auditable build --release`, so the resulting
//! binary embeds its full dependency SBOM — an audit-reviewable provenance
//! artifact (inspect it with `cargo audit bin target/release/examples/enforce`).
//! Run locally with: `cargo run -p ferrumdeck --example enforce`.

use ferrumdeck::{PolicyEngine, ToolAllowlist};

fn main() {
    let engine = PolicyEngine::default();
    let allowlist = ToolAllowlist {
        allowed_tools: vec!["read_file".into(), "run_tests".into()],
        approval_required: vec!["deploy".into()],
        denied_tools: vec!["delete_repo".into()],
    };

    for tool in ["read_file", "deploy", "delete_repo", "unknown"] {
        let decision = engine.evaluate_tool_call_with(&allowlist, tool);
        let verdict = if decision.is_allowed() {
            "ALLOW"
        } else if decision.needs_approval() {
            "APPROVAL"
        } else {
            "DENY"
        };
        println!("{tool:>12} -> {verdict}");
    }
}
