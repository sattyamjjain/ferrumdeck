//! Enforcement-decision GenAI span contract.
//!
//! FerrumDeck is in the call path: it returns an **allow / deny / approval /
//! kill** verdict *before* a tool executes. This module turns that verdict into
//! a first-class OpenTelemetry **GenAI span** so every enforcement decision is
//! queryable in Jaeger (or any OTLP backend) — not merely an after-the-fact log
//! line. It is the enforce-not-observe wedge, made observable.
//!
//! ## Semconv stability opt-in
//!
//! The OpenTelemetry GenAI semantic conventions are still *Development*-status
//! and rename attributes between releases. We follow the standard migration
//! knob, [`OTEL_SEMCONV_STABILITY_OPT_IN`]: when its comma-separated value
//! contains [`GEN_AI_LATEST_EXPERIMENTAL`] the span uses the **latest
//! experimental** tool-execution naming —
//!
//! | aspect            | default (unset)      | `gen_ai_latest_experimental` |
//! |-------------------|----------------------|------------------------------|
//! | span name         | `gen_ai.tool.call`   | `execute_tool`               |
//! | operation attr    | *(absent)*           | `gen_ai.operation.name`      |
//! | tool-call-id key  | `gen_ai.tool.call_id`| `gen_ai.tool.call.id`        |
//!
//! Unset/other → the **current** names (the safe default). The `ferrumdeck.*`
//! decision attributes ([`attrs::FERRUMDECK_DECISION`] etc.) are stable across
//! both conventions. The Python data plane mirrors this in
//! `fd_runtime.tracing`, so both planes write one schema.

use crate::genai::attrs;

/// Environment variable that selects the OTel semantic-convention stability set.
/// Comma-separated; the presence of [`GEN_AI_LATEST_EXPERIMENTAL`] opts in.
pub const OTEL_SEMCONV_STABILITY_OPT_IN: &str = "OTEL_SEMCONV_STABILITY_OPT_IN";

/// Opt-in token that selects the latest experimental GenAI conventions.
pub const GEN_AI_LATEST_EXPERIMENTAL: &str = "gen_ai_latest_experimental";

/// The four in-path enforcement outcomes emitted on the decision span.
///
/// `Allow` / `Deny` / `Approval` come from the tool-call policy check
/// (allowlist + Airlock + the R1–R3 reversibility ladder); `Kill` is the
/// budget circuit-breaker terminating a run (`RunStatus::BudgetKilled`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecisionOutcome {
    /// The tool call may proceed.
    Allow,
    /// The tool call is blocked (allowlist deny-by-default or Airlock block).
    Deny,
    /// The tool call needs human approval before it can proceed.
    Approval,
    /// The run was terminated by the budget circuit breaker.
    Kill,
}

impl DecisionOutcome {
    /// Stable wire label written to `ferrumdeck.decision`.
    pub fn as_str(self) -> &'static str {
        match self {
            DecisionOutcome::Allow => "allow",
            DecisionOutcome::Deny => "deny",
            DecisionOutcome::Approval => "approval",
            DecisionOutcome::Kill => "kill",
        }
    }
}

/// Resolved OTel GenAI semconv naming mode — see the module docs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenAiSemconv {
    /// Current stable names (the default when the opt-in is unset).
    Default,
    /// Latest experimental names (`gen_ai_latest_experimental` opted in).
    LatestExperimental,
}

impl GenAiSemconv {
    /// Resolve from the process environment ([`OTEL_SEMCONV_STABILITY_OPT_IN`]).
    pub fn from_env() -> Self {
        Self::from_opt_in(std::env::var(OTEL_SEMCONV_STABILITY_OPT_IN).ok().as_deref())
    }

    /// Resolve from a raw opt-in string (comma-separated). Pure — no env read,
    /// so callers and tests can pin the value deterministically.
    pub fn from_opt_in(raw: Option<&str>) -> Self {
        let opted_in = raw
            .map(|v| v.split(',').any(|t| t.trim() == GEN_AI_LATEST_EXPERIMENTAL))
            .unwrap_or(false);
        if opted_in {
            GenAiSemconv::LatestExperimental
        } else {
            GenAiSemconv::Default
        }
    }

    /// Whether the latest experimental conventions are in effect.
    pub fn is_latest_experimental(self) -> bool {
        matches!(self, GenAiSemconv::LatestExperimental)
    }

    /// Span name for the tool-execution decision span.
    pub fn tool_span_name(self) -> &'static str {
        match self {
            GenAiSemconv::Default => "gen_ai.tool.call",
            GenAiSemconv::LatestExperimental => "execute_tool",
        }
    }

    /// `gen_ai.operation.name` value under the latest experimental convention;
    /// `None` under the stable default (the attribute is absent there).
    pub fn operation_name(self) -> Option<&'static str> {
        match self {
            GenAiSemconv::Default => None,
            GenAiSemconv::LatestExperimental => Some("execute_tool"),
        }
    }

    /// Attribute **key** for the tool call id. The semconv renamed
    /// `gen_ai.tool.call_id` (current) → `gen_ai.tool.call.id` (latest).
    pub fn tool_call_id_key(self) -> &'static str {
        match self {
            GenAiSemconv::Default => attrs::GEN_AI_TOOL_CALL_ID,
            GenAiSemconv::LatestExperimental => "gen_ai.tool.call.id",
        }
    }
}

/// Emit the enforcement decision as an OTel GenAI span, named + keyed per the
/// resolved [`GenAiSemconv`].
///
/// `tool_name` + `outcome` + `reason` are always recorded; `rung` (R1/R2/R3),
/// `budget_remaining` (cents of cost headroom), `call_id`, and `admt_disclosure`
/// are recorded when known (the data plane, for instance, knows the outcome but
/// not the control-plane rung/budget). The span is a short child of the current
/// span so it inherits the run/step trace context and is exported on close.
///
/// `admt_disclosure` carries the Colorado SB 26-189 (2026) ADMT-disclosure flag
/// for a covered consequential decision (see
/// `fd_policy::colorado_sb26_189`): `Some(true)` when the decision is covered
/// and the disclosure obligation applies, `Some(false)` when the rule was
/// evaluated and the decision is exempt, `None` when the rule was not evaluated.
/// It rides the same span as the enforcement verdict rather than a parallel
/// emitter.
///
/// Naming caveat: the OTel **GenAI semantic conventions are still
/// *Development*-status** in the semconv repo (zero stable releases as of
/// 2026-07), so the `gen_ai.*` names may still move between semconv versions.
/// They are kept behind the [`GenAiSemconv`] resolver so a rename stays a
/// one-line change here; the `ferrumdeck.*` attributes (including
/// `ferrumdeck.admt_disclosure`) are our own and stable across both conventions.
#[allow(clippy::too_many_arguments)]
pub fn emit_tool_decision_span(
    semconv: GenAiSemconv,
    tool_name: &str,
    outcome: DecisionOutcome,
    reason: &str,
    rung: Option<&str>,
    budget_remaining: Option<u64>,
    call_id: Option<&str>,
    admt_disclosure: Option<bool>,
) {
    // `tracing` span names must be `'static` literals, so we branch on the
    // resolved mode rather than interpolating. Mode-dependent keys
    // (`gen_ai.tool.call_id` vs `gen_ai.tool.call.id`, and the operation attr)
    // are declared per branch; optional values are declared `Empty` and
    // recorded below only when present.
    let span = match semconv {
        GenAiSemconv::LatestExperimental => tracing::info_span!(
            target: "ferrumdeck::decision",
            "execute_tool",
            gen_ai.operation.name = "execute_tool",
            gen_ai.tool.name = tool_name,
            gen_ai.tool.call.id = tracing::field::Empty,
            ferrumdeck.decision = outcome.as_str(),
            ferrumdeck.reason = reason,
            ferrumdeck.rung = tracing::field::Empty,
            ferrumdeck.budget_remaining = tracing::field::Empty,
            ferrumdeck.admt_disclosure = tracing::field::Empty,
        ),
        GenAiSemconv::Default => tracing::info_span!(
            target: "ferrumdeck::decision",
            "gen_ai.tool.call",
            gen_ai.tool.name = tool_name,
            gen_ai.tool.call_id = tracing::field::Empty,
            ferrumdeck.decision = outcome.as_str(),
            ferrumdeck.reason = reason,
            ferrumdeck.rung = tracing::field::Empty,
            ferrumdeck.budget_remaining = tracing::field::Empty,
            ferrumdeck.admt_disclosure = tracing::field::Empty,
        ),
    };

    if let Some(r) = rung {
        span.record(attrs::FERRUMDECK_DECISION_RUNG, r);
    }
    if let Some(rem) = budget_remaining {
        // i64 so an unbounded/zero cap reads cleanly in the backend.
        span.record(attrs::FERRUMDECK_BUDGET_REMAINING, rem as i64);
    }
    if let Some(id) = call_id {
        span.record(semconv.tool_call_id_key(), id);
    }
    if let Some(disclosure) = admt_disclosure {
        span.record(attrs::FERRUMDECK_ADMT_DISCLOSURE, disclosure);
    }

    // Materialize + close the span so it is exported even though we never run
    // work inside it — the decision *is* the event.
    let _entered = span.entered();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semconv_from_opt_in_detects_the_token() {
        assert_eq!(GenAiSemconv::from_opt_in(None), GenAiSemconv::Default);
        assert_eq!(GenAiSemconv::from_opt_in(Some("")), GenAiSemconv::Default);
        assert_eq!(
            GenAiSemconv::from_opt_in(Some("database")),
            GenAiSemconv::Default
        );
        assert_eq!(
            GenAiSemconv::from_opt_in(Some("gen_ai_latest_experimental")),
            GenAiSemconv::LatestExperimental
        );
        // Comma-separated with whitespace + an unrelated token.
        assert_eq!(
            GenAiSemconv::from_opt_in(Some("http/dup , gen_ai_latest_experimental")),
            GenAiSemconv::LatestExperimental
        );
        // A superstring must NOT match (exact token only).
        assert_eq!(
            GenAiSemconv::from_opt_in(Some("gen_ai_latest_experimental_x")),
            GenAiSemconv::Default
        );
    }

    #[test]
    fn opt_in_flips_span_name_operation_and_call_id_key() {
        assert_eq!(GenAiSemconv::Default.tool_span_name(), "gen_ai.tool.call");
        assert_eq!(
            GenAiSemconv::LatestExperimental.tool_span_name(),
            "execute_tool"
        );
        assert_eq!(GenAiSemconv::Default.operation_name(), None);
        assert_eq!(
            GenAiSemconv::LatestExperimental.operation_name(),
            Some("execute_tool")
        );
        assert_eq!(
            GenAiSemconv::Default.tool_call_id_key(),
            "gen_ai.tool.call_id"
        );
        assert_eq!(
            GenAiSemconv::LatestExperimental.tool_call_id_key(),
            "gen_ai.tool.call.id"
        );
    }

    #[test]
    fn outcome_wire_labels() {
        assert_eq!(DecisionOutcome::Allow.as_str(), "allow");
        assert_eq!(DecisionOutcome::Deny.as_str(), "deny");
        assert_eq!(DecisionOutcome::Approval.as_str(), "approval");
        assert_eq!(DecisionOutcome::Kill.as_str(), "kill");
    }
}

// A capturing subscriber proves the emitted span actually carries the right
// name + attributes, and that the opt-in flips them — the behaviour the
// gateway + worker depend on.
#[cfg(test)]
mod span_tests {
    use super::*;
    use std::collections::{BTreeMap, HashMap};
    use std::sync::{Arc, Mutex};
    use tracing::field::{Field, Visit};
    use tracing_subscriber::layer::{Context, Layer};
    use tracing_subscriber::prelude::*;
    use tracing_subscriber::registry::LookupSpan;

    #[derive(Clone, Default)]
    struct Captured {
        name: String,
        fields: BTreeMap<String, String>,
    }

    #[derive(Clone, Default)]
    struct CaptureLayer {
        spans: Arc<Mutex<HashMap<u64, Captured>>>,
    }

    struct FieldVisitor<'a>(&'a mut BTreeMap<String, String>);
    impl Visit for FieldVisitor<'_> {
        fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
            self.0
                .insert(field.name().to_string(), format!("{value:?}"));
        }
        fn record_str(&mut self, field: &Field, value: &str) {
            self.0.insert(field.name().to_string(), value.to_string());
        }
        fn record_i64(&mut self, field: &Field, value: i64) {
            self.0.insert(field.name().to_string(), value.to_string());
        }
        fn record_u64(&mut self, field: &Field, value: u64) {
            self.0.insert(field.name().to_string(), value.to_string());
        }
        fn record_bool(&mut self, field: &Field, value: bool) {
            self.0.insert(field.name().to_string(), value.to_string());
        }
    }

    impl<S> Layer<S> for CaptureLayer
    where
        S: tracing::Subscriber + for<'a> LookupSpan<'a>,
    {
        fn on_new_span(
            &self,
            attrs: &tracing::span::Attributes<'_>,
            id: &tracing::span::Id,
            _ctx: Context<'_, S>,
        ) {
            let mut fields = BTreeMap::new();
            attrs.record(&mut FieldVisitor(&mut fields));
            self.spans.lock().unwrap().insert(
                id.into_u64(),
                Captured {
                    name: attrs.metadata().name().to_string(),
                    fields,
                },
            );
        }

        fn on_record(
            &self,
            id: &tracing::span::Id,
            values: &tracing::span::Record<'_>,
            _ctx: Context<'_, S>,
        ) {
            let mut guard = self.spans.lock().unwrap();
            if let Some(cap) = guard.get_mut(&id.into_u64()) {
                values.record(&mut FieldVisitor(&mut cap.fields));
            }
        }
    }

    fn capture<F: FnOnce()>(f: F) -> Vec<Captured> {
        let layer = CaptureLayer::default();
        let spans = layer.spans.clone();
        let subscriber = tracing_subscriber::registry().with(layer);
        tracing::subscriber::with_default(subscriber, f);
        let out = spans.lock().unwrap();
        out.values().cloned().collect()
    }

    #[test]
    fn default_mode_emits_stable_tool_call_span_with_decision_attrs() {
        let spans = capture(|| {
            emit_tool_decision_span(
                GenAiSemconv::Default,
                "delete_repo",
                DecisionOutcome::Deny,
                "tool 'delete_repo' is not in allowlist",
                Some("R3"),
                Some(0),
                Some("pdc_deny"),
                None,
            );
        });
        let s = spans
            .iter()
            .find(|s| s.name == "gen_ai.tool.call")
            .expect("stable-named decision span");
        assert_eq!(s.fields.get("gen_ai.tool.name").unwrap(), "delete_repo");
        assert_eq!(s.fields.get("ferrumdeck.decision").unwrap(), "deny");
        assert_eq!(
            s.fields.get("ferrumdeck.reason").unwrap(),
            "tool 'delete_repo' is not in allowlist"
        );
        assert_eq!(s.fields.get("ferrumdeck.rung").unwrap(), "R3");
        assert_eq!(s.fields.get("ferrumdeck.budget_remaining").unwrap(), "0");
        assert!(s.fields.contains_key("gen_ai.tool.call_id"));
        // The stable convention must NOT emit the latest-experimental keys.
        assert!(!s.fields.contains_key("gen_ai.tool.call.id"));
        assert!(!s.fields.contains_key("gen_ai.operation.name"));
    }

    #[test]
    fn latest_experimental_flips_span_name_and_attribute_keys() {
        let spans = capture(|| {
            emit_tool_decision_span(
                GenAiSemconv::LatestExperimental,
                "read_file",
                DecisionOutcome::Allow,
                "tool 'read_file' is in allowlist",
                Some("R1"),
                None,
                Some("pdc_allow"),
                None,
            );
        });
        let s = spans
            .iter()
            .find(|s| s.name == "execute_tool")
            .expect("latest-experimental decision span");
        assert_eq!(
            s.fields.get("gen_ai.operation.name").unwrap(),
            "execute_tool"
        );
        assert!(s.fields.contains_key("gen_ai.tool.call.id"));
        assert!(!s.fields.contains_key("gen_ai.tool.call_id"));
        assert_eq!(s.fields.get("ferrumdeck.decision").unwrap(), "allow");
        // budget_remaining was None → the field stays unset.
        assert!(!s.fields.contains_key("ferrumdeck.budget_remaining"));
    }

    #[test]
    fn admt_disclosure_flag_is_recorded_when_present_and_absent_when_none() {
        // Colorado SB 26-189: a covered consequential decision carries
        // ferrumdeck.admt_disclosure=true on the same decision span.
        let spans = capture(|| {
            emit_tool_decision_span(
                GenAiSemconv::Default,
                "approve_loan",
                DecisionOutcome::Approval,
                "colorado_sb26_189: covered ADMT decision missing disclosure",
                Some("R3"),
                None,
                None,
                Some(true),
            );
        });
        let s = spans
            .iter()
            .find(|s| s.name == "gen_ai.tool.call")
            .expect("decision span");
        assert_eq!(s.fields.get("ferrumdeck.admt_disclosure").unwrap(), "true");
        assert_eq!(s.fields.get("ferrumdeck.decision").unwrap(), "approval");

        // When the flag is None (rule not evaluated) the attribute stays unset.
        let spans = capture(|| {
            emit_tool_decision_span(
                GenAiSemconv::Default,
                "read_file",
                DecisionOutcome::Allow,
                "allowlisted",
                None,
                None,
                None,
                None,
            );
        });
        let s = spans
            .iter()
            .find(|s| s.name == "gen_ai.tool.call")
            .expect("decision span");
        assert!(!s.fields.contains_key("ferrumdeck.admt_disclosure"));
    }

    #[test]
    fn deny_approval_kill_each_carry_their_reason() {
        for (outcome, reason) in [
            (DecisionOutcome::Deny, "denied by allowlist"),
            (
                DecisionOutcome::Approval,
                "reversibility ladder (irreversible, R3) requires approval",
            ),
            (
                DecisionOutcome::Kill,
                "budget exceeded: cost 600 > 500 cents",
            ),
        ] {
            let spans = capture(|| {
                emit_tool_decision_span(
                    GenAiSemconv::Default,
                    "some_tool",
                    outcome,
                    reason,
                    None,
                    None,
                    None,
                    None,
                );
            });
            let s = spans
                .iter()
                .find(|s| s.name == "gen_ai.tool.call")
                .expect("decision span");
            assert_eq!(
                s.fields.get("ferrumdeck.decision").unwrap(),
                outcome.as_str()
            );
            assert_eq!(s.fields.get("ferrumdeck.reason").unwrap(), reason);
        }
    }
}
