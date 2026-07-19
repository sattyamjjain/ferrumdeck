//! End-to-end: a Colorado SB 26-189 ADMT decision's disclosure flag reaches the
//! OTel decision span.
//!
//! The rule (`fd_policy::colorado_sb26_189`) is pure and OTel-free; the *span*
//! emission is the shared `fd_otel::emit_tool_decision_span` path (reused, not a
//! parallel emitter). This test wires the two together the way the gateway would
//! and captures the emitted span with a tracing subscriber to assert the
//! `ferrumdeck.admt_disclosure` attribute carries the rule's flag.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};

use fd_otel::{DecisionOutcome, GenAiSemconv};
use fd_policy::colorado_sb26_189::{
    check, AdmtDecisionContext, AutomationRole, ColoradoAdmtConfig, ColoradoAdmtStatus,
    ConsequentialDomain,
};
use fd_policy::reversibility::ResponseLevel;
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

/// Map a Colorado verdict to the shared decision outcome the way the gateway
/// would: a covered-but-undisclosed decision under enforce is an R3 approval
/// gate; everything else allows.
fn outcome_for(status: ColoradoAdmtStatus) -> DecisionOutcome {
    match status {
        ColoradoAdmtStatus::MissingDisclosure => DecisionOutcome::Approval,
        _ => DecisionOutcome::Allow,
    }
}

#[test]
fn covered_decision_disclosure_flag_reaches_the_span() {
    // A consequential decision materially driven by an ADMT, not disclosed.
    let ctx = AdmtDecisionContext {
        domain: Some(ConsequentialDomain::Employment),
        automation: AutomationRole::AdmtMaterial,
        disclosed: false,
    };
    let status = check(&ctx, ColoradoAdmtConfig::default());
    assert_eq!(status, ColoradoAdmtStatus::MissingDisclosure);
    assert!(status.disclosure_required());

    let spans = capture(|| {
        fd_otel::emit_tool_decision_span(
            GenAiSemconv::Default,
            "approve_loan_application",
            outcome_for(status),
            "colorado_sb26_189: covered ADMT consequential decision missing disclosure",
            Some(ResponseLevel::RequireApproval.rung()),
            None,
            None,
            Some(status.disclosure_required()),
        );
    });

    let s = spans
        .iter()
        .find(|s| s.name == "gen_ai.tool.call")
        .expect("decision span emitted");
    // The rule's disclosure flag rode the span.
    assert_eq!(s.fields.get("ferrumdeck.admt_disclosure").unwrap(), "true");
    assert_eq!(s.fields.get("ferrumdeck.decision").unwrap(), "approval");
    assert_eq!(s.fields.get("ferrumdeck.rung").unwrap(), "R3");
}

#[test]
fn exempt_decision_emits_disclosure_false_not_missing() {
    // A non-consequential decision: the rule is evaluated (flag present) but the
    // decision is exempt, so the flag is false — distinct from "not evaluated".
    let ctx = AdmtDecisionContext {
        domain: None,
        automation: AutomationRole::AdmtMaterial,
        disclosed: false,
    };
    let status = check(&ctx, ColoradoAdmtConfig::default());
    assert_eq!(status, ColoradoAdmtStatus::Exempt);

    let spans = capture(|| {
        fd_otel::emit_tool_decision_span(
            GenAiSemconv::Default,
            "summarize_text",
            outcome_for(status),
            "colorado_sb26_189: not a covered ADMT consequential decision",
            None,
            None,
            None,
            Some(status.disclosure_required()),
        );
    });

    let s = spans
        .iter()
        .find(|s| s.name == "gen_ai.tool.call")
        .expect("decision span emitted");
    assert_eq!(s.fields.get("ferrumdeck.admt_disclosure").unwrap(), "false");
    assert_eq!(s.fields.get("ferrumdeck.decision").unwrap(), "allow");
}
