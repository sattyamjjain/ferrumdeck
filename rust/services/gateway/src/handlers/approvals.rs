//! Approval management handlers

use axum::{
    extract::{Path, Query, State},
    response::IntoResponse,
    Extension, Json,
};
use chrono::{DateTime, Utc};
use fd_storage::{
    models::{
        action, actor, resource, ApprovalRequest, ApprovalStatus, AuditEventBuilder,
        CreateApprovalRequest, CreateAuditEvent, CreatePolicyDecision, PolicyEffect,
        ResolveApproval, RunStatus, StepStatus, UpdateStep,
    },
    queue::{JobContext, StepJob},
    QueueMessage,
};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument, warn};
use ulid::Ulid;

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

/// Wall-clock time a human took to act on an approval gate.
///
/// SAFE asks for "human approval and intervention events". An approval that
/// took 40 minutes and an approval that took 4 seconds are different facts
/// about the control: one is a human reading the request, the other is a rubber
/// stamp or an automation, and only one of them is a control that works under
/// load. Without the latency the log cannot tell them apart, so every
/// resolution event carries it — including expiries, where it measures how long
/// the gate stood open before nobody answered.
fn latency_ms(created_at: DateTime<Utc>, resolved_at: DateTime<Utc>) -> i64 {
    (resolved_at - created_at).num_milliseconds().max(0)
}

/// Build the hash-chained record for an approval gate closing, whichever way it
/// closed.
///
/// One builder for approve / reject / expire so the three cannot drift apart in
/// the fields they carry. `approver` is the identity that resolved it — an API
/// key id for a human decision, `"system"` for an expiry, which is itself the
/// distinction between "somebody decided" and "the clock decided".
#[allow(clippy::too_many_arguments)]
fn approval_resolution_event(
    approval: &ApprovalRequest,
    audit_action: &str,
    approver_actor_type: &str,
    approver: &str,
    tenant_id: &str,
    note: Option<&str>,
    resolved_at: DateTime<Utc>,
) -> CreateAuditEvent {
    AuditEventBuilder::new(audit_action, resource::APPROVAL)
        .actor(approver_actor_type, Some(approver.to_string()))
        .resource_id(&approval.id)
        .tenant(tenant_id.to_string())
        .run(&approval.run_id)
        .details(serde_json::json!({
            "approval_id": approval.id,
            "step_id": approval.step_id,
            "action_type": approval.action_type,
            "approver": approver,
            "note": note,
            "requested_at": approval.created_at.to_rfc3339(),
            "resolved_at": resolved_at.to_rfc3339(),
            "latency_ms": latency_ms(approval.created_at, resolved_at),
            "deadline_at": approval.expires_at.map(|t| t.to_rfc3339()),
        }))
        .build()
}

/// Open a human-approval gate for a step, and record the escalation.
///
/// This is the missing half of the approval control. `create_approval` and
/// `create_decision` both existed and neither had a caller, so
/// `approval_requests` was empty in every deployment, `GET /approvals` always
/// returned `[]`, and the two resolution handlers below — which are correct and
/// carry the approver — could never be reached. `policy.approval_required` had
/// never been written. A gate nothing can open is not a control.
///
/// Creates the policy-decision row the approval's foreign key requires, then the
/// approval itself, then writes the escalation to the chain with the deadline
/// the clock will be measured against.
pub(crate) struct ApprovalGateRequest<'a> {
    pub run_id: &'a str,
    pub step_id: &'a str,
    pub project_id: &'a str,
    pub tenant_id: &'a str,
    /// Coarse category of what is being gated, e.g. `coherence_divergence`.
    pub action_type: &'a str,
    /// Human-readable why, shown to the approver and recorded on the chain.
    pub reason: &'a str,
    pub action_details: serde_json::Value,
}

pub(crate) async fn open_approval_gate(
    state: &AppState,
    req: ApprovalGateRequest<'_>,
) -> Result<String, sqlx::Error> {
    let ApprovalGateRequest {
        run_id,
        step_id,
        project_id,
        tenant_id,
        action_type,
        reason,
        action_details,
    } = req;
    let repos = state.repos();
    let requested_at = Utc::now();
    let expires_at = requested_at + chrono::Duration::seconds(state.approval_ttl_secs);

    let decision_id = format!("pdc_{}", Ulid::new());
    repos
        .policies()
        .create_decision(CreatePolicyDecision {
            id: decision_id.clone(),
            run_id: Some(run_id.to_string()),
            step_id: Some(step_id.to_string()),
            action_type: action_type.to_string(),
            action_details: action_details.clone(),
            decision: PolicyEffect::RequireApproval,
            matched_rule_id: None,
            reason: reason.to_string(),
            evaluation_time_ms: None,
        })
        .await?;

    let approval_id = format!("apr_{}", Ulid::new());
    repos
        .policies()
        .create_approval(CreateApprovalRequest {
            id: approval_id.clone(),
            run_id: run_id.to_string(),
            step_id: step_id.to_string(),
            policy_decision_id: decision_id.clone(),
            action_type: action_type.to_string(),
            action_details,
            reason: reason.to_string(),
            expires_at: Some(expires_at),
        })
        .await?;

    let audit_event = AuditEventBuilder::new(action::POLICY_APPROVAL_REQUIRED, resource::APPROVAL)
        .actor(actor::SYSTEM, None)
        .resource_id(&approval_id)
        .tenant(tenant_id.to_string())
        .run(run_id)
        .project(project_id)
        .details(serde_json::json!({
            "approval_id": approval_id,
            "policy_decision_id": decision_id,
            "step_id": step_id,
            "action_type": action_type,
            "reason": reason,
            "requested_at": requested_at.to_rfc3339(),
            "expires_at": expires_at.to_rfc3339(),
            "deadline_secs": state.approval_ttl_secs,
        }))
        .build();
    repos.spawn_audit(audit_event);

    info!(
        run_id = %run_id,
        step_id = %step_id,
        approval_id = %approval_id,
        deadline_secs = state.approval_ttl_secs,
        "Opened approval gate for human review"
    );
    Ok(approval_id)
}

// =============================================================================
// Handlers
// =============================================================================

/// List pending approval requests
///
/// This handler also checks for and auto-expires any approvals past their expiry time.
#[instrument(skip(state, auth))]
pub async fn list_pending_approvals(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
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

                    // A timeout is an intervention event: nobody acted, and the
                    // run was failed because of it. This previously resolved the
                    // row and wrote nothing, so `approval.expired` — declared
                    // since the first schema — had never once been written, and
                    // the log could not distinguish "expired" from "never
                    // happened". The approver is `system` because the clock
                    // decided, not a person.
                    repos.spawn_audit(approval_resolution_event(
                        &approval,
                        action::APPROVAL_EXPIRED,
                        actor::SYSTEM,
                        "system",
                        &auth.tenant_id,
                        Some("Auto-expired during list"),
                        now,
                    ));

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

    // SECURITY: Verify tenant owns the run associated with this approval
    let run = repos
        .runs()
        .get(&approval.run_id)
        .await?
        .ok_or_else(|| ApiError::internal("Run not found for approval"))?;

    if !super::project_access_allowed(state.repos(), &auth, &run.project_id).await? {
        tracing::warn!(
            approval_id = %approval_id,
            run_id = %approval.run_id,
            run_project = %run.project_id,
            auth_tenant = %auth.tenant_id,
            "Unauthorized approval resolution attempt from different tenant"
        );
        return Err(ApiError::forbidden(
            "Access denied to resolve this approval",
        ));
    }

    // Check if expired
    if let Some(expires_at) = approval.expires_at {
        let now = Utc::now();
        if now > expires_at {
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

            // Same omission as the list path: the row was resolved and nothing
            // was recorded. Worth noting this branch fires when a human DID
            // arrive, just too late — which is a different and more interesting
            // fact than nobody arriving, so the note distinguishes them.
            repos.spawn_audit(approval_resolution_event(
                &approval,
                action::APPROVAL_EXPIRED,
                actor::SYSTEM,
                "system",
                &auth.tenant_id,
                Some("Expired before resolution was attempted"),
                now,
            ));

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

    // Audit log the approval decision, with the wall-clock latency the human
    // took. `updated.resolved_at` is the value the database actually stored,
    // rather than a second `Utc::now()` here, so the recorded latency matches
    // the row an investigator would read next to it.
    let audit_action = if request.approved {
        action::APPROVAL_APPROVED
    } else {
        action::APPROVAL_REJECTED
    };
    repos.spawn_audit(approval_resolution_event(
        &approval,
        audit_action,
        actor::API_KEY,
        &auth.api_key_id,
        &auth.tenant_id,
        request.note.as_deref(),
        updated.resolved_at.unwrap_or_else(Utc::now),
    ));

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

#[cfg(test)]
mod tests {
    use super::*;

    fn approval(created_at: DateTime<Utc>, expires_at: Option<DateTime<Utc>>) -> ApprovalRequest {
        ApprovalRequest {
            id: "apr_test".to_string(),
            run_id: "run_test".to_string(),
            step_id: "stp_test".to_string(),
            policy_decision_id: "pdc_test".to_string(),
            action_type: "step_requires_approval".to_string(),
            action_details: serde_json::json!({}),
            reason: "needs a human".to_string(),
            status: ApprovalStatus::Pending,
            resolved_by: None,
            resolved_at: None,
            resolution_note: None,
            created_at,
            expires_at,
        }
    }

    // =========================================================================
    // APR-EVT-001: latency is wall-clock, and never negative
    // =========================================================================
    #[test]
    fn latency_is_the_wall_clock_gap() {
        let t0 = Utc::now();
        assert_eq!(
            latency_ms(t0, t0 + chrono::Duration::seconds(40 * 60)),
            2_400_000
        );
        assert_eq!(
            latency_ms(t0, t0 + chrono::Duration::milliseconds(4_000)),
            4_000
        );
    }

    #[test]
    fn clock_skew_cannot_produce_a_negative_latency() {
        let t0 = Utc::now();
        // A resolution stamped before the request (NTP step, replica clock)
        // must not emit a negative duration into the evidence record.
        assert_eq!(latency_ms(t0, t0 - chrono::Duration::seconds(5)), 0);
    }

    // =========================================================================
    // APR-EVT-002: every close of the gate carries approver + latency
    //
    // The three outcomes share one builder precisely so they cannot drift.
    // This asserts the fields SAFE asks for are on all of them -- an approval
    // that took 40 minutes and one that took 4 seconds are different facts
    // about the control, and only one of them is a control that works.
    // =========================================================================
    #[test]
    fn approve_reject_and_expire_all_carry_approver_and_latency() {
        let requested = Utc::now();
        let resolved = requested + chrono::Duration::seconds(2_400); // 40 minutes
        let a = approval(requested, Some(requested + chrono::Duration::seconds(3600)));

        for (action, actor_type, approver) in [
            (action::APPROVAL_APPROVED, actor::API_KEY, "key_1"),
            (action::APPROVAL_REJECTED, actor::API_KEY, "key_1"),
            (action::APPROVAL_EXPIRED, actor::SYSTEM, "system"),
        ] {
            let ev = approval_resolution_event(
                &a,
                action,
                actor_type,
                approver,
                "tnt_1",
                Some("note"),
                resolved,
            );
            assert_eq!(ev.action, action);
            assert_eq!(ev.actor_type, actor_type);
            assert_eq!(ev.actor_id.as_deref(), Some(approver));
            assert_eq!(ev.resource_type, resource::APPROVAL);
            assert_eq!(ev.resource_id.as_deref(), Some("apr_test"));
            assert_eq!(ev.run_id.as_deref(), Some("run_test"));

            assert_eq!(
                ev.details["latency_ms"], 2_400_000,
                "{action} lost its latency"
            );
            assert_eq!(ev.details["approver"], approver);
            assert_eq!(ev.details["approval_id"], "apr_test");
            assert_eq!(ev.details["step_id"], "stp_test");
            assert!(ev.details["requested_at"].is_string());
            assert!(ev.details["resolved_at"].is_string());
            // The deadline the clock was measured against: an expiry after a
            // 60-second window and one after a day are different facts.
            assert!(ev.details["deadline_at"].is_string());
        }
    }

    // =========================================================================
    // APR-EVT-003: a timeout is attributable to the clock, not to a person
    // =========================================================================
    #[test]
    fn an_expiry_is_recorded_as_a_system_decision() {
        let requested = Utc::now();
        let ev = approval_resolution_event(
            &approval(requested, Some(requested)),
            action::APPROVAL_EXPIRED,
            actor::SYSTEM,
            "system",
            "tnt_1",
            None,
            requested + chrono::Duration::seconds(90),
        );
        assert_eq!(ev.actor_type, actor::SYSTEM);
        assert_eq!(ev.details["approver"], "system");
        assert_eq!(ev.details["latency_ms"], 90_000);
        assert!(
            ev.details["note"].is_null(),
            "an unnoted expiry must not invent one"
        );
    }

    #[test]
    fn a_gate_with_no_deadline_records_that_honestly() {
        let requested = Utc::now();
        let ev = approval_resolution_event(
            &approval(requested, None),
            action::APPROVAL_APPROVED,
            actor::API_KEY,
            "key_1",
            "tnt_1",
            None,
            requested,
        );
        // Null, not a fabricated deadline: "no deadline" and "deadline unknown"
        // must not be presented as a concrete time.
        assert!(ev.details["deadline_at"].is_null());
    }
}
