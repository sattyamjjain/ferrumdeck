//! What the name-matched Airlock layers actually inspect on this deployment.
//!
//! Two of the five layers filter by tool NAME before doing any work: Layer 1
//! (anti-RCE patterns) and Layer 3 (exfiltration + credential DLP). Each tests
//! the tool name against its own `target_tools` list, and a tool not on that
//! list is never inspected.
//!
//! Until 0.8.12 both lists defaulted to literal guesses about what tools are
//! called — Layer 1 to eight shell-shaped names (`bash`, `python_repl`,
//! `write_file`, …), Layer 3 to eight HTTP-shaped ones (`http_get`, `curl`,
//! `send_email`, …). Neither matched anything in a deployment that names its
//! tools after its own domain, including this one. The dev seed registers
//! `git_read`, `git_write`, `test_run` and `github_create_pr`, so **both layers
//! inspected zero of four** while reporting enabled and passing their tests.
//! Measured, same payload both ways:
//!
//! ```text
//! git_write         risk_score=0    violation=None        <- registered, not inspected
//! bash              risk_score=90   violation=rcepattern  <- inspected, not registered
//! ```
//!
//! Both defaults are now **empty, meaning inspect everything**. Fail-closed is
//! the right default for a security layer, and the previous behaviour decided
//! on the operator's behalf that their tools were uninteresting.
//!
//! This module survives the fix because narrowing is still allowed: an operator
//! who sets `target_tools` to control cost or a specific false positive should
//! be able to see what that leaves uncovered. It reconciles each layer's list
//! against the registry at boot and reports `full` / `partial` / `blind` /
//! `disabled` / `no_tools_registered` — as a WARN when blind, and as a field on
//! `GET /ready` so it is visible without reading logs.

use serde::{Deserialize, Serialize};

use super::config::{ExfiltrationConfig, RceConfig};

/// What one name-matched layer covers on this deployment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LayerCoverage {
    /// `anti_rce` or `exfiltration`, so a reader knows which layer is blind.
    pub layer: String,
    /// Whether Layer 1 is switched on at all.
    pub enabled: bool,
    /// The configured `target_tools` list, verbatim. **Empty means every
    /// tool is inspected**, which is the default.
    pub target_tools: Vec<String>,
    /// How many tools the registry holds.
    pub registered_tools: usize,
    /// Registered tools that Layer 1 WILL inspect (the intersection).
    pub inspected: Vec<String>,
    /// Registered tools that Layer 1 will NOT inspect. The interesting list.
    pub uninspected: Vec<String>,
}

/// Coverage, reduced to the one word an operator needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverageStatus {
    /// Layer 1 is switched off. Nothing is inspected, and that is deliberate.
    Disabled,
    /// No tools are registered yet, so there is nothing to reconcile. Not a
    /// finding — a fresh database looks like this.
    NoToolsRegistered,
    /// Tools are registered and **none** of them is inspected. The failure this
    /// module exists for.
    Blind,
    /// Some registered tools are inspected and some are not.
    Partial,
    /// Every registered tool is inspected.
    Full,
}

impl CoverageStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NoToolsRegistered => "no_tools_registered",
            Self::Blind => "blind",
            Self::Partial => "partial",
            Self::Full => "full",
        }
    }
}

fn normalize(name: &str) -> String {
    name.trim().to_lowercase()
}

impl LayerCoverage {
    /// Reconcile the registry against the configured `target_tools`.
    ///
    /// Matching is case-insensitive and trimmed, mirroring nothing in
    /// `should_inspect` — which compares exactly. That asymmetry is
    /// deliberate and errs toward *under*-reporting coverage: a name that
    /// differs only by case is reported here as inspected while the matcher
    /// would skip it, so `Blind` is never a false alarm, and a near-miss shows
    /// up as `Partial` rather than being silently counted as fine. See
    /// `case_differences_do_not_hide_a_blind_deployment`.
    pub fn reconcile<I, S>(
        layer: &str,
        registered: I,
        enabled: bool,
        target_tools: &[String],
    ) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let targets: Vec<String> = target_tools.iter().map(|t| normalize(t)).collect();
        // Empty list = no filter = everything is inspected.
        let inspect_all = targets.is_empty();

        let mut inspected = Vec::new();
        let mut uninspected = Vec::new();
        let mut count = 0usize;

        for tool in registered {
            let raw = tool.as_ref().to_string();
            if raw.trim().is_empty() {
                continue;
            }
            count += 1;
            if inspect_all || targets.contains(&normalize(&raw)) {
                inspected.push(raw);
            } else {
                uninspected.push(raw);
            }
        }

        inspected.sort();
        inspected.dedup();
        uninspected.sort();
        uninspected.dedup();

        Self {
            layer: layer.to_string(),
            enabled,
            target_tools: target_tools.to_vec(),
            registered_tools: count,
            inspected,
            uninspected,
        }
    }

    pub fn status(&self) -> CoverageStatus {
        if !self.enabled {
            CoverageStatus::Disabled
        } else if self.registered_tools == 0 {
            CoverageStatus::NoToolsRegistered
        } else if self.inspected.is_empty() {
            CoverageStatus::Blind
        } else if self.uninspected.is_empty() {
            CoverageStatus::Full
        } else {
            CoverageStatus::Partial
        }
    }

    /// True when tools are registered and Layer 1 will inspect none of them.
    pub fn is_blind(&self) -> bool {
        self.status() == CoverageStatus::Blind
    }

    /// One line for a log or a dashboard. States the consequence, not the
    /// counts — "12 of 12 uninspected" is a statistic; "will inspect nothing"
    /// is the thing the reader needs to act on.
    pub fn summary(&self) -> String {
        let l = &self.layer;
        match self.status() {
            CoverageStatus::Disabled => {
                format!("{l}: layer is DISABLED; no tool input is inspected by it")
            }
            CoverageStatus::NoToolsRegistered => {
                format!("{l}: no tools registered yet; coverage will be evaluated as the registry fills")
            }
            CoverageStatus::Blind => format!(
                "{l}: will inspect NOTHING on this deployment. None of the {} registered \
                 tool(s) [{}] appears in its target_tools [{}]. This layer is name-matched, so \
                 a tool not on that list is never inspected. Clear target_tools to inspect \
                 every tool (the default), or add your tool names to it.",
                self.registered_tools,
                self.uninspected.join(", "),
                self.target_tools.join(", "),
            ),
            CoverageStatus::Partial => format!(
                "{l}: covers {} of {} registered tools; NOT inspected: [{}]. Narrowed by an \
                 explicit target_tools list.",
                self.inspected.len(),
                self.registered_tools,
                self.uninspected.join(", "),
            ),
            CoverageStatus::Full => {
                if self.target_tools.is_empty() {
                    format!(
                        "{l}: covers all {} registered tools (target_tools empty = inspect everything)",
                        self.registered_tools
                    )
                } else {
                    format!("{l}: covers all {} registered tools", self.registered_tools)
                }
            }
        }
    }
}

/// Coverage across every name-matched Airlock layer.
///
/// Both layers are reported together because they had the same defect and the
/// same fix; reporting one and not the other is how the second one stays
/// invisible.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AirlockCoverage {
    pub rce: LayerCoverage,
    pub exfiltration: LayerCoverage,
}

impl AirlockCoverage {
    pub fn reconcile(registered: &[String], rce: &RceConfig, exfil: &ExfiltrationConfig) -> Self {
        Self {
            rce: LayerCoverage::reconcile("anti_rce", registered, rce.enabled, &rce.target_tools),
            exfiltration: LayerCoverage::reconcile(
                "exfiltration",
                registered,
                exfil.enabled,
                &exfil.target_tools,
            ),
        }
    }

    /// Every layer, so a caller can log or serialize them uniformly.
    pub fn layers(&self) -> [&LayerCoverage; 2] {
        [&self.rce, &self.exfiltration]
    }

    /// True if ANY name-matched layer is blind. One blind layer is a finding
    /// even when the other is fine.
    pub fn any_blind(&self) -> bool {
        self.layers().iter().any(|l| l.is_blind())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The four tools this repository's own seed registers.
    const SEEDED: [&str; 4] = ["git_read", "git_write", "test_run", "github_create_pr"];

    fn seeded() -> Vec<String> {
        SEEDED.iter().map(|s| s.to_string()).collect()
    }

    fn targets(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    // =====================================================================
    // COV-001: the shipped defaults now cover the shipped seed
    //
    // This is the regression that matters. Before 0.8.12 both defaults were
    // literal name guesses and both layers inspected zero of four.
    // =====================================================================
    #[test]
    fn the_default_config_inspects_every_seeded_tool_on_both_layers() {
        let cov = AirlockCoverage::reconcile(
            &seeded(),
            &RceConfig::default(),
            &ExfiltrationConfig::default(),
        );
        assert!(
            !cov.any_blind(),
            "no layer may be blind on the shipped defaults"
        );
        for layer in cov.layers() {
            assert_eq!(layer.status(), CoverageStatus::Full, "{}", layer.layer);
            assert_eq!(layer.inspected.len(), 4, "{}", layer.layer);
            assert!(layer.uninspected.is_empty(), "{}", layer.layer);
            assert!(layer.target_tools.is_empty(), "default must be inspect-all");
        }
    }

    #[test]
    fn the_old_shell_shaped_default_would_have_been_blind() {
        // Pins the bug this fix removed, so a future "tidy-up" that restores a
        // literal default list fails here with the reason attached.
        let old_default = targets(&[
            "write_file",
            "create_file",
            "create_or_update_file",
            "python_repl",
            "bash",
            "execute_command",
            "run_script",
            "shell",
        ]);
        let layer = LayerCoverage::reconcile("anti_rce", seeded(), true, &old_default);
        assert_eq!(layer.status(), CoverageStatus::Blind);
        assert!(layer.summary().contains("inspect NOTHING"));
    }

    // =====================================================================
    // COV-002: narrowing is still supported, and still reported
    // =====================================================================
    #[test]
    fn an_explicit_narrow_list_still_reports_what_it_misses() {
        let layer = LayerCoverage::reconcile("anti_rce", seeded(), true, &targets(&["git_write"]));
        assert_eq!(layer.status(), CoverageStatus::Partial);
        assert_eq!(layer.inspected, vec!["git_write"]);
        assert_eq!(layer.uninspected.len(), 3);
        assert!(layer.summary().contains("NOT inspected"));
    }

    #[test]
    fn a_narrow_list_that_matches_nothing_is_blind() {
        let layer = LayerCoverage::reconcile("exfiltration", seeded(), true, &targets(&["curl"]));
        assert_eq!(layer.status(), CoverageStatus::Blind);
        assert!(layer.is_blind());
        let s = layer.summary();
        assert!(
            s.contains("exfiltration"),
            "the layer must name itself: {s}"
        );
        assert!(
            s.contains("Clear target_tools"),
            "must say how to fix it: {s}"
        );
    }

    // =====================================================================
    // COV-003: the states that are not findings
    // =====================================================================
    #[test]
    fn an_empty_registry_is_not_a_finding() {
        let layer = LayerCoverage::reconcile("anti_rce", Vec::<String>::new(), true, &[]);
        assert_eq!(layer.status(), CoverageStatus::NoToolsRegistered);
        assert!(!layer.is_blind(), "a fresh database must not warn");
    }

    #[test]
    fn a_disabled_layer_reports_disabled_not_blind() {
        let layer = LayerCoverage::reconcile("anti_rce", seeded(), false, &targets(&["curl"]));
        assert_eq!(layer.status(), CoverageStatus::Disabled);
        assert!(
            !layer.is_blind(),
            "switched off on purpose is a different fact from silently covering nothing"
        );
    }

    #[test]
    fn one_blind_layer_is_a_finding_even_when_the_other_is_full() {
        let exfil = ExfiltrationConfig {
            target_tools: targets(&["curl"]), // matches nothing seeded
            ..ExfiltrationConfig::default()
        };
        let cov = AirlockCoverage::reconcile(&seeded(), &RceConfig::default(), &exfil);
        assert_eq!(cov.rce.status(), CoverageStatus::Full);
        assert_eq!(cov.exfiltration.status(), CoverageStatus::Blind);
        assert!(
            cov.any_blind(),
            "one blind layer must not be masked by a healthy one"
        );
    }

    // =====================================================================
    // COV-004: reporting must never be more optimistic than the matcher
    // =====================================================================
    #[test]
    fn duplicate_and_blank_registry_entries_do_not_skew_the_count() {
        let reg = vec![
            "git_write".to_string(),
            "git_write".to_string(),
            "  ".to_string(),
        ];
        let layer = LayerCoverage::reconcile("anti_rce", reg, true, &targets(&["curl"]));
        assert_eq!(layer.registered_tools, 2, "blanks are not tools");
        assert_eq!(layer.uninspected, vec!["git_write"], "deduped for display");
    }

    #[test]
    fn coverage_round_trips_for_the_readiness_payload() {
        let cov = AirlockCoverage::reconcile(
            &seeded(),
            &RceConfig::default(),
            &ExfiltrationConfig::default(),
        );
        let json = serde_json::to_string(&cov).unwrap();
        let back: AirlockCoverage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, cov);
        assert_eq!(
            serde_json::to_string(&CoverageStatus::Blind).unwrap(),
            "\"blind\""
        );
    }
}
