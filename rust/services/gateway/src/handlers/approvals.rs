//! Approval management handlers

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Extension, Json,
};
use chrono::Utc;
use fd_storage::{
    models::{
        action, actor, resource, ApprovalStatus, AuditEventBuilder, ResolveApproval, RunStatus,
        StepStatus, UpdateStep,
    },
    queue::{JobContext, StepJob},
    QueueMessage,
};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument, warn};

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
///
/// This handler also checks for and auto-expires any approvals past their expiry time.
#[instrument(skip(state, _auth))]
pub async fn list_pending_approvals(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListApprovalsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();
    let all_pending = repos
        .policies()
        .list_all_pending_approvals(query.limit)
        .await?;

    let now = Utc::now();
    let mut valid_approvals = Vec::new();

    for approval in all_pending {
        // Check if this approval has expired
        if let Some(expires_at) = approval.expires_at {
            if now > expires_at {
                // Auto-expire this approval
                let expiry_resolution = ResolveApproval {
                    status: ApprovalStatus::Expired,
                    resolved_by: "system".to_string(),
                    resolution_note: Some("Auto-expired during list".to_string()),
                };
                if let Err(e) = repos
                    .policies()
                    .resolve_approval(&approval.id, expiry_resolution)
                    .await
                {
                    warn!(
                        approval_id = %approval.id,
                        error = %e,
                        "Failed to auto-expire approval"
                    );
                } else {
                    info!(approval_id = %approval.id, "Auto-expired stale approval");

                    // Also fail the associated run
                    let _ = repos
                        .runs()
                        .update_status(
                            &approval.run_id,
                            RunStatus::Failed,
                            Some("Approval expired"),
                        )
                        .await;
                }
                // Don't include expired approvals in the response
                continue;
            }
        }
        valid_approvals.push(approval_to_response(approval));
    }

    Ok(Json(valid_approvals))
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

    // Check if expired
    if let Some(expires_at) = approval.expires_at {
        if Utc::now() > expires_at {
            // Auto-expire the approval
            let expiry_resolution = ResolveApproval {
                status: ApprovalStatus::Expired,
                resolved_by: "system".to_string(),
                resolution_note: Some("Approval expired".to_string()),
            };
            let _ = repos
                .policies()
                .resolve_approval(&approval_id, expiry_resolution)
                .await;

            return Err(ApiError::bad_request("Approval has expired"));
        }
    }

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
        resolution_note: request.note.clone(),
    };

    let updated = repos
        .policies()
        .resolve_approval(&approval_id, resolution)
        .await?
        .ok_or_else(|| ApiError::internal("Failed to resolve approval"))?;

    // Audit log the approval decision
    let audit_action = if request.approved {
        action::APPROVAL_APPROVED
    } else {
        action::APPROVAL_REJECTED
    };
    let audit_event = AuditEventBuilder::new(audit_action, resource::APPROVAL)
        .actor(actor::API_KEY, Some(auth.api_key_id.clone()))
        .resource_id(&approval_id)
        .tenant(auth.tenant_id.clone())
        .run(&approval.run_id)
        .details(serde_json::json!({
            "step_id": approval.step_id,
            "action_type": approval.action_type,
            "note": request.note,
        }))
        .build();

    if let Err(e) = repos.audit().create(audit_event).await {
        warn!(error = %e, "Failed to log approval audit event");
    }

    // Update the step status based on the decision
    if request.approved {
        // Get the step details for re-enqueueing
        let step = repos
            .steps()
            .get(&approval.step_id)
            .await?
            .ok_or_else(|| ApiError::internal("Step not found for approved request"))?;

        // Get the run details for context
        let run = repos
            .runs()
            .get(&approval.run_id)
            .await?
            .ok_or_else(|| ApiError::internal("Run not found for approved request"))?;

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
        let step_type = format!("{:?}", step.step_type).to_lowercase();
        let job = StepJob {
            run_id: approval.run_id.clone(),
            step_id: approval.step_id.clone(),
            step_type,
            input: step.input,
            context: JobContext {
                tenant_id: auth.tenant_id.clone(),
                project_id: run.project_id,
                trace_id: run.trace_id,
                span_id: run.span_id,
            },
        };

        let message = QueueMessage::new(&approval.step_id, job);
        match state.enqueue_step(&message).await {
            Ok(stream_id) => {
                info!(
                    step_id = %approval.step_id,
                    stream_id = %stream_id,
                    "Re-enqueued approved step for processing"
                );
            }
            Err(e) => {
                warn!(
                    step_id = %approval.step_id,
                    error = %e,
                    "Failed to re-enqueue approved step"
                );
                return Err(ApiError::internal(format!(
                    "Failed to re-enqueue step: {}",
                    e
                )));
            }
        }
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
