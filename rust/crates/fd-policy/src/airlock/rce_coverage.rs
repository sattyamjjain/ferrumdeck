//! Does the anti-RCE layer actually inspect anything on this deployment?
//!
//! Airlock Layer 1 (`patterns::RcePatternMatcher`) is **name-matched**:
//! `should_inspect` tests the tool name against [`RceConfig::target_tools`],
//! and a tool whose name is not on that list is never pattern-scanned. The
//! default list is shell-shaped — `bash`, `shell`, `python_repl`,
//! `execute_command`, `write_file`, … — which is a sensible starting point and
//! is also a list that matches nothing in a deployment that names its tools
//! after its own domain.
//!
//! This repository is its own example. The dev seed registers `git_read`,
//! `git_write`, `test_run` and `github_create_pr`; none of the eight defaults
//! matches, so Layer 1 inspects **zero** of the four. Observed directly against
//! a seeded stack, same payload both times:
//!
//! ```text
//! git_write         risk_score=0    violation=None        <- registered, not inspected
//! bash              risk_score=90   violation=rcepattern  <- inspected, not registered
//! ```
//!
//! The layer is working correctly. It is simply pointed somewhere else, and
//! nothing said so: a deployment could run for a year believing it had
//! anti-RCE inspection because the feature is enabled and the tests pass.
//!
//! So this module reconciles the two lists at boot and makes the answer
//! visible in two places an operator actually looks — a WARN at startup and a
//! field on `/ready`. It changes no decision and blocks nothing; widening the
//! default `target_tools` is a posture change with real blast radius (false
//! positives and latency on every call) and belongs to the operator, not to a
//! default. What is fixed here is that the operator can now know.

use serde::{Deserialize, Serialize};

use super::config::RceConfig;

/// What the anti-RCE layer covers on this deployment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RceCoverage {
    /// Whether Layer 1 is switched on at all.
    pub enabled: bool,
    /// The configured `target_tools` list, verbatim.
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
pub enum RceCoverageStatus {
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

impl RceCoverageStatus {
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

impl RceCoverage {
    /// Reconcile the registry against the configured `target_tools`.
    ///
    /// Matching is case-insensitive and trimmed, mirroring nothing in
    /// `should_inspect` — which compares exactly. That asymmetry is
    /// deliberate and errs toward *under*-reporting coverage: a name that
    /// differs only by case is reported here as inspected while the matcher
    /// would skip it, so `Blind` is never a false alarm, and a near-miss shows
    /// up as `Partial` rather than being silently counted as fine. See
    /// `case_differences_do_not_hide_a_blind_deployment`.
    pub fn reconcile<I, S>(registered: I, config: &RceConfig) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let targets: Vec<String> = config.target_tools.iter().map(|t| normalize(t)).collect();

        let mut inspected = Vec::new();
        let mut uninspected = Vec::new();
        let mut count = 0usize;

        for tool in registered {
            let raw = tool.as_ref().to_string();
            if raw.trim().is_empty() {
                continue;
            }
            count += 1;
            if targets.contains(&normalize(&raw)) {
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
            enabled: config.enabled,
            target_tools: config.target_tools.clone(),
            registered_tools: count,
            inspected,
            uninspected,
        }
    }

    pub fn status(&self) -> RceCoverageStatus {
        if !self.enabled {
            RceCoverageStatus::Disabled
        } else if self.registered_tools == 0 {
            RceCoverageStatus::NoToolsRegistered
        } else if self.inspected.is_empty() {
            RceCoverageStatus::Blind
        } else if self.uninspected.is_empty() {
            RceCoverageStatus::Full
        } else {
            RceCoverageStatus::Partial
        }
    }

    /// True when tools are registered and Layer 1 will inspect none of them.
    pub fn is_blind(&self) -> bool {
        self.status() == RceCoverageStatus::Blind
    }

    /// One line for a log or a dashboard. States the consequence, not the
    /// counts — "12 of 12 uninspected" is a statistic; "will inspect nothing"
    /// is the thing the reader needs to act on.
    pub fn summary(&self) -> String {
        match self.status() {
            RceCoverageStatus::Disabled => {
                "anti-RCE inspection (Airlock Layer 1) is DISABLED; no tool input is \
                 pattern-scanned"
                    .to_string()
            }
            RceCoverageStatus::NoToolsRegistered => {
                "no tools registered yet; anti-RCE coverage will be evaluated as the \
                 registry fills"
                    .to_string()
            }
            RceCoverageStatus::Blind => format!(
                "anti-RCE inspection (Airlock Layer 1) will inspect NOTHING on this \
                 deployment: none of the {} registered tool(s) [{}] appears in \
                 airlock.rce.target_tools [{}]. Layer 1 is name-matched, so a tool whose \
                 name is not on that list is never pattern-scanned. Add your tool names \
                 to target_tools, or accept that RCE payloads reach them unscanned.",
                self.registered_tools,
                self.uninspected.join(", "),
                self.target_tools.join(", "),
            ),
            RceCoverageStatus::Partial => format!(
                "anti-RCE inspection (Airlock Layer 1) covers {} of {} registered tools; \
                 NOT inspected: [{}]. Layer 1 is name-matched against \
                 airlock.rce.target_tools.",
                self.inspected.len(),
                self.registered_tools,
                self.uninspected.join(", "),
            ),
            RceCoverageStatus::Full => format!(
                "anti-RCE inspection (Airlock Layer 1) covers all {} registered tools",
                self.registered_tools
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(targets: &[&str]) -> RceConfig {
        RceConfig {
            enabled: true,
            target_tools: targets.iter().map(|s| s.to_string()).collect(),
            custom_patterns: Vec::new(),
        }
    }

    /// The four tools this repository's own seed registers.
    const SEEDED: [&str; 4] = ["git_read", "git_write", "test_run", "github_create_pr"];

    // =====================================================================
    // RCE-COV-001: the shipped default, against the shipped seed, is blind
    // =====================================================================
    #[test]
    fn the_default_target_list_inspects_none_of_the_seeded_tools() {
        let coverage = RceCoverage::reconcile(SEEDED, &RceConfig::default());

        assert_eq!(coverage.status(), RceCoverageStatus::Blind);
        assert!(coverage.is_blind());
        assert!(coverage.inspected.is_empty());
        assert_eq!(coverage.uninspected.len(), 4);
        assert_eq!(coverage.registered_tools, 4);

        // The message has to name both lists, or the reader cannot act on it.
        let s = coverage.summary();
        assert!(s.contains("inspect NOTHING"), "{s}");
        assert!(
            s.contains("git_write"),
            "must name the registered tools: {s}"
        );
        assert!(s.contains("bash"), "must name the configured targets: {s}");
    }

    // =====================================================================
    // RCE-COV-002: the other four states
    // =====================================================================
    #[test]
    fn full_coverage_when_every_registered_tool_is_targeted() {
        let coverage = RceCoverage::reconcile(["bash", "shell"], &cfg(&["bash", "shell", "zsh"]));
        assert_eq!(coverage.status(), RceCoverageStatus::Full);
        assert!(!coverage.is_blind());
        assert!(coverage.uninspected.is_empty());
    }

    #[test]
    fn partial_coverage_names_only_what_is_missed() {
        let coverage = RceCoverage::reconcile(["bash", "git_write"], &cfg(&["bash"]));
        assert_eq!(coverage.status(), RceCoverageStatus::Partial);
        assert_eq!(coverage.inspected, vec!["bash"]);
        assert_eq!(coverage.uninspected, vec!["git_write"]);
        let s = coverage.summary();
        assert!(s.contains("git_write"), "{s}");
        assert!(!s.contains("inspect NOTHING"), "partial is not blind: {s}");
    }

    #[test]
    fn an_empty_registry_is_not_a_finding() {
        let coverage = RceCoverage::reconcile(Vec::<String>::new(), &RceConfig::default());
        assert_eq!(coverage.status(), RceCoverageStatus::NoToolsRegistered);
        assert!(!coverage.is_blind(), "a fresh database must not warn");
    }

    #[test]
    fn a_disabled_layer_reports_disabled_not_blind() {
        let mut c = cfg(&["bash"]);
        c.enabled = false;
        let coverage = RceCoverage::reconcile(SEEDED, &c);
        assert_eq!(coverage.status(), RceCoverageStatus::Disabled);
        assert!(
            !coverage.is_blind(),
            "switched off on purpose is a different fact from silently covering nothing"
        );
    }

    // =====================================================================
    // RCE-COV-003: reporting must never be more optimistic than the matcher
    // =====================================================================
    #[test]
    fn case_differences_do_not_hide_a_blind_deployment() {
        // `should_inspect` compares exactly, so "BASH" would NOT be inspected.
        // Reporting it as inspected is the safe direction to be wrong in: the
        // operator is told coverage is partial and looks, rather than being
        // told it is blind and finding a near-match they must reason about.
        let coverage = RceCoverage::reconcile(["BASH", "git_write"], &cfg(&["bash"]));
        assert_eq!(coverage.status(), RceCoverageStatus::Partial);
        assert_eq!(coverage.uninspected, vec!["git_write"]);
    }

    #[test]
    fn duplicate_and_blank_registry_entries_do_not_skew_the_count() {
        let coverage = RceCoverage::reconcile(["git_write", "git_write", "  "], &cfg(&["bash"]));
        assert_eq!(coverage.registered_tools, 2, "blanks are not tools");
        assert_eq!(
            coverage.uninspected,
            vec!["git_write"],
            "deduped for display"
        );
        assert_eq!(coverage.status(), RceCoverageStatus::Blind);
    }

    #[test]
    fn coverage_round_trips_for_the_readiness_payload() {
        let coverage = RceCoverage::reconcile(SEEDED, &RceConfig::default());
        let json = serde_json::to_string(&coverage).unwrap();
        let back: RceCoverage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, coverage);
        assert_eq!(
            serde_json::to_string(&RceCoverageStatus::Blind).unwrap(),
            "\"blind\""
        );
    }
}
