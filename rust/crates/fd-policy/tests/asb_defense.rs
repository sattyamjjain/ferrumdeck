//! Agent Security Bench (ASB) benchmark — the **real enforcement plane** run
//! over the vendored ASB-style corpus, plus the **real EU AI Act Article 50**
//! transparency rule run over the Art. 50 response cases.
//!
//! This test is the credibility anchor for the `fd-evals` `asb` suite. It feeds
//! every case in `evals/datasets/asb/tasks.jsonl` through the **actual**
//! `fd_policy` decision — the deny-by-default [`ToolAllowlist`], the
//! `AirlockInspector` (anti-RCE + data-exfiltration) in **enforce** mode, and
//! the R1–R3 [`graduated_response`] reversibility ladder — using the vendored
//! `governance.json`, and asserts the real decision matches each case's
//! `expected_executed` label. It additionally verifies that every
//! `reversibility_r3` case is stopped **by the R3 rung specifically** (the
//! allowlist and Airlock both *allow* it — the graduated ladder is the decisive
//! layer), which is the attack class AgentDojo / the injection-defense suite do
//! not cover.
//!
//! A second test runs the real `transparency_art50` rule over
//! `art50_cases.jsonl` and asserts each response's compliance verdict matches
//! its label and that non-compliant responses are denied in enforce mode.
//!
//! Deterministic, offline, no LLM: it exercises the policy/RASP/transparency
//! layer, not model quality. The `fd_evals.asb` module recomputes the same
//! aggregates on the Python plane; both are pinned to this corpus.

use fd_core::RunId;
use fd_policy::airlock::config::{
    BehavioralDriftConfig, ExfiltrationConfig, RceConfig, SchemaDriftConfig, VelocityConfig,
};
use fd_policy::reversibility::{graduated_response, ResponseLevel, Reversibility};
use fd_policy::transparency_art50::{check as check_art50, enforce as enforce_art50, Art50Config};
use fd_policy::{
    AirlockConfig, AirlockInspector, AirlockMode, InspectionContext, ToolAllowlist,
    ToolAllowlistResult,
};
use serde_json::Value;
use std::path::PathBuf;

fn dataset_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../evals/datasets/asb")
}

fn load_json(name: &str) -> Value {
    let path = dataset_dir().join(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {name}: {e}"));
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("parse {name}: {e}"))
}

fn load_lines(name: &str) -> Vec<Value> {
    let path = dataset_dir().join(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {name}: {e}"));
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse case line"))
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
        // Disabled: stateful / out-of-scope for a per-call measurement.
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

fn tool_reversibility(gov: &Value, tool_name: &str) -> Reversibility {
    // Deny-by-default: an unclassified tool is Irreversible (the most
    // restrictive rung) — matches `Reversibility::parse`'s unknown fallback.
    Reversibility::parse(
        gov["tool_reversibility"]
            .get(tool_name)
            .and_then(Value::as_str)
            .unwrap_or("irreversible"),
    )
}

fn budget_headroom(gov: &Value) -> bool {
    gov["budget"]["has_headroom"].as_bool().unwrap_or(true)
}

/// The three intermediate signals for one tool-call case, so the test can assert
/// not just the final `executed` bit but *which* layer was decisive.
struct Decision {
    allowlisted: bool,
    airlock_allowed: bool,
    r3_gated: bool,
}

impl Decision {
    fn executed(&self) -> bool {
        self.allowlisted && self.airlock_allowed && !self.r3_gated
    }
}

async fn decide(
    allowlist: &ToolAllowlist,
    airlock: &AirlockInspector,
    gov: &Value,
    tool_name: &str,
    tool_input: &Value,
) -> Decision {
    let allowlisted = allowlist.check(tool_name) == ToolAllowlistResult::Allowed;
    let airlock_allowed = if allowlisted {
        let ctx = InspectionContext {
            run_id: RunId::new(),
            tool_name: tool_name.to_string(),
            tool_input: tool_input.clone(),
            estimated_cost_cents: None,
            tool_version_id: None,
            agent_id: None,
        };
        airlock.inspect(&ctx).await.allowed
    } else {
        false
    };
    let rung = graduated_response(tool_reversibility(gov, tool_name), budget_headroom(gov));
    Decision {
        allowlisted,
        airlock_allowed,
        r3_gated: rung == ResponseLevel::RequireApproval,
    }
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
async fn real_policy_blocks_asb_attacks_and_reports_block_rate() {
    let gov = load_json("governance.json");
    let allowlist = build_allowlist(&gov);
    let airlock = build_airlock(&gov);
    let cases = load_lines("tasks.jsonl");
    assert!(!cases.is_empty(), "corpus must not be empty");

    let (mut attacks, mut attacks_blocked) = (0u64, 0u64);
    let (mut benign, mut benign_executed) = (0u64, 0u64);
    let mut mismatches = Vec::new();
    let mut r3_cases = 0u64;

    for case in &cases {
        let id = case["id"].as_str().unwrap_or("?");
        let category = case["category"].as_str().unwrap_or("");
        let tool_name = case["tool_name"].as_str().unwrap_or("");
        let expected_executed = case["expected_executed"].as_bool().unwrap_or(false);
        let expected_blocked_by = case["expected_blocked_by"].as_str().unwrap_or("");

        let d = decide(&allowlist, &airlock, &gov, tool_name, &case["tool_input"]).await;
        let executed = d.executed();

        if executed != expected_executed {
            mismatches.push(format!(
                "  {id} [{category}] tool={tool_name}: expected_executed={expected_executed}, real={executed}"
            ));
        }

        // The distinguishing assertion: a `reversibility_r3` case must be one the
        // allowlist AND Airlock both permit — the R3 rung is what stops it. This
        // proves the graduated ladder (not deny-by-default) is the decisive layer
        // for the PoT-backdoor class.
        if expected_blocked_by == "reversibility_r3" {
            r3_cases += 1;
            assert!(
                d.allowlisted && d.airlock_allowed && d.r3_gated,
                "{id}: expected the R3 rung to be decisive (allowlisted={}, airlock_allowed={}, r3_gated={})",
                d.allowlisted,
                d.airlock_allowed,
                d.r3_gated
            );
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

    assert!(
        mismatches.is_empty(),
        "real policy disagrees with the corpus (re-bless tasks.jsonl if enforcement changed):\n{}",
        mismatches.join("\n")
    );
    assert!(
        r3_cases > 0,
        "corpus must exercise the R3 reversibility rung (the ASB PoT-backdoor class)"
    );

    let block_rate = attacks_blocked as f64 / attacks as f64;
    let benign_utility = benign_executed as f64 / benign as f64;
    println!(
        "asb (real fd-policy enforcement): block_rate={:.4} ({}/{}, 95% CI lower {:.4}); \
         benign_utility={:.4} ({}/{}, 95% CI lower {:.4}); r3_gated_cases={}",
        block_rate,
        attacks_blocked,
        attacks,
        wilson_lower_95(attacks_blocked, attacks),
        benign_utility,
        benign_executed,
        benign,
        wilson_lower_95(benign_executed, benign),
        r3_cases,
    );

    assert_eq!(
        attacks_blocked, attacks,
        "every attack case must be blocked"
    );
    assert_eq!(
        benign_executed, benign,
        "every benign case must be preserved"
    );
}

#[tokio::test]
async fn real_art50_rule_flags_noncompliant_responses() {
    let gov = load_json("governance.json");
    let cfg = Art50Config::from_json(&gov["art50"]);
    let cases = load_lines("art50_cases.jsonl");
    assert!(!cases.is_empty(), "art50 corpus must not be empty");

    let (mut noncompliant, mut noncompliant_denied) = (0u64, 0u64);
    let (mut compliant, mut compliant_allowed) = (0u64, 0u64);
    let mut mismatches = Vec::new();

    for case in &cases {
        let id = case["id"].as_str().unwrap_or("?");
        let response = case["response"].as_str().unwrap_or("");
        let expected_status = case["expected_status"].as_str().unwrap_or("");
        let expected_compliant = case["expected_compliant"].as_bool().unwrap_or(false);

        let status = check_art50(response, cfg);
        if status.as_str() != expected_status {
            mismatches.push(format!(
                "  {id}: expected_status={expected_status}, real={}",
                status.as_str()
            ));
        }
        assert_eq!(
            status.is_compliant(),
            expected_compliant,
            "{id}: compliance mismatch"
        );

        // Enforce mode: non-compliant is denied (block-before-release); compliant
        // is allowed.
        let decision = enforce_art50(status, AirlockMode::Enforce);
        if expected_compliant {
            compliant += 1;
            if decision.is_allowed() {
                compliant_allowed += 1;
            }
        } else {
            noncompliant += 1;
            if decision.is_denied() {
                noncompliant_denied += 1;
            }
            // Shadow mode must NOT block — the safe-rollout posture.
            assert!(
                enforce_art50(status, AirlockMode::Shadow).is_allowed(),
                "{id}: shadow mode must not block"
            );
        }
    }

    assert!(
        mismatches.is_empty(),
        "art50 rule disagrees with the corpus:\n{}",
        mismatches.join("\n")
    );

    let block_rate = noncompliant_denied as f64 / noncompliant as f64;
    println!(
        "asb art50 (real transparency rule): transparency_block_rate={:.4} ({}/{}, 95% CI lower {:.4}); \
         compliant_preserved={}/{}",
        block_rate,
        noncompliant_denied,
        noncompliant,
        wilson_lower_95(noncompliant_denied, noncompliant),
        compliant_allowed,
        compliant,
    );

    assert_eq!(
        noncompliant_denied, noncompliant,
        "every non-compliant response must be denied in enforce mode"
    );
    assert_eq!(
        compliant_allowed, compliant,
        "every compliant response must be allowed"
    );
}
