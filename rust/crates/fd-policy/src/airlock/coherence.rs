//! Coherence-divergence monitor — a trajectory-level Airlock RASP signal.
//!
//! Every layer in [`super::inspector`] inspects a *single* tool call in
//! isolation. This monitor instead watches the agent run **trajectory** — the
//! existing audit-trail event stream — for a sequential failure pattern that
//! no per-call check can see: the agent **states a fact that should change its
//! plan** ("tests still failing", "permission denied", "the file does not
//! exist") and the very next *advancing* action proceeds **as if that fact
//! were untrue** (marks the task done, commits, reports success).
//!
//! Anchored on Strained Coherence (arxiv:2606.07889): in that study, coding-
//! agent trajectories exhibiting this divergence failed **94%** of the time
//! versus **46%** for trajectories without it (Fisher's exact p = 0.003) — a
//! pre-failure signal strong enough to be worth surfacing *before* the run
//! finishes, not only in a post-hoc autopsy.
//!
//! ## Streaming, not post-hoc
//!
//! [`CoherenceMonitor::observe_event`] consumes one trajectory event at a
//! time and returns `Some(CoherenceSpan)` the instant a divergence appears, so
//! a streaming consumer (worker / gateway) can raise it mid-run. The stateless
//! [`CoherenceMonitor::scan_trajectory`] replays a whole event slice for
//! post-hoc analysis and tests; both share the exact same detection core.
//!
//! ## Diff-compatible with the audit schema
//!
//! The emitted [`CoherenceSpan`] maps cleanly onto the existing audit-event
//! shape: [`CoherenceSpan::to_violation`] produces an [`AirlockViolation`]
//! (`violation_type = coherence_divergence`, the span JSON in `details`) that
//! flows through the identical `audit_events.details` path as every other
//! Airlock layer — no parallel store, no parallel decision channel.

use super::config::CoherenceConfig;
use super::inspector::{AirlockViolation, RiskLevel, ViolationType};
use crate::reversibility::ResponseLevel;
use fd_core::RunId;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use tokio::sync::RwLock;
use tracing::warn;

/// Stable anchor for the methodology, mirrored on every emitted span.
pub const COHERENCE_ANCHOR: &str = "arxiv:2606.07889";

/// Longest a stated-fact quote is retained verbatim in a span / violation,
/// in characters. Keeps audit `details` bounded without losing the lede.
const MAX_QUOTE_CHARS: usize = 280;

/// Category of a blocking fact — a stated observation that should change the
/// agent's plan. Drives both the resolution match and the span severity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockingCategory {
    /// A test run reported failures.
    TestFailure,
    /// An action was denied / unauthorized / forbidden.
    PermissionDenied,
    /// A required file / path / resource was not found.
    MissingResource,
    /// A build / compile step failed.
    BuildError,
    /// A generic error / exception / panic with no more specific category.
    GenericError,
}

impl BlockingCategory {
    /// Stable snake_case label (matches the serde wire form), used in the
    /// violation `trigger` string.
    pub fn label(self) -> &'static str {
        match self {
            BlockingCategory::TestFailure => "test_failure",
            BlockingCategory::PermissionDenied => "permission_denied",
            BlockingCategory::MissingResource => "missing_resource",
            BlockingCategory::BuildError => "build_error",
            BlockingCategory::GenericError => "generic_error",
        }
    }
}

/// A single event in an agent run trajectory, projected from the audit-trail
/// event stream. The monitor only needs to know whether the agent *stated*
/// something or *did* something, plus the text.
#[derive(Debug, Clone)]
pub enum TrajectoryEvent {
    /// Something the agent observed or asserted — a tool result, an assistant
    /// message, a reasoning step. The candidate "stated fact".
    Statement(String),
    /// An advancing action: a status transition, a commit, a success report.
    /// `name` is the action / tool identifier; `text` is any accompanying
    /// detail (a commit message, a status note).
    Action { name: String, text: String },
}

impl TrajectoryEvent {
    /// Build a [`TrajectoryEvent::Statement`].
    pub fn statement(text: impl Into<String>) -> Self {
        TrajectoryEvent::Statement(text.into())
    }

    /// Build a [`TrajectoryEvent::Action`].
    pub fn action(name: impl Into<String>, text: impl Into<String>) -> Self {
        TrajectoryEvent::Action {
            name: name.into(),
            text: text.into(),
        }
    }
}

/// Structured span emitted when a coherence divergence is detected. This *is*
/// the payload serialized into [`AirlockViolation::details`], so the audit
/// trail carries the full evidence: the stated fact, the contradicting
/// action, and a confidence / severity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CoherenceSpan {
    /// Run this divergence was observed in.
    pub run_id: String,
    /// Verbatim quote of the stated fact that should have changed the plan
    /// (clipped to [`MAX_QUOTE_CHARS`]).
    pub stated_fact: String,
    /// Category of the blocking fact.
    pub category: BlockingCategory,
    /// The contradicting action that proceeded as if the fact were untrue.
    pub contradicting_action: String,
    /// Confidence in `[0, 1]` that this is a genuine divergence.
    pub confidence: f64,
    /// Risk score `0..=100` assigned to the divergence.
    pub risk_score: u8,
    /// Risk level derived from the score.
    pub risk_level: RiskLevel,
    /// Trajectory events between the stated fact and the contradicting action
    /// (always `>= 1`).
    pub gap: u64,
    /// Stable methodology anchor ([`COHERENCE_ANCHOR`]).
    pub anchor: String,
}

impl CoherenceSpan {
    /// Project this span onto the shared [`AirlockViolation`] shape so it
    /// flows through the identical audit path as every other Airlock layer.
    pub fn to_violation(&self) -> AirlockViolation {
        let details = serde_json::to_string(self).unwrap_or_else(|_| {
            format!(
                "coherence_divergence: {} -> {}",
                self.stated_fact, self.contradicting_action
            )
        });
        AirlockViolation {
            violation_type: ViolationType::CoherenceDivergence,
            risk_score: self.risk_score,
            risk_level: self.risk_level,
            details,
            trigger: format!("coherence_divergence:{}", self.category.label()),
        }
    }

    /// Map this divergence's severity onto the existing reversibility-ladder
    /// [`ResponseLevel`] (the DeepMind R1–R3 rungs) — reusing the graduated
    /// response type rather than inventing a new one. `Critical`/`High` → R3
    /// `RequireApproval`, `Medium` → R2 `AllowUnderBudget`, `Low` → R1
    /// `AllowAndLog`. The gateway consumer records this rung on every
    /// divergence; in `enforce` mode an R3 rung gates the run for human review,
    /// in `shadow` mode it is recorded only.
    pub fn response_level(&self) -> ResponseLevel {
        match self.risk_level {
            RiskLevel::Critical | RiskLevel::High => ResponseLevel::RequireApproval,
            RiskLevel::Medium => ResponseLevel::AllowUnderBudget,
            RiskLevel::Low => ResponseLevel::AllowAndLog,
        }
    }
}

/// A blocking fact still "open" — stated, but not yet resolved — within the
/// monitor's lookahead window.
#[derive(Debug, Clone)]
struct OpenFact {
    quote: String,
    category: BlockingCategory,
    /// Sequence number of the statement that opened it.
    seq: u64,
}

/// Per-run sequential state. Held under the monitor's `RwLock` map.
#[derive(Debug, Default)]
struct RunCoherenceState {
    open_facts: VecDeque<OpenFact>,
    seq: u64,
}

/// Tracks per-run trajectory state and reports coherence divergences.
///
/// Construct once at gateway / worker boot, wrap in `Arc`, and feed it the
/// run's audit events as they stream in. Mirrors the sibling-monitor pattern
/// used by [`super::behavioral_drift::BehavioralDriftMonitor`].
#[derive(Debug, Default)]
pub struct CoherenceMonitor {
    runs: RwLock<HashMap<String, RunCoherenceState>>,
}

impl CoherenceMonitor {
    /// Create an empty monitor.
    pub fn new() -> Self {
        Self {
            runs: RwLock::new(HashMap::new()),
        }
    }

    /// Whether this monitor holds any state for the given run — primarily for
    /// tests.
    pub async fn is_tracked(&self, run_id: &RunId) -> bool {
        self.runs.read().await.contains_key(&run_id.to_string())
    }

    /// Drop all trajectory state for a completed run to free memory.
    pub async fn clear_run(&self, run_id: &RunId) {
        self.runs.write().await.remove(&run_id.to_string());
    }

    /// Ingest the next trajectory event for `run_id`. Returns `Some` the
    /// instant this event completes a divergence (a closure action while a
    /// blocking fact is still open), so the caller can surface it mid-run.
    pub async fn observe_event(
        &self,
        run_id: &RunId,
        event: &TrajectoryEvent,
        config: &CoherenceConfig,
    ) -> Option<CoherenceSpan> {
        if !config.enabled {
            return None;
        }
        let key = run_id.to_string();
        let mut runs = self.runs.write().await;
        let state = runs.entry(key.clone()).or_default();
        let span = step(&key, state, event, config);
        if let Some(ref s) = span {
            warn!(
                run_id = %run_id,
                category = s.category.label(),
                confidence = s.confidence,
                gap = s.gap,
                "coherence divergence detected"
            );
        }
        span
    }

    /// Replay a whole trajectory statelessly and collect every divergence.
    /// Convenience for post-hoc analysis and tests — shares the exact same
    /// detection core as [`Self::observe_event`].
    pub fn scan_trajectory(
        run_id: &str,
        events: &[TrajectoryEvent],
        config: &CoherenceConfig,
    ) -> Vec<CoherenceSpan> {
        if !config.enabled {
            return Vec::new();
        }
        let mut state = RunCoherenceState::default();
        let mut spans = Vec::new();
        for event in events {
            if let Some(span) = step(run_id, &mut state, event, config) {
                spans.push(span);
            }
        }
        spans
    }
}

// =============================================================================
// Detection core (pure, synchronous — shared by both entry points)
// =============================================================================

/// Advance the per-run state by one event, returning a span iff this event is
/// a closure action that contradicts a still-open blocking fact.
fn step(
    run_id: &str,
    state: &mut RunCoherenceState,
    event: &TrajectoryEvent,
    config: &CoherenceConfig,
) -> Option<CoherenceSpan> {
    state.seq += 1;
    let now = state.seq;

    // Expire facts older than the lookahead window from the front of the
    // deque (facts are pushed in sequence order, so the front is oldest).
    let lookahead = config.lookahead.max(1) as u64;
    while let Some(front) = state.open_facts.front() {
        if now.saturating_sub(front.seq) > lookahead {
            state.open_facts.pop_front();
        } else {
            break;
        }
    }

    match event {
        TrajectoryEvent::Statement(text) => {
            let lower = text.to_lowercase();
            // Resolution takes precedence over a blocking match in the same
            // sentence ("tests were failing but now pass" is a resolution).
            if is_generic_resolution(&lower) {
                state.open_facts.clear();
                return None;
            }
            if let Some(cat) = match_resolution(&lower) {
                state.open_facts.retain(|f| f.category != cat);
                return None;
            }
            if let Some(cat) = match_blocking(&lower) {
                state.open_facts.push_back(OpenFact {
                    quote: clip(text),
                    category: cat,
                    seq: now,
                });
            }
            None
        }
        TrajectoryEvent::Action { name, text } => {
            let combined = format!("{name} {text}").to_lowercase();
            // An action that itself disclaims success — "cannot complete,
            // tests still failing" — is coherent, not divergent. This is the
            // primary false-positive guard, so it runs before the closure
            // check.
            if is_abort_or_disclaimer(&combined) {
                return None;
            }
            if !is_closure_action(&combined) {
                return None;
            }
            // Pair with the most recent still-open blocking fact.
            let fact = state.open_facts.back().cloned()?;
            let gap = now.saturating_sub(fact.seq).max(1);
            let confidence = compute_confidence(fact.category, gap, config.lookahead);
            if confidence < config.min_confidence {
                return None;
            }
            // Consume the fact so the same statement can't fire twice.
            state.open_facts.pop_back();

            let risk_score = config.risk_score.min(100);
            Some(CoherenceSpan {
                run_id: run_id.to_string(),
                stated_fact: fact.quote,
                category: fact.category,
                contradicting_action: render_action(name, text),
                confidence,
                risk_score,
                risk_level: RiskLevel::from_score(risk_score),
                gap,
                anchor: COHERENCE_ANCHOR.to_string(),
            })
        }
    }
}

/// Confidence that a closure-while-open pairing is a genuine divergence.
/// Higher when the contradicting action follows the stated fact closely and
/// when the fact has a specific (non-generic) category.
fn compute_confidence(category: BlockingCategory, gap: u64, lookahead: usize) -> f64 {
    let la = lookahead.max(1) as f64;
    let base = 0.6;
    // gap == 1 (adjacent) → full proximity; decays toward the window edge.
    let proximity = ((la - (gap as f64 - 1.0)).max(0.0) / la) * 0.3;
    let category_bonus = match category {
        BlockingCategory::GenericError => 0.0,
        _ => 0.1,
    };
    (base + proximity + category_bonus).clamp(0.0, 1.0)
}

/// Render an action event for the `contradicting_action` field.
fn render_action(name: &str, text: &str) -> String {
    let name = name.trim();
    let text = text.trim();
    let rendered = if text.is_empty() {
        name.to_string()
    } else if name.is_empty() {
        text.to_string()
    } else {
        format!("{name}: {text}")
    };
    clip(&rendered)
}

/// Char-safe truncation to [`MAX_QUOTE_CHARS`], appending an ellipsis when cut.
fn clip(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= MAX_QUOTE_CHARS {
        return trimmed.to_string();
    }
    let mut out: String = trimmed.chars().take(MAX_QUOTE_CHARS).collect();
    out.push('…');
    out
}

/// First matching blocking category for a lowercased statement. Specific
/// categories are checked before [`BlockingCategory::GenericError`].
fn match_blocking(lower: &str) -> Option<BlockingCategory> {
    const TEST_FAILURE: &[&str] = &[
        "test failed",
        "tests failed",
        "tests still failing",
        "tests are failing",
        "still failing",
        "test failure",
        "failing test",
        "test suite failed",
        "tests did not pass",
        "tests didn't pass",
        "assertion failed",
    ];
    const PERMISSION_DENIED: &[&str] = &[
        "permission denied",
        "access denied",
        "not authorized",
        "unauthorized",
        "forbidden",
        "403 forbidden",
    ];
    const MISSING_RESOURCE: &[&str] = &[
        "no such file",
        "does not exist",
        "doesn't exist",
        "not found",
        "cannot find",
        "could not find",
        "missing file",
        "404 not found",
    ];
    const BUILD_ERROR: &[&str] = &[
        "build failed",
        "compilation failed",
        "compile error",
        "failed to compile",
        "does not compile",
        "build error",
    ];
    const GENERIC_ERROR: &[&str] = &[
        "error:",
        "exception",
        "panic",
        "traceback",
        "stack trace",
        "returned non-zero",
        "fatal:",
    ];

    if contains_any(lower, TEST_FAILURE) {
        Some(BlockingCategory::TestFailure)
    } else if contains_any(lower, PERMISSION_DENIED) {
        Some(BlockingCategory::PermissionDenied)
    } else if contains_any(lower, MISSING_RESOURCE) {
        Some(BlockingCategory::MissingResource)
    } else if contains_any(lower, BUILD_ERROR) {
        Some(BlockingCategory::BuildError)
    } else if contains_any(lower, GENERIC_ERROR) {
        Some(BlockingCategory::GenericError)
    } else {
        None
    }
}

/// A category-specific resolution: the agent stated the blocking fact is now
/// cleared. Clears only open facts of that category.
fn match_resolution(lower: &str) -> Option<BlockingCategory> {
    const TEST_RESOLVED: &[&str] = &[
        "tests now pass",
        "tests pass",
        "all tests pass",
        "tests passing",
        "tests are passing",
        "test suite passes",
        "tests green",
        "tests succeed",
    ];
    const PERMISSION_RESOLVED: &[&str] = &[
        "permission granted",
        "access granted",
        "now authorized",
        "approval granted",
        "approved access",
    ];
    const RESOURCE_RESOLVED: &[&str] = &[
        "file created",
        "created the file",
        "now exists",
        "file now exists",
        "found the file",
        "created file",
    ];
    const BUILD_RESOLVED: &[&str] = &[
        "build succeeded",
        "builds successfully",
        "compiled successfully",
        "now compiles",
        "build passing",
        "build is green",
    ];

    if contains_any(lower, TEST_RESOLVED) {
        Some(BlockingCategory::TestFailure)
    } else if contains_any(lower, PERMISSION_RESOLVED) {
        Some(BlockingCategory::PermissionDenied)
    } else if contains_any(lower, RESOURCE_RESOLVED) {
        Some(BlockingCategory::MissingResource)
    } else if contains_any(lower, BUILD_RESOLVED) {
        Some(BlockingCategory::BuildError)
    } else {
        None
    }
}

/// A generic statement of resolution that clears *all* open facts (the agent
/// declared the blocking situation fixed without naming a category).
fn is_generic_resolution(lower: &str) -> bool {
    const GENERIC: &[&str] = &[
        "now resolved",
        "issue resolved",
        "problem resolved",
        "has been resolved",
        "now works",
        "working now",
        "issue fixed",
        "problem fixed",
        "now succeeds",
        "has been fixed",
        "everything passes",
    ];
    contains_any(lower, GENERIC)
}

/// Whether a combined action string advances / closes the task (marks done,
/// commits, reports success).
fn is_closure_action(combined: &str) -> bool {
    const CLOSURE: &[&str] = &[
        "mark complete",
        "mark done",
        "mark as done",
        "mark as complete",
        "marked complete",
        "marked done",
        "task complete",
        "task done",
        "complete_task",
        "completed the task",
        "set status to done",
        "status: done",
        "status done",
        "mark_done",
        "finalize",
        "finish task",
        "commit",
        "git commit",
        "push to",
        "merge",
        "ship it",
        "deploy",
        "report success",
        "reporting success",
        "completed successfully",
        "ready to merge",
        "marking resolved",
    ];
    contains_any(combined, CLOSURE)
}

/// Whether a combined action string disclaims success / aborts — which makes
/// the action coherent with an open blocking fact rather than divergent.
fn is_abort_or_disclaimer(combined: &str) -> bool {
    const ABORT: &[&str] = &[
        "cannot",
        "can't",
        "could not",
        "couldn't",
        "unable to",
        "blocked",
        "abort",
        "aborting",
        "halt",
        "halting",
        "will not",
        "won't",
        "not complete",
        "do not mark",
        "don't mark",
        "not marking",
        "stopping",
        "still failing",
        "still broken",
        "not safe",
        "refuse",
        "skipping commit",
        "needs fixing",
        "needs work",
    ];
    contains_any(combined, ABORT)
}

fn contains_any(haystack: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| haystack.contains(n))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> CoherenceConfig {
        CoherenceConfig::default()
    }

    fn run() -> RunId {
        RunId::new()
    }

    // -- Divergence fires -----------------------------------------------------

    #[test]
    fn divergence_fires_tests_failing_then_mark_complete() {
        let events = [
            TrajectoryEvent::statement("the tests are still failing on CI"),
            TrajectoryEvent::action("set_status", "mark task complete"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert_eq!(spans.len(), 1, "expected exactly one divergence: {spans:?}");
        let s = &spans[0];
        assert_eq!(s.category, BlockingCategory::TestFailure);
        assert!(s.stated_fact.contains("still failing"));
        assert!(s.contradicting_action.contains("mark task complete"));
        assert_eq!(s.gap, 1);
        assert!(
            s.confidence >= 0.9,
            "adjacent divergence should be high-confidence: {}",
            s.confidence
        );
        assert_eq!(s.anchor, COHERENCE_ANCHOR);
    }

    #[test]
    fn divergence_fires_permission_denied_then_commit() {
        let events = [
            TrajectoryEvent::statement("write failed: permission denied"),
            TrajectoryEvent::action("git_commit", "commit the change"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].category, BlockingCategory::PermissionDenied);
    }

    #[test]
    fn divergence_fires_missing_file_then_report_success() {
        let events = [
            TrajectoryEvent::statement("config.yaml does not exist"),
            TrajectoryEvent::statement("loading configuration"),
            TrajectoryEvent::action("report", "completed successfully"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert_eq!(spans.len(), 1);
        assert_eq!(spans[0].category, BlockingCategory::MissingResource);
        assert_eq!(spans[0].gap, 2);
    }

    // -- Coherent runs do NOT fire (false-positive guard) ---------------------

    #[test]
    fn coherent_acknowledge_and_remediate_then_resolve_does_not_fire() {
        // States the failure, remediates, states it's resolved, THEN commits.
        let events = [
            TrajectoryEvent::statement("tests still failing: 2 assertions"),
            TrajectoryEvent::action("edit_file", "fix the off-by-one"),
            TrajectoryEvent::statement("all tests pass now"),
            TrajectoryEvent::action("git_commit", "commit the fix"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert!(spans.is_empty(), "resolved fact must not fire: {spans:?}");
    }

    #[test]
    fn coherent_disclaiming_action_does_not_fire() {
        // The action itself acknowledges the blocker — coherent.
        let events = [
            TrajectoryEvent::statement("permission denied on deploy"),
            TrajectoryEvent::action(
                "report",
                "cannot mark complete: permission denied, escalating",
            ),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert!(
            spans.is_empty(),
            "disclaiming action must not fire: {spans:?}"
        );
    }

    #[test]
    fn clean_run_with_no_blocking_fact_does_not_fire() {
        let events = [
            TrajectoryEvent::statement("starting the task"),
            TrajectoryEvent::action("git_commit", "commit the feature"),
            TrajectoryEvent::action("report", "completed successfully"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert!(spans.is_empty(), "clean run must not fire: {spans:?}");
    }

    #[test]
    fn remediation_action_alone_is_not_closure() {
        // Re-running tests is remediation, not a closure action.
        let events = [
            TrajectoryEvent::statement("tests failed"),
            TrajectoryEvent::action("run_tests", "re-running the suite"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert!(
            spans.is_empty(),
            "remediation is not a divergence: {spans:?}"
        );
    }

    #[test]
    fn generic_resolution_clears_all_open_facts() {
        let events = [
            TrajectoryEvent::statement("permission denied"),
            TrajectoryEvent::statement("the issue has been resolved"),
            TrajectoryEvent::action("git_commit", "commit"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert!(
            spans.is_empty(),
            "generic resolution must clear facts: {spans:?}"
        );
    }

    // -- Window / threshold guards --------------------------------------------

    #[test]
    fn stale_fact_beyond_lookahead_does_not_fire() {
        let mut cfg = config();
        cfg.lookahead = 3;
        let mut events = vec![TrajectoryEvent::statement("tests still failing")];
        // Push the closure well past the lookahead window with neutral chatter.
        for i in 0..6 {
            events.push(TrajectoryEvent::statement(format!("status update {i}")));
        }
        events.push(TrajectoryEvent::action("set_status", "mark task complete"));
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &cfg);
        assert!(spans.is_empty(), "stale fact must expire: {spans:?}");
    }

    #[test]
    fn high_min_confidence_suppresses_low_confidence_divergence() {
        let mut cfg = config();
        cfg.min_confidence = 0.99; // unreachable for a generic, distant fact
        let events = [
            TrajectoryEvent::statement("error: something odd happened"),
            TrajectoryEvent::statement("step a"),
            TrajectoryEvent::statement("step b"),
            TrajectoryEvent::statement("step c"),
            TrajectoryEvent::action("report", "completed successfully"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &cfg);
        assert!(
            spans.is_empty(),
            "min_confidence gate must suppress: {spans:?}"
        );
    }

    #[test]
    fn disabled_config_never_fires() {
        let mut cfg = config();
        cfg.enabled = false;
        let events = [
            TrajectoryEvent::statement("tests still failing"),
            TrajectoryEvent::action("set_status", "mark task complete"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &cfg);
        assert!(spans.is_empty());
    }

    // -- Streaming entry point ------------------------------------------------

    #[tokio::test]
    async fn observe_event_emits_exactly_at_the_contradicting_action() {
        let monitor = CoherenceMonitor::new();
        let run = run();
        let cfg = config();

        let first = monitor
            .observe_event(
                &run,
                &TrajectoryEvent::statement("tests still failing"),
                &cfg,
            )
            .await;
        assert!(first.is_none(), "no span on the stated fact alone");

        let second = monitor
            .observe_event(
                &run,
                &TrajectoryEvent::action("set_status", "mark task complete"),
                &cfg,
            )
            .await;
        let span = second.expect("span must surface on the contradicting action");
        assert_eq!(span.category, BlockingCategory::TestFailure);
        assert_eq!(span.run_id, run.to_string());
    }

    #[tokio::test]
    async fn clear_run_drops_state() {
        let monitor = CoherenceMonitor::new();
        let run = run();
        let cfg = config();
        monitor
            .observe_event(
                &run,
                &TrajectoryEvent::statement("tests still failing"),
                &cfg,
            )
            .await;
        assert!(monitor.is_tracked(&run).await);
        monitor.clear_run(&run).await;
        assert!(!monitor.is_tracked(&run).await);
        // After clear, the closure action has no open fact to contradict.
        let span = monitor
            .observe_event(
                &run,
                &TrajectoryEvent::action("set_status", "mark task complete"),
                &cfg,
            )
            .await;
        assert!(span.is_none());
    }

    // -- Diff-compatibility with the audit schema -----------------------------

    #[test]
    fn response_level_maps_severity_to_r_tier() {
        let mut span = CoherenceMonitor::scan_trajectory(
            "run_x",
            &[
                TrajectoryEvent::statement("tests still failing"),
                TrajectoryEvent::action("set_status", "mark task complete"),
            ],
            &config(),
        )
        .remove(0);
        // Default risk_score (70) → High → R3.
        span.risk_score = 90;
        span.risk_level = RiskLevel::from_score(90);
        assert_eq!(span.response_level(), ResponseLevel::RequireApproval);
        span.risk_level = RiskLevel::from_score(65);
        assert_eq!(span.response_level(), ResponseLevel::RequireApproval);
        span.risk_level = RiskLevel::from_score(45);
        assert_eq!(span.response_level(), ResponseLevel::AllowUnderBudget);
        span.risk_level = RiskLevel::from_score(10);
        assert_eq!(span.response_level(), ResponseLevel::AllowAndLog);
    }

    #[test]
    fn span_projects_onto_airlock_violation() {
        let events = [
            TrajectoryEvent::statement("tests still failing"),
            TrajectoryEvent::action("set_status", "mark task complete"),
        ];
        let span = &CoherenceMonitor::scan_trajectory("run_x", &events, &config())[0];
        let violation = span.to_violation();
        assert_eq!(violation.violation_type, ViolationType::CoherenceDivergence);
        assert_eq!(violation.trigger, "coherence_divergence:test_failure");
        // details round-trips back to the span.
        let recovered: CoherenceSpan = serde_json::from_str(&violation.details).unwrap();
        assert_eq!(recovered.category, BlockingCategory::TestFailure);
        assert_eq!(recovered.run_id, "run_x");
    }

    #[test]
    fn long_quote_is_clipped() {
        let long = "tests still failing ".repeat(100);
        let events = [
            TrajectoryEvent::statement(long),
            TrajectoryEvent::action("set_status", "mark task complete"),
        ];
        let span = &CoherenceMonitor::scan_trajectory("run_x", &events, &config())[0];
        assert!(span.stated_fact.chars().count() <= MAX_QUOTE_CHARS + 1);
    }

    #[test]
    fn multiple_divergences_in_one_trajectory() {
        let events = [
            TrajectoryEvent::statement("tests still failing"),
            TrajectoryEvent::action("set_status", "mark task complete"),
            TrajectoryEvent::statement("permission denied"),
            TrajectoryEvent::action("git_commit", "commit anyway"),
        ];
        let spans = CoherenceMonitor::scan_trajectory("run_x", &events, &config());
        assert_eq!(spans.len(), 2, "both divergences should fire: {spans:?}");
        assert_eq!(spans[0].category, BlockingCategory::TestFailure);
        assert_eq!(spans[1].category, BlockingCategory::PermissionDenied);
    }

    // -- Cross-plane parity ---------------------------------------------------

    /// The Python eval-plane mirror (`fd_evals.coherence`) asserts this exact
    /// same golden fixture in `test_coherence.py`. Feeding each case through
    /// the Rust detection core must yield the same ordered divergence
    /// categories the Python plane expects — so the two cores can never
    /// silently drift.
    #[test]
    fn golden_fixture_matches_python() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../../python/packages/fd-evals/tests/fixtures/coherence_divergence.golden.json"
        );
        let raw = std::fs::read_to_string(path).expect("read coherence golden fixture");
        let data: serde_json::Value = serde_json::from_str(&raw).expect("parse fixture");
        assert_eq!(data["anchor"], COHERENCE_ANCHOR);

        let cfg = config();
        for case in data["cases"].as_array().expect("cases array") {
            let name = case["name"].as_str().unwrap_or("");
            let events: Vec<TrajectoryEvent> = case["events"]
                .as_array()
                .expect("events array")
                .iter()
                .map(|e| {
                    let text = e["text"].as_str().unwrap_or("").to_string();
                    match e["kind"].as_str() {
                        Some("action") => {
                            TrajectoryEvent::action(e["name"].as_str().unwrap_or(""), text)
                        }
                        _ => TrajectoryEvent::statement(text),
                    }
                })
                .collect();
            let got: Vec<&str> = CoherenceMonitor::scan_trajectory(name, &events, &cfg)
                .iter()
                .map(|s| s.category.label())
                .collect();
            let expected: Vec<&str> = case["expected_categories"]
                .as_array()
                .expect("expected array")
                .iter()
                .map(|c| c.as_str().unwrap_or(""))
                .collect();
            assert_eq!(got, expected, "case {name}");
        }
    }
}
