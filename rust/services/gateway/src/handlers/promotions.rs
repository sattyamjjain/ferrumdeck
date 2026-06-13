//! Champion-challenger promotion-gate handlers.
//!
//! A registered challenger version cannot replace the live champion until it
//! clears the promotion gate (configurable metric thresholds + a required
//! human approval). The gate emits its verdict through the **same**
//! `fd_policy::PolicyDecision` channel every other gate uses (deny-by-default)
//! and writes the structured [`PromotionDecision`] — including the metric
//! evidence — to the immutable audit trail. No parallel decision channel and
//! no parallel store: the record lives in `audit_events` and is read back via
//! `AuditRepo::list_promotion_decisions`.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use fd_policy::promotion::{
    MetricThreshold, PromotionDecision, PromotionGate, PromotionGateConfig,
};
use fd_storage::models::{action, resource, AuditEventBuilder};
use serde::{Deserialize, Serialize};
use tracing::{instrument, warn};
use ulid::Ulid;
use utoipa::ToSchema;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

const DEFAULT_PROMOTION_HISTORY_LIMIT: i64 = 50;

// =============================================================================
// Request / response DTOs
// =============================================================================

/// A single metric threshold the challenger must clear (inclusive floor).
#[derive(Debug, Deserialize, ToSchema)]
pub struct MetricThresholdRequest {
    pub name: String,
    pub min_value: f64,
}

/// Request to evaluate a challenger version against the promotion gate.
#[derive(Debug, Deserialize, ToSchema)]
pub struct EvaluatePromotionRequest {
    /// Agent whose champion is being challenged.
    pub agent_id: String,
    /// The live champion version id, if any (absent for the first promotion).
    #[serde(default)]
    pub champion_version_id: Option<String>,
    /// The challenger version id under evaluation.
    pub challenger_version_id: String,
    /// Metric thresholds the challenger must clear (all of them).
    pub thresholds: Vec<MetricThresholdRequest>,
    /// Whether a human approval is required on top of the thresholds.
    #[serde(default = "default_require_approval")]
    pub require_human_approval: bool,
    /// Measured metric values for the challenger, `name -> value`.
    pub metrics: std::collections::HashMap<String, f64>,
    /// Whether a human approval is present at evaluation time.
    #[serde(default)]
    pub approval_present: bool,
}

fn default_require_approval() -> bool {
    true
}

/// The promotion-gate decision returned to the caller + projected from the
/// audit row on the read path.
#[derive(Debug, Serialize, ToSchema)]
pub struct PromotionDecisionResponse {
    pub id: String,
    pub agent_id: String,
    pub champion_version_id: Option<String>,
    pub challenger_version_id: String,
    /// `allow` | `deny` | `requires_approval` | `allow_with_warning`.
    pub decision_kind: String,
    /// `shadow` | `promoted` | `denied` | `awaiting_approval`.
    pub status: String,
    pub reason: String,
    /// Per-metric evidence (name, floor, measured, passed).
    pub metric_evidence: serde_json::Value,
    pub approval_present: bool,
    pub approval_required: bool,
    /// SHA-256 over the structural fields — tamper-evidence.
    pub content_hash: String,
    /// Wall-clock UTC when the decision was recorded.
    pub decided_at: String,
    pub anchor: String,
}

impl PromotionDecisionResponse {
    fn from_decision(d: PromotionDecision, decided_at: String) -> Self {
        Self {
            id: d.id,
            agent_id: d.agent_id,
            champion_version_id: d.champion_version_id,
            challenger_version_id: d.challenger_version_id,
            decision_kind: serde_json::to_value(d.decision_kind)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_else(|| "deny".to_string()),
            status: d.status.as_str().to_string(),
            reason: d.reason,
            metric_evidence: serde_json::to_value(&d.metric_evidence)
                .unwrap_or(serde_json::Value::Null),
            approval_present: d.approval_present,
            approval_required: d.approval_required,
            content_hash: d.content_hash,
            decided_at,
            anchor: d.anchor,
        }
    }
}

/// Promotion history for an agent (newest-first).
#[derive(Debug, Serialize, ToSchema)]
pub struct PromotionHistoryResponse {
    pub agent_id: String,
    pub decisions: Vec<PromotionDecisionResponse>,
    pub anchor: String,
}

// =============================================================================
// Handlers
// =============================================================================

/// Evaluate a challenger against the champion-challenger promotion gate.
///
/// Deny-by-default: a challenger stays in shadow until it clears the
/// configured metric thresholds **and** the required human approval. The
/// decision + metric evidence are written to the immutable audit trail.
#[utoipa::path(
    post,
    path = "/v1/promotions/evaluate",
    tag = "promotions",
    request_body = EvaluatePromotionRequest,
    responses(
        (status = 200, description = "Promotion-gate decision", body = PromotionDecisionResponse),
        (status = 403, description = "Caller lacks access to the agent's project")
    )
)]
#[instrument(skip(state, auth, request), fields(agent_id = %request.agent_id))]
pub async fn evaluate_promotion(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(request): Json<EvaluatePromotionRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Verify the agent exists and the caller can act on its project.
    let agent = repos
        .agents()
        .get(&request.agent_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Agent", &request.agent_id))?;

    if !super::project_access_allowed(state.repos(), &auth, &agent.project_id).await? {
        warn!(
            agent_id = %request.agent_id,
            "Unauthorized promotion-evaluate attempt"
        );
        return Err(ApiError::forbidden("Access denied to this agent"));
    }

    // Build the gate config + metric tuples.
    let config = PromotionGateConfig {
        thresholds: request
            .thresholds
            .iter()
            .map(|t| MetricThreshold::new(t.name.clone(), t.min_value))
            .collect(),
        require_human_approval: request.require_human_approval,
    };
    let metrics: Vec<(String, f64)> = request
        .metrics
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();

    // Evaluate through the SHARED PolicyDecision channel (deny-by-default).
    let gate = PromotionGate;
    let decision = gate.evaluate(&config, &metrics, request.approval_present);

    let decision_id = format!("prm_{}", Ulid::new());
    let decided_at = chrono::Utc::now();
    let record = gate.decide(
        &decision_id,
        &request.agent_id,
        request.champion_version_id.clone(),
        &request.challenger_version_id,
        &config,
        &metrics,
        request.approval_present,
        &decision,
        decided_at,
    );

    // Write the decision + evidence to the immutable audit trail. The
    // `resource_id` is the agent id so the read path can filter by agent.
    let audit_event = AuditEventBuilder::new(action::PROMOTION_DECIDED, resource::PROMOTION)
        .actor(
            fd_storage::models::audit::actor::API_KEY,
            Some(auth.api_key_id.clone()),
        )
        .resource_id(&request.agent_id)
        .project(&agent.project_id)
        .details(record.to_audit_details())
        .build();
    repos.spawn_audit(audit_event);

    Ok((
        StatusCode::OK,
        Json(PromotionDecisionResponse::from_decision(
            record,
            decided_at.to_rfc3339(),
        )),
    ))
}

/// Get the promotion history for an agent (champion vs challenger, gate
/// status), newest-first. Reads the immutable audit trail filtered by
/// `action = "promotion.decided"` and `resource_id = agent_id`.
#[utoipa::path(
    get,
    path = "/v1/promotions/{agent_id}",
    tag = "promotions",
    params(("agent_id" = String, Path, description = "Agent ID")),
    responses(
        (status = 200, description = "Promotion history", body = PromotionHistoryResponse),
        (status = 404, description = "Agent not found")
    )
)]
#[instrument(skip(state, auth))]
pub async fn get_promotions(
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

    if !super::project_access_allowed(state.repos(), &auth, &agent.project_id).await? {
        warn!(agent_id = %agent_id, "Unauthorized promotion-history access attempt");
        return Err(ApiError::forbidden("Access denied to this agent"));
    }

    let events = repos
        .audit()
        .list_promotion_decisions(&agent_id, DEFAULT_PROMOTION_HISTORY_LIMIT)
        .await?;

    let mut decisions = Vec::with_capacity(events.len());
    for event in events {
        let parsed = match PromotionDecision::from_audit_details(&event.details) {
            Ok(d) => d,
            Err(err) => {
                warn!(
                    audit_event_id = %event.id,
                    error = %err,
                    "Skipping malformed promotion-decision audit row"
                );
                continue;
            }
        };
        let decided_at = event.occurred_at.to_rfc3339();
        decisions.push(PromotionDecisionResponse::from_decision(parsed, decided_at));
    }

    Ok(Json(PromotionHistoryResponse {
        agent_id,
        decisions,
        anchor: fd_policy::promotion::PROMOTION_ANCHOR.to_string(),
    }))
}
