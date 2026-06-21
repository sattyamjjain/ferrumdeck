//! Training-signal export (HarnessX trace→signal).
//!
//! Projects a run's **existing trace** (its steps) into a JSONL of
//! `(state, action, observation, outcome_score)` tuples suitable as a
//! downstream training / eval signal. Every `state` and `observation` is run
//! through the **existing audit redaction path** — `fd_audit::redaction::
//! redact_json` — so the same PII/secret patterns the audit trail strips are
//! stripped here too. There is exactly one redactor, server-side; callers
//! (fd-evals, the dashboard download) consume the already-redacted stream.
//!
//! `outcome_score` defaults to a trace-intrinsic signal derived from each
//! step's terminal status; an eval can pass per-step `score_overrides` to
//! layer richer scorer output on top.

use std::collections::HashMap;

use axum::{
    extract::{Path, State},
    http::header,
    response::IntoResponse,
    Extension, Json,
};
use fd_storage::models::{Step, StepStatus, StepType};
use serde::Deserialize;
use tracing::{instrument, warn};
use utoipa::ToSchema;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

/// Optional outcome-score overrides supplied by the caller (e.g. an eval's
/// scorer output). Per-step `score_overrides` (keyed by `step_id`) win; a
/// single `run_score` applies to every step that has no per-step override
/// (an eval scores a whole run, not individual steps, and doesn't know the
/// server-side step ids); absent both, the score is trace-intrinsic.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct TrainingSignalRequest {
    #[serde(default)]
    pub score_overrides: HashMap<String, f64>,
    #[serde(default)]
    pub run_score: Option<f64>,
}

/// Stable wire label for a step's action.
fn step_type_label(step_type: StepType) -> &'static str {
    match step_type {
        StepType::Llm => "llm",
        StepType::Tool => "tool",
        StepType::Retrieval => "retrieval",
        StepType::Human => "human",
    }
}

/// Trace-intrinsic outcome score from a step's terminal status. Overridden by
/// the caller's `score_overrides` when present.
fn status_score(status: StepStatus) -> f64 {
    match status {
        StepStatus::Completed => 1.0,
        StepStatus::Failed | StepStatus::Skipped => 0.0,
        // Non-terminal (pending/running/waiting) — unknown outcome.
        StepStatus::Pending | StepStatus::Running | StepStatus::WaitingApproval => 0.5,
    }
}

/// Build the redacted JSONL training signal for a run's steps. One line per
/// step: `{step_id, step_number, action, state, observation, outcome_score}`.
/// `state` and `observation` are redacted via the audit redaction path. Score
/// precedence: per-step override → `run_score` → trace-intrinsic status. Pure —
/// no I/O — so it is unit-tested directly.
fn build_signal_ndjson(
    steps: &[Step],
    overrides: &HashMap<String, f64>,
    run_score: Option<f64>,
) -> String {
    let mut out = String::new();
    for step in steps {
        let action = step
            .tool_name
            .clone()
            .unwrap_or_else(|| step_type_label(step.step_type).to_string());
        let state = fd_audit::redaction::redact_json(&step.input);
        let observation = match &step.output {
            Some(o) => fd_audit::redaction::redact_json(o),
            None => serde_json::Value::Null,
        };
        let outcome_score = overrides
            .get(&step.id)
            .copied()
            .or(run_score)
            .unwrap_or_else(|| status_score(step.status));

        let line = serde_json::json!({
            "step_id": step.id,
            "step_number": step.step_number,
            "action": action,
            "state": state,
            "observation": observation,
            "outcome_score": outcome_score,
        });
        // `Value`→string never fails; fall back to skipping a pathological row.
        if let Ok(s) = serde_json::to_string(&line) {
            out.push_str(&s);
            out.push('\n');
        }
    }
    out
}

/// Export a run's trace as a redacted `(state, action, observation,
/// outcome_score)` training-signal JSONL.
#[utoipa::path(
    post,
    path = "/v1/runs/{run_id}/training-signal",
    tag = "runs",
    params(("run_id" = String, Path, description = "Run ID")),
    request_body = TrainingSignalRequest,
    responses(
        (status = 200, description = "Redacted training-signal JSONL (application/x-ndjson)", body = String),
        (status = 403, description = "Caller lacks access to the run's project"),
        (status = 404, description = "Run not found")
    )
)]
#[instrument(skip(state, auth, request))]
pub async fn export_training_signal(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
    Json(request): Json<TrainingSignalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let run = state
        .repos()
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    if !super::project_access_allowed(state.repos(), &auth, &run.project_id).await? {
        warn!(
            run_id = %run_id,
            run_project = %run.project_id,
            "Unauthorized training-signal export attempt from different tenant"
        );
        return Err(ApiError::forbidden("Access denied to this run"));
    }

    let steps = state.repos().steps().list_by_run(&run_id).await?;
    let ndjson = build_signal_ndjson(&steps, &request.score_overrides, request.run_score);

    Ok(([(header::CONTENT_TYPE, "application/x-ndjson")], ndjson))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    fn step(id: &str, number: i32, status: StepStatus, input: serde_json::Value) -> Step {
        Step {
            id: id.to_string(),
            run_id: "run_demo".to_string(),
            parent_step_id: None,
            step_number: number,
            step_type: StepType::Tool,
            input,
            output: Some(json!({"result": "ok"})),
            tool_name: Some("http_post".to_string()),
            tool_version: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
            status,
            error: None,
            created_at: Utc::now(),
            started_at: None,
            completed_at: None,
            span_id: None,
        }
    }

    fn parse_lines(ndjson: &str) -> Vec<serde_json::Value> {
        ndjson
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| serde_json::from_str(l).expect("valid jsonl line"))
            .collect()
    }

    #[test]
    fn one_line_per_step_with_expected_shape() {
        let steps = vec![
            step("stp_1", 1, StepStatus::Completed, json!({"q": "hi"})),
            step("stp_2", 2, StepStatus::Failed, json!({"q": "bye"})),
        ];
        let lines = parse_lines(&build_signal_ndjson(&steps, &HashMap::new(), None));
        assert_eq!(lines.len(), 2);
        for line in &lines {
            for key in [
                "step_id",
                "step_number",
                "action",
                "state",
                "observation",
                "outcome_score",
            ] {
                assert!(line.get(key).is_some(), "missing {key}");
            }
        }
        assert_eq!(lines[0]["action"], "http_post");
    }

    #[test]
    fn outcome_score_precedence_status_run_override() {
        let steps = vec![
            step("stp_1", 1, StepStatus::Completed, json!({})),
            step("stp_2", 2, StepStatus::Failed, json!({})),
        ];
        // No overrides: status-derived.
        let lines = parse_lines(&build_signal_ndjson(&steps, &HashMap::new(), None));
        assert_eq!(lines[0]["outcome_score"], 1.0);
        assert_eq!(lines[1]["outcome_score"], 0.0);

        // run_score applies to every step lacking a per-step override.
        let lines = parse_lines(&build_signal_ndjson(&steps, &HashMap::new(), Some(0.42)));
        assert_eq!(lines[0]["outcome_score"], 0.42);
        assert_eq!(lines[1]["outcome_score"], 0.42);

        // Per-step override beats run_score, which beats status.
        let mut overrides = HashMap::new();
        overrides.insert("stp_2".to_string(), 0.73);
        let lines = parse_lines(&build_signal_ndjson(&steps, &overrides, Some(0.42)));
        assert_eq!(lines[0]["outcome_score"], 0.42);
        assert_eq!(lines[1]["outcome_score"], 0.73);
    }

    #[test]
    fn state_and_observation_are_redacted() {
        // Inject content the audit redactor strips (a token-like secret + an
        // email field name). Assert the placeholder appears and the raw
        // secret does not survive into the signal.
        let secret = "sk-ABCDEF0123456789ABCDEF0123456789";
        let steps = vec![step(
            "stp_1",
            1,
            StepStatus::Completed,
            json!({"api_key": secret, "email": "alice@example.com"}),
        )];
        let ndjson = build_signal_ndjson(&steps, &HashMap::new(), None);
        assert!(
            ndjson.contains("[REDACTED]"),
            "expected redaction placeholder in: {ndjson}"
        );
        assert!(
            !ndjson.contains(secret),
            "raw secret leaked into training signal: {ndjson}"
        );
    }

    #[test]
    fn action_falls_back_to_step_type_when_no_tool_name() {
        let mut s = step("stp_1", 1, StepStatus::Completed, json!({}));
        s.tool_name = None;
        s.step_type = StepType::Llm;
        let lines = parse_lines(&build_signal_ndjson(&[s], &HashMap::new(), None));
        assert_eq!(lines[0]["action"], "llm");
    }

    #[test]
    fn empty_steps_yields_empty_signal() {
        assert!(build_signal_ndjson(&[], &HashMap::new(), None).is_empty());
    }
}
