//! Approval management handlers

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Extension, Json,
};
use chrono::Utc;
use fd_storage::models::{ApprovalStatus, ResolveApproval, RunStatus, StepStatus, UpdateStep};
use serde::{Deserialize, Serialize};
use tracing::instrument;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

// =============================================================================
// Request/Response DTOs
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct ListApprovalsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
}

fn default_limit() -> i64 {
    50
}

#[derive(Debug, Serialize)]
pub struct ApprovalResponse {
    pub id: String,
    pub run_id: String,
    pub step_id: String,
    pub action_type: String,
    pub action_details: serde_json::Value,
    pub reason: String,
    pub status: String,
    pub created_at: String,
    pub expires_at: Option<String>,
    pub resolved_by: Option<String>,
    pub resolved_at: Option<String>,
    pub resolution_note: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ResolveApprovalRequest {
    pub approved: bool,
    pub note: Option<String>,
}

// =============================================================================
// Helpers
// =============================================================================

fn approval_to_response(approval: fd_storage::models::ApprovalRequest) -> ApprovalResponse {
    ApprovalResponse {
        id: approval.id,
        run_id: approval.run_id,
        step_id: approval.step_id,
        action_type: approval.action_type,
        action_details: approval.action_details,
        reason: approval.reason,
        status: format!("{:?}", approval.status).to_lowercase(),
        created_at: approval.created_at.to_rfc3339(),
        expires_at: approval.expires_at.map(|t| t.to_rfc3339()),
        resolved_by: approval.resolved_by,
        resolved_at: approval.resolved_at.map(|t| t.to_rfc3339()),
        resolution_note: approval.resolution_note,
    }
}

// =============================================================================
// Handlers
// =============================================================================

/// List pending approval requests
#[instrument(skip(state, _auth))]
pub async fn list_pending_approvals(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListApprovalsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let approvals = state
        .repos()
        .policies()
        .list_all_pending_approvals(query.limit)
        .await?;

    let approvals: Vec<ApprovalResponse> = approvals.into_iter().map(approval_to_response).collect();

    Ok(Json(approvals))
}

/// Resolve an approval request (approve or reject)
#[instrument(skip(state, auth))]
pub async fn resolve_approval(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(approval_id): Path<String>,
    Json(request): Json<ResolveApprovalRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Get the approval
    let approval = repos
        .policies()
        .get_approval(&approval_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Approval", &approval_id))?;

    // Check if already resolved
    if approval.status != ApprovalStatus::Pending {
        return Err(ApiError::bad_request(format!(
            "Approval is already resolved: {:?}",
            approval.status
        )));
    }

    // Resolve the approval
    let status = if request.approved {
        ApprovalStatus::Approved
    } else {
        ApprovalStatus::Rejected
    };

    let resolution = ResolveApproval {
        status,
        resolved_by: auth.api_key_id.clone(),
        resolution_note: request.note,
    };

    let updated = repos
        .policies()
        .resolve_approval(&approval_id, resolution)
        .await?
        .ok_or_else(|| ApiError::internal("Failed to resolve approval"))?;

    // Update the step status based on the decision
    if request.approved {
        // Mark step as running (will be re-processed)
        repos
            .steps()
            .update(
                &approval.step_id,
                UpdateStep {
                    status: Some(StepStatus::Running),
                    ..Default::default()
                },
            )
            .await?;

        // Update run status back to running
        repos
            .runs()
            .update_status(&approval.run_id, RunStatus::Running, None)
            .await?;

        // Re-enqueue the step for processing
        // TODO: Re-enqueue step job
    } else {
        // Mark step as failed
        repos
            .steps()
            .update(
                &approval.step_id,
                UpdateStep {
                    status: Some(StepStatus::Failed),
                    error: Some(serde_json::json!({
                        "message": "Approval rejected",
                        "rejected_by": auth.api_key_id,
                    })),
                    completed_at: Some(Utc::now()),
                    ..Default::default()
                },
            )
            .await?;

        // Mark run as failed
        repos
            .runs()
            .update_status(
                &approval.run_id,
                RunStatus::Failed,
                Some("Approval rejected"),
            )
            .await?;
    }

    Ok(Json(approval_to_response(updated)))
}
