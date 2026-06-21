//! Eval-driven harness/policy suggestion handlers (HarnessX trace→delta).
//!
//! fd-evals derives a *proposed* harness adjustment from an eval run's trace
//! and POSTs it here. The suggestion is persisted as a **proposal only** —
//! deny-by-default and human-in-the-loop are preserved: nothing in this module
//! mutates a live policy, tool allowlist, or budget. An operator reviews it in
//! the dashboard and approves or rejects; *applying* an approved change is a
//! separate, explicit step outside this handler.
//!
//! Storage mirrors [`super::promotions`] exactly: the structured
//! [`HarnessSuggestion`] is written to the immutable `audit_events` trail via
//! `AuditEventBuilder` → `spawn_audit`, read back via
//! `AuditRepo::list_harness_suggestions`, and the lifecycle is an append-only
//! chain of `harness.suggestion.{created,approved,rejected}` events folded
//! into a status on the read path.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use fd_policy::harness::{fold_status, HarnessSuggestion, SuggestionEvidence, SuggestionKind};
use fd_storage::models::{action, actor, resource, AuditEventBuilder};
use serde::{Deserialize, Serialize};
use tracing::{instrument, warn};
use ulid::Ulid;
use utoipa::ToSchema;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

const DEFAULT_HARNESS_HISTORY_LIMIT: i64 = 100;

// =============================================================================
// Request / response DTOs
// =============================================================================

/// A single piece of trace-derived evidence behind a suggestion.
#[derive(Debug, Deserialize, ToSchema)]
pub struct EvidenceRequest {
    pub code: String,
    pub detail: String,
    #[serde(default)]
    pub observed: Option<f64>,
}

/// Create a proposed harness/policy suggestion (called by fd-evals).
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateHarnessSuggestionRequest {
    /// Agent the suggestion targets.
    pub agent_id: String,
    /// The eval run that produced it, if any.
    #[serde(default)]
    pub source_eval_run_id: Option<String>,
    /// `tool_scope` | `budget` | `policy`.
    pub kind: String,
    /// Current state snapshot (for the reviewer's diff).
    pub current: serde_json::Value,
    /// Proposed replacement.
    pub proposed: serde_json::Value,
    /// Why the eval proposes this.
    pub reason: String,
    /// Trace-derived evidence.
    #[serde(default)]
    pub evidence: Vec<EvidenceRequest>,
    /// Confidence in `[0, 1]`.
    #[serde(default)]
    pub confidence: f64,
}

/// Resolve (approve/reject) a proposed suggestion. Records the operator's
/// decision; does NOT apply the change.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ResolveHarnessSuggestionRequest {
    pub approve: bool,
    #[serde(default)]
    pub note: Option<String>,
}

/// A harness suggestion projected for the API response.
#[derive(Debug, Serialize, ToSchema)]
pub struct HarnessSuggestionResponse {
    pub id: String,
    pub agent_id: String,
    pub source_eval_run_id: Option<String>,
    /// `tool_scope` | `budget` | `policy`.
    pub kind: String,
    pub current: serde_json::Value,
    pub proposed: serde_json::Value,
    pub reason: String,
    /// Per-evidence `{code, detail, observed?}` array.
    pub evidence: serde_json::Value,
    pub confidence: f64,
    /// `proposed` | `approved` | `rejected` (folded from the audit chain).
    pub status: String,
    /// SHA-256 over the immutable proposal content — tamper-evidence.
    pub content_hash: String,
    pub created_at: String,
    pub anchor: String,
}

impl HarnessSuggestionResponse {
    fn from_suggestion(s: HarnessSuggestion) -> Self {
        Self {
            id: s.id,
            agent_id: s.agent_id,
            source_eval_run_id: s.source_eval_run_id,
            kind: s.kind.as_str().to_string(),
            current: s.current,
            proposed: s.proposed,
            reason: s.reason,
            evidence: serde_json::to_value(&s.evidence).unwrap_or(serde_json::Value::Null),
            confidence: s.confidence,
            status: s.status.as_str().to_string(),
            content_hash: s.content_hash,
            created_at: s.created_at.to_rfc3339(),
            anchor: s.anchor,
        }
    }
}

/// All suggestions for an agent (newest-first).
#[derive(Debug, Serialize, ToSchema)]
pub struct HarnessSuggestionsResponse {
    pub agent_id: String,
    pub suggestions: Vec<HarnessSuggestionResponse>,
    pub anchor: String,
}

// =============================================================================
// Pure helpers (unit-tested)
// =============================================================================

/// Parse the wire `kind` string into a [`SuggestionKind`].
fn parse_kind(kind: &str) -> Result<SuggestionKind, ApiError> {
    match kind {
        "tool_scope" => Ok(SuggestionKind::ToolScope),
        "budget" => Ok(SuggestionKind::Budget),
        "policy" => Ok(SuggestionKind::Policy),
        other => Err(ApiError::bad_request(format!(
            "invalid suggestion kind '{other}' (expected tool_scope | budget | policy)"
        ))),
    }
}

/// Read-path projection: from harness-suggestion audit rows (newest-first,
/// each `(action, details, occurred_at)`), recover every created proposal and
/// overlay its folded lifecycle status from the resolution chain. Malformed
/// `created` rows are skipped. Pure — no I/O — so it is unit-tested directly.
fn fold_suggestions(rows: &[(String, serde_json::Value, DateTime<Utc>)]) -> Vec<HarnessSuggestion> {
    use std::collections::{HashMap, HashSet};

    // suggestion_id -> chronological (occurred_at, approved)
    let mut resolves: HashMap<String, Vec<(DateTime<Utc>, bool)>> = HashMap::new();
    for (action_name, details, occurred_at) in rows {
        let approved = if action_name == action::HARNESS_SUGGESTION_APPROVED {
            true
        } else if action_name == action::HARNESS_SUGGESTION_REJECTED {
            false
        } else {
            continue;
        };
        if let Some(sid) = details.get("suggestion_id").and_then(|v| v.as_str()) {
            resolves
                .entry(sid.to_string())
                .or_default()
                .push((*occurred_at, approved));
        }
    }

    let mut out = Vec::new();
    let mut seen = HashSet::new();
    for (action_name, details, _) in rows {
        if action_name != action::HARNESS_SUGGESTION_CREATED {
            continue;
        }
        let Ok(suggestion) = HarnessSuggestion::from_audit_details(details) else {
            continue;
        };
        if !seen.insert(suggestion.id.clone()) {
            continue;
        }
        let status = match resolves.get(&suggestion.id) {
            Some(chain) => {
                let mut chain = chain.clone();
                chain.sort_by_key(|(t, _)| *t);
                let bools: Vec<bool> = chain.iter().map(|(_, a)| *a).collect();
                fold_status(&bools)
            }
            None => fold_status(&[]),
        };
        out.push(suggestion.with_status(status));
    }
    out
}

// =============================================================================
// Handlers
// =============================================================================

/// Create a proposed harness/policy suggestion.
///
/// Deny-by-default / human-in-the-loop: the suggestion is recorded as a
/// proposal and is **never** auto-applied to any live policy, allowlist, or
/// budget.
#[utoipa::path(
    post,
    path = "/v1/harness-suggestions",
    tag = "harness",
    request_body = CreateHarnessSuggestionRequest,
    responses(
        (status = 201, description = "Suggestion recorded (proposed)", body = HarnessSuggestionResponse),
        (status = 400, description = "Invalid suggestion kind"),
        (status = 403, description = "Caller lacks access to the agent's project"),
        (status = 404, description = "Agent not found")
    )
)]
#[instrument(skip(state, auth, request), fields(agent_id = %request.agent_id))]
pub async fn create_harness_suggestion(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(request): Json<CreateHarnessSuggestionRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let agent = repos
        .agents()
        .get(&request.agent_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Agent", &request.agent_id))?;

    if !super::project_access_allowed(repos, &auth, &agent.project_id).await? {
        warn!(agent_id = %request.agent_id, "Unauthorized harness-suggestion create attempt");
        return Err(ApiError::forbidden("Access denied to this agent"));
    }

    let kind = parse_kind(&request.kind)?;
    let evidence: Vec<SuggestionEvidence> = request
        .evidence
        .into_iter()
        .map(|e| SuggestionEvidence {
            code: e.code,
            detail: e.detail,
            observed: e.observed,
        })
        .collect();

    let suggestion = HarnessSuggestion::propose(
        format!("hns_{}", Ulid::new()),
        request.agent_id,
        request.source_eval_run_id,
        kind,
        request.current,
        request.proposed,
        request.reason,
        evidence,
        request.confidence,
        Utc::now(),
    );

    let audit_event = AuditEventBuilder::new(
        action::HARNESS_SUGGESTION_CREATED,
        resource::HARNESS_SUGGESTION,
    )
    .actor(actor::API_KEY, Some(auth.api_key_id.clone()))
    .resource_id(&suggestion.agent_id)
    .project(&agent.project_id)
    .details(suggestion.to_audit_details())
    .build();
    repos.spawn_audit(audit_event);

    Ok((
        StatusCode::CREATED,
        Json(HarnessSuggestionResponse::from_suggestion(suggestion)),
    ))
}

/// List harness suggestions for an agent (newest-first), with each
/// suggestion's lifecycle status folded from the audit chain.
#[utoipa::path(
    get,
    path = "/v1/harness-suggestions/agent/{agent_id}",
    tag = "harness",
    params(("agent_id" = String, Path, description = "Agent ID")),
    responses(
        (status = 200, description = "Harness suggestions", body = HarnessSuggestionsResponse),
        (status = 403, description = "Caller lacks access to the agent's project"),
        (status = 404, description = "Agent not found")
    )
)]
#[instrument(skip(state, auth))]
pub async fn get_harness_suggestions(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(agent_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let agent = repos
        .agents()
        .get(&agent_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Agent", &agent_id))?;

    if !super::project_access_allowed(repos, &auth, &agent.project_id).await? {
        warn!(agent_id = %agent_id, "Unauthorized harness-suggestion list attempt");
        return Err(ApiError::forbidden("Access denied to this agent"));
    }

    let events = repos
        .audit()
        .list_harness_suggestions(&agent_id, DEFAULT_HARNESS_HISTORY_LIMIT)
        .await?;

    let rows: Vec<(String, serde_json::Value, DateTime<Utc>)> = events
        .into_iter()
        .map(|e| (e.action, e.details, e.occurred_at))
        .collect();

    let suggestions = fold_suggestions(&rows)
        .into_iter()
        .map(HarnessSuggestionResponse::from_suggestion)
        .collect();

    Ok(Json(HarnessSuggestionsResponse {
        agent_id,
        suggestions,
        anchor: fd_policy::harness::HARNESS_ANCHOR.to_string(),
    }))
}

/// Approve or reject a proposed suggestion. Records the operator's decision in
/// the audit trail; **does not apply** the change to any live policy.
#[utoipa::path(
    post,
    path = "/v1/harness-suggestions/{suggestion_id}/resolve",
    tag = "harness",
    params(("suggestion_id" = String, Path, description = "Suggestion ID")),
    request_body = ResolveHarnessSuggestionRequest,
    responses(
        (status = 200, description = "Resolution recorded", body = HarnessSuggestionResponse),
        (status = 403, description = "Caller lacks access to the agent's project"),
        (status = 404, description = "Suggestion not found")
    )
)]
#[instrument(skip(state, auth, request))]
pub async fn resolve_harness_suggestion(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(suggestion_id): Path<String>,
    Json(request): Json<ResolveHarnessSuggestionRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let created = repos
        .audit()
        .get_harness_suggestion_created(&suggestion_id)
        .await?
        .ok_or_else(|| ApiError::not_found("HarnessSuggestion", &suggestion_id))?;

    let suggestion = HarnessSuggestion::from_audit_details(&created.details)
        .map_err(|_| ApiError::internal("Corrupt harness-suggestion record"))?;

    let project_id = created
        .project_id
        .clone()
        .ok_or_else(|| ApiError::internal("Harness suggestion missing project binding"))?;

    if !super::project_access_allowed(repos, &auth, &project_id).await? {
        warn!(
            suggestion_id = %suggestion_id,
            "Unauthorized harness-suggestion resolve attempt"
        );
        return Err(ApiError::forbidden("Access denied to this suggestion"));
    }

    let (resolve_action, status) = if request.approve {
        (
            action::HARNESS_SUGGESTION_APPROVED,
            fd_policy::harness::SuggestionStatus::Approved,
        )
    } else {
        (
            action::HARNESS_SUGGESTION_REJECTED,
            fd_policy::harness::SuggestionStatus::Rejected,
        )
    };

    let audit_event = AuditEventBuilder::new(resolve_action, resource::HARNESS_SUGGESTION)
        .actor(actor::API_KEY, Some(auth.api_key_id.clone()))
        .resource_id(&suggestion.agent_id)
        .project(&project_id)
        .details(serde_json::json!({
            "suggestion_id": suggestion_id,
            "approved": request.approve,
            "note": request.note,
        }))
        .build();
    repos.spawn_audit(audit_event);

    Ok(Json(HarnessSuggestionResponse::from_suggestion(
        suggestion.with_status(status),
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ts(secs: i64) -> DateTime<Utc> {
        DateTime::<Utc>::from_timestamp(secs, 0).expect("valid timestamp")
    }

    fn created_row(id: &str, secs: i64) -> (String, serde_json::Value, DateTime<Utc>) {
        let s = HarnessSuggestion::propose(
            id,
            "agt_demo",
            None,
            SuggestionKind::Budget,
            json!({"cap": 100}),
            json!({"cap": 50}),
            "reason",
            vec![],
            0.8,
            ts(secs),
        );
        (
            action::HARNESS_SUGGESTION_CREATED.to_string(),
            s.to_audit_details(),
            ts(secs),
        )
    }

    fn resolve_row(
        id: &str,
        approved: bool,
        secs: i64,
    ) -> (String, serde_json::Value, DateTime<Utc>) {
        let act = if approved {
            action::HARNESS_SUGGESTION_APPROVED
        } else {
            action::HARNESS_SUGGESTION_REJECTED
        };
        (
            act.to_string(),
            json!({"suggestion_id": id, "approved": approved}),
            ts(secs),
        )
    }

    #[test]
    fn parse_kind_maps_known_strings() {
        // ApiError doesn't impl Debug, so match rather than unwrap.
        assert!(matches!(
            parse_kind("tool_scope"),
            Ok(SuggestionKind::ToolScope)
        ));
        assert!(matches!(parse_kind("budget"), Ok(SuggestionKind::Budget)));
        assert!(matches!(parse_kind("policy"), Ok(SuggestionKind::Policy)));
        assert!(parse_kind("nonsense").is_err());
    }

    #[test]
    fn fold_unresolved_is_proposed() {
        // Newest-first ordering as the repo returns it.
        let rows = vec![created_row("hns_a", 100)];
        let folded = fold_suggestions(&rows);
        assert_eq!(folded.len(), 1);
        assert_eq!(
            folded[0].status,
            fd_policy::harness::SuggestionStatus::Proposed
        );
        assert!(folded[0].verify_hash());
    }

    #[test]
    fn fold_applies_latest_resolution() {
        // Rejected then later approved → Approved (last write wins).
        let rows = vec![
            resolve_row("hns_a", true, 300),
            resolve_row("hns_a", false, 200),
            created_row("hns_a", 100),
        ];
        let folded = fold_suggestions(&rows);
        assert_eq!(folded.len(), 1);
        assert_eq!(
            folded[0].status,
            fd_policy::harness::SuggestionStatus::Approved
        );
    }

    #[test]
    fn fold_groups_multiple_suggestions_newest_first() {
        let rows = vec![
            created_row("hns_b", 400),
            resolve_row("hns_a", false, 250),
            created_row("hns_a", 100),
        ];
        let folded = fold_suggestions(&rows);
        assert_eq!(folded.len(), 2);
        // Preserves the newest-first order of the created rows.
        assert_eq!(folded[0].id, "hns_b");
        assert_eq!(
            folded[0].status,
            fd_policy::harness::SuggestionStatus::Proposed
        );
        assert_eq!(folded[1].id, "hns_a");
        assert_eq!(
            folded[1].status,
            fd_policy::harness::SuggestionStatus::Rejected
        );
    }

    #[test]
    fn fold_skips_malformed_created_rows() {
        let rows = vec![(
            action::HARNESS_SUGGESTION_CREATED.to_string(),
            json!({"not": "a suggestion"}),
            ts(100),
        )];
        assert!(fold_suggestions(&rows).is_empty());
    }
}
