//! Injection-defense benchmark — the **real RASP** run over the vendored
//! AgentDojo-style corpus.
//!
//! This test is the credibility anchor for the `fd-evals` `injection_defense`
//! suite: it feeds every case in
//! `evals/datasets/injection_defense/tasks.jsonl` through the **actual**
//! `fd_policy` defense path — the deny-by-default [`ToolAllowlist`] plus the
//! `AirlockInspector` (anti-RCE matcher + data-exfiltration shield) in
//! **enforce** mode — using the vendored governance profile in
//! `governance.json`, and asserts that the real defense decision matches each
//! case's `expected_executed` label. If the RASP ever changes so a case is no
//! longer blocked/allowed as recorded, this test fails and the corpus (and the
//! reproduced block-rate in the README / reports) must be re-blessed.
//!
//! Deterministic, offline, no LLM: it exercises the policy/RASP layer, not
//! model quality. The `fd_evals.injection_defense` module recomputes the same
//! aggregate on the Python plane; both are pinned to this corpus.

use fd_core::RunId;
use fd_policy::airlock::config::{
    BehavioralDriftConfig, ExfiltrationConfig, RceConfig, SchemaDriftConfig, VelocityConfig,
};
use fd_policy::{
    AirlockConfig, AirlockInspector, AirlockMode, InspectionContext, ToolAllowlist,
    ToolAllowlistResult,
};
use serde_json::Value;
use std::path::PathBuf;

fn dataset_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../evals/datasets/injection_defense")
}

fn load_governance() -> Value {
    let path = dataset_dir().join("governance.json");
    let raw = std::fs::read_to_string(&path).expect("read governance.json");
    serde_json::from_str(&raw).expect("parse governance.json")
}

fn load_cases() -> Vec<Value> {
    let path = dataset_dir().join("tasks.jsonl");
    let raw = std::fs::read_to_string(&path).expect("read tasks.jsonl");
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse task line"))
        .collect()
}

fn str_vec(v: &Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

fn build_allowlist(gov: &Value) -> ToolAllowlist {
    let a = &gov["allowlist"];
    ToolAllowlist {
        allowed_tools: str_vec(a, "allowed_tools"),
        approval_required: str_vec(a, "approval_required"),
        denied_tools: str_vec(a, "denied_tools"),
    }
}

fn build_airlock(gov: &Value) -> AirlockInspector {
    let a = &gov["airlock"];
    let config = AirlockConfig {
        mode: match a["mode"].as_str() {
            Some("enforce") => AirlockMode::Enforce,
            _ => AirlockMode::Shadow,
        },
        rce: RceConfig {
            enabled: true,
            target_tools: str_vec(a, "rce_target_tools"),
            custom_patterns: Vec::new(),
        },
        exfiltration: ExfiltrationConfig {
            enabled: true,
            target_tools: str_vec(a, "exfil_target_tools"),
            allowed_domains: str_vec(a, "exfil_allowed_domains"),
            block_ip_addresses: a["block_ip_addresses"].as_bool().unwrap_or(true),
            credential_dlp_enabled: a["credential_dlp_enabled"].as_bool().unwrap_or(true),
            data_budget_per_domain_bytes: None,
        },
        // Disabled: stateful / out-of-scope for a per-call indirect-injection
        // measurement (documented in governance.json).
        velocity: VelocityConfig {
            enabled: false,
            ..VelocityConfig::default()
        },
        schema_drift: SchemaDriftConfig {
            enabled: false,
            ..SchemaDriftConfig::default()
        },
        behavioral_drift: BehavioralDriftConfig {
            enabled: false,
            ..BehavioralDriftConfig::default()
        },
    };
    AirlockInspector::new(config)
}

/// The real defense decision for a single case: deny-by-default allowlist first
/// (an off-allowlist or denied tool never reaches the tool), then the Airlock
/// inspector in enforce mode (a violation → `allowed = false`). `executed` is
/// true only when the call is both allowlisted *and* passes every Airlock
/// layer — i.e. the malicious call actually ran.
async fn is_executed(
    allowlist: &ToolAllowlist,
    airlock: &AirlockInspector,
    tool_name: &str,
    tool_input: &Value,
) -> bool {
    if allowlist.check(tool_name) != ToolAllowlistResult::Allowed {
        return false; // deny-by-default or approval gate — not auto-executed
    }
    let ctx = InspectionContext {
        run_id: RunId::new(),
        tool_name: tool_name.to_string(),
        tool_input: tool_input.clone(),
        estimated_cost_cents: None,
        tool_version_id: None,
        agent_id: None,
    };
    airlock.inspect(&ctx).await.allowed
}

fn wilson_lower_95(k: u64, n: u64) -> f64 {
    if n == 0 {
        return 0.0;
    }
    let z = 1.96_f64;
    let n = n as f64;
    let phat = k as f64 / n;
    let denom = 1.0 + z * z / n;
    let center = phat + z * z / (2.0 * n);
    let margin = z * ((phat * (1.0 - phat) + z * z / (4.0 * n)) / n).sqrt();
    ((center - margin) / denom).clamp(0.0, 1.0)
}

#[tokio::test]
async fn real_rasp_matches_corpus_and_reports_block_rate() {
    let gov = load_governance();
    let allowlist = build_allowlist(&gov);
    let airlock = build_airlock(&gov);
    let cases = load_cases();
    assert!(!cases.is_empty(), "corpus must not be empty");

    let (mut attacks, mut attacks_blocked) = (0u64, 0u64);
    let (mut benign, mut benign_executed) = (0u64, 0u64);
    let mut mismatches = Vec::new();

    for case in &cases {
        let id = case["id"].as_str().unwrap_or("?");
        let category = case["category"].as_str().unwrap_or("");
        let tool_name = case["tool_name"].as_str().unwrap_or("");
        let expected_executed = case["expected_executed"].as_bool().unwrap_or(false);
        let executed = is_executed(&allowlist, &airlock, tool_name, &case["tool_input"]).await;

        if executed != expected_executed {
            mismatches.push(format!(
                "  {id} [{category}] tool={tool_name}: expected_executed={expected_executed}, real={executed}"
            ));
        }

        match category {
            "attack" => {
                attacks += 1;
                if !executed {
                    attacks_blocked += 1;
                }
            }
            "benign" => {
                benign += 1;
                if executed {
                    benign_executed += 1;
                }
            }
            other => panic!("unknown category {other:?} in case {id}"),
        }
    }

    // The real RASP must decide every case exactly as the corpus records — this
    // is what pins the reproduced number to the actual defense.
    assert!(
        mismatches.is_empty(),
        "real RASP disagrees with the corpus (re-bless tasks.jsonl if the defense changed):\n{}",
        mismatches.join("\n")
    );

    let block_rate = attacks_blocked as f64 / attacks as f64;
    let benign_utility = benign_executed as f64 / benign as f64;
    println!(
        "injection-defense (real fd-policy RASP): block_rate={:.4} ({}/{}, 95% CI lower {:.4}); \
         benign_utility={:.4} ({}/{}, 95% CI lower {:.4})",
        block_rate,
        attacks_blocked,
        attacks,
        wilson_lower_95(attacks_blocked, attacks),
        benign_utility,
        benign_executed,
        benign,
        wilson_lower_95(benign_executed, benign),
    );

    // Sanity floors — the vendored corpus is designed so the real defense
    // blocks every attack and preserves every benign call.
    assert_eq!(
        attacks_blocked, attacks,
        "every attack case must be blocked"
    );
    assert_eq!(
        benign_executed, benign,
        "every benign case must be preserved"
    );
}
