//! Policy-decision regression gate.
//!
//! Walks `tests/fixtures/policy_regression/*.json` and asserts that the
//! `PolicyEngine` configured below produces the expected decision for
//! each fixture. Behavioral regressions in the policy engine fail this
//! test with a per-fixture message.
//!
//! Anchored on the Code-as-Harness survey (arxiv:2605.18747) open
//! challenge of regression-free harness improvement: when you refactor
//! the engine, this gate either passes (refactor was behavior-preserving)
//! or fails with the specific fixture and got/want strings, so
//! triage is mechanical.
//!
//! Add fixtures by dropping a JSON file in the fixtures directory; see
//! `tests/fixtures/policy_regression/README.md` for the schema.

use std::fs;
use std::path::Path;

use fd_policy::budget::Budget;
use fd_policy::rules::ToolAllowlist;
use fd_policy::{PolicyDecisionKind, PolicyEngine};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Fixture {
    name: String,
    tool_name: String,
    expected_decision: ExpectedDecision,
    #[serde(default)]
    expected_reason_contains: Option<String>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum ExpectedDecision {
    Allow,
    Deny,
    RequiresApproval,
}

impl ExpectedDecision {
    fn matches(&self, kind: PolicyDecisionKind) -> bool {
        match self {
            ExpectedDecision::Allow => matches!(
                kind,
                PolicyDecisionKind::Allow | PolicyDecisionKind::AllowWithWarning
            ),
            ExpectedDecision::Deny => matches!(kind, PolicyDecisionKind::Deny),
            ExpectedDecision::RequiresApproval => {
                matches!(kind, PolicyDecisionKind::RequiresApproval)
            }
        }
    }
}

/// Canonical engine configuration used by the fixtures. Extend this when
/// you add fixtures that reference new tool names.
fn canonical_engine() -> PolicyEngine {
    let allowlist = ToolAllowlist {
        allowed_tools: vec![
            "read_file".to_string(),
            "list_directory".to_string(),
            "get_time".to_string(),
        ],
        approval_required: vec!["write_file".to_string(), "delete_file".to_string()],
        denied_tools: vec!["exec_shell".to_string()],
    };
    PolicyEngine::new(allowlist, Budget::default())
}

#[test]
fn policy_regression_fixtures() {
    // CARGO_MANIFEST_DIR is the crate root, so the path is straightforward.
    let dir = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join("policy_regression");

    let entries: Vec<_> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("failed to read fixtures dir {}: {}", dir.display(), e))
        .filter_map(Result::ok)
        .filter(|e| {
            e.path()
                .extension()
                .map(|ext| ext == "json")
                .unwrap_or(false)
        })
        .collect();

    assert!(
        !entries.is_empty(),
        "no JSON fixtures found in {}",
        dir.display()
    );

    let engine = canonical_engine();
    let mut failures: Vec<String> = Vec::new();

    for entry in entries {
        let path = entry.path();
        let bytes = fs::read(&path).unwrap_or_else(|e| panic!("read {}: {}", path.display(), e));
        let fx: Fixture = serde_json::from_slice(&bytes).unwrap_or_else(|e| {
            panic!("parse {}: {}", path.display(), e);
        });

        let decision = engine.evaluate_tool_call(&fx.tool_name);

        if !fx.expected_decision.matches(decision.kind) {
            failures.push(format!(
                "  fixture `{}` ({}): expected {:?}, got {:?} (reason: {:?})",
                fx.name,
                path.file_name().unwrap().to_string_lossy(),
                fx.expected_decision,
                decision.kind,
                decision.reason,
            ));
            continue;
        }

        if let Some(needle) = fx.expected_reason_contains.as_ref() {
            if !decision.reason.contains(needle) {
                failures.push(format!(
                    "  fixture `{}` ({}): reason {:?} did not contain {:?}",
                    fx.name,
                    path.file_name().unwrap().to_string_lossy(),
                    decision.reason,
                    needle,
                ));
            }
        }
    }

    if !failures.is_empty() {
        panic!(
            "{} policy-regression fixture(s) failed:\n{}",
            failures.len(),
            failures.join("\n"),
        );
    }
}
