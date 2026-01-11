//! Run management handlers

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::Utc;
use fd_otel::genai::pricing;
use fd_policy::budget::BudgetUsage;
use fd_storage::{
    models::{
        action, actor, resource, AuditEventBuilder, CreateRun, CreateStep, RunStatus, StepStatus,
        StepType, UpdateRun, UpdateStep,
    },
    queue::{JobContext, StepJob},
    QueueMessage,
};
use serde::{Deserialize, Serialize};
use tracing::{info, instrument, warn};
use ulid::Ulid;
use utoipa::{IntoParams, ToSchema};
use validator::Validate;

use crate::handlers::{ApiError, ValidatedJson, ValidatedQuery};
use crate::middleware::AuthContext;
use crate::state::AppState;

// =============================================================================
// Request/Response DTOs
// =============================================================================

/// Request to create a new agent run
#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct CreateRunRequest {
    /// ID of the agent to run
    #[validate(length(min = 1, max = 255, message = "agent_id must be 1-255 characters"))]
    #[schema(example = "agt_01HGXK...")]
    pub agent_id: String,
    /// Optional specific agent version (uses latest if not specified)
    #[serde(default)]
    #[validate(length(max = 255, message = "agent_version must be at most 255 characters"))]
    pub agent_version: Option<String>,
    /// Input data for the agent (task, messages, etc.)
    pub input: serde_json::Value,
    /// Optional run configuration overrides
    #[serde(default)]
    pub config: serde_json::Value,
}

/// Agent run response
#[derive(Debug, Serialize, ToSchema)]
pub struct RunResponse {
    /// Unique run ID (prefixed with run_)
    #[schema(example = "run_01HGXK...")]
    pub id: String,
    /// Project this run belongs to
    pub project_id: String,
    /// Agent version used for this run
    pub agent_version_id: String,
    /// Current run status
    #[schema(example = "running")]
    pub status: String,
    /// Input provided to the agent
    pub input: serde_json::Value,
    /// Output from the agent (if completed)
    pub output: Option<serde_json::Value>,
    /// Total input tokens consumed
    pub input_tokens: i32,
    /// Total output tokens generated
    pub output_tokens: i32,
    /// Number of tool calls made
    pub tool_calls: i32,
    /// Total cost in cents
    pub cost_cents: i32,
    /// When the run was created
    pub created_at: String,
    /// When execution started
    pub started_at: Option<String>,
    /// When execution completed
    pub completed_at: Option<String>,
}

/// Query parameters for listing runs
#[derive(Debug, Deserialize, Validate, IntoParams)]
pub struct ListRunsQuery {
    /// Maximum number of runs to return (1-100)
    #[serde(default = "default_limit")]
    #[validate(range(min = 1, max = 100, message = "limit must be between 1 and 100"))]
    #[param(default = 20, minimum = 1, maximum = 100)]
    pub limit: i64,
    /// Number of runs to skip for pagination
    #[serde(default)]
    #[validate(range(min = 0, message = "offset must be non-negative"))]
    #[param(default = 0, minimum = 0)]
    pub offset: i64,
    /// Filter by project ID (required)
    #[validate(length(min = 1, max = 255, message = "project_id must be 1-255 characters"))]
    pub project_id: Option<String>,
}

fn default_limit() -> i64 {
    20
}

/// Paginated list of runs
#[derive(Debug, Serialize, ToSchema)]
pub struct ListRunsResponse {
    /// List of runs
    pub runs: Vec<RunResponse>,
    /// Total count of matching runs
    pub total: i64,
}

/// Execution step within a run
#[derive(Debug, Serialize, ToSchema)]
pub struct StepResponse {
    /// Unique step ID (prefixed with stp_)
    #[schema(example = "stp_01HGXK...")]
    pub id: String,
    /// Parent run ID
    pub run_id: String,
    /// Step sequence number
    pub step_number: i32,
    /// Type of step (llm, tool, etc.)
    #[schema(example = "llm")]
    pub step_type: String,
    /// Current step status
    #[schema(example = "completed")]
    pub status: String,
    /// Input to this step
    pub input: serde_json::Value,
    /// Output from this step
    pub output: Option<serde_json::Value>,
    /// Error details if failed
    pub error: Option<serde_json::Value>,
    /// Tool name if tool step
    pub tool_name: Option<String>,
    /// Model used if LLM step
    pub model: Option<String>,
    /// Input tokens consumed
    pub input_tokens: Option<i32>,
    /// Output tokens generated
    pub output_tokens: Option<i32>,
    /// When step was created
    pub created_at: String,
    /// When step completed
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize, Validate)]
pub struct SubmitStepResultRequest {
    #[validate(custom(function = "validate_step_status"))]
    pub status: String,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    #[validate(range(min = 0, message = "input_tokens must be non-negative"))]
    pub input_tokens: Option<i32>,
    #[validate(range(min = 0, message = "output_tokens must be non-negative"))]
    pub output_tokens: Option<i32>,
}

/// Custom validator for step status
fn validate_step_status(status: &str) -> Result<(), validator::ValidationError> {
    match status {
        "completed" | "failed" | "waiting_approval" => Ok(()),
        _ => {
            let mut err = validator::ValidationError::new("invalid_status");
            err.message = Some("status must be one of: completed, failed, waiting_approval".into());
            Err(err)
        }
    }
}

// =============================================================================
// Helpers
// =============================================================================

fn run_to_response(run: fd_storage::models::Run) -> RunResponse {
    RunResponse {
        id: run.id,
        project_id: run.project_id,
        agent_version_id: run.agent_version_id,
        status: format!("{:?}", run.status).to_lowercase(),
        input: run.input,
        output: run.output,
        input_tokens: run.input_tokens,
        output_tokens: run.output_tokens,
        tool_calls: run.tool_calls,
        cost_cents: run.cost_cents,
        created_at: run.created_at.to_rfc3339(),
        started_at: run.started_at.map(|t| t.to_rfc3339()),
        completed_at: run.completed_at.map(|t| t.to_rfc3339()),
    }
}

fn step_to_response(step: fd_storage::models::Step) -> StepResponse {
    StepResponse {
        id: step.id,
        run_id: step.run_id,
        step_number: step.step_number,
        step_type: format!("{:?}", step.step_type).to_lowercase(),
        status: format!("{:?}", step.status).to_lowercase(),
        input: step.input,
        output: step.output,
        error: step.error,
        tool_name: step.tool_name,
        model: step.model,
        input_tokens: step.input_tokens,
        output_tokens: step.output_tokens,
        created_at: step.created_at.to_rfc3339(),
        completed_at: step.completed_at.map(|t| t.to_rfc3339()),
    }
}

// =============================================================================
// Handlers
// =============================================================================

/// Create a new run
#[utoipa::path(
    post,
    path = "/v1/runs",
    tag = "runs",
    request_body = CreateRunRequest,
    responses(
        (status = 201, description = "Run created and queued", body = RunResponse),
        (status = 400, description = "Invalid request"),
        (status = 404, description = "Agent not found"),
    )
)]
#[instrument(skip(state, auth), fields(run_id, agent_id = %request.agent_id))]
pub async fn create_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    ValidatedJson(request): ValidatedJson<CreateRunRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Get the agent by ID, falling back to slug lookup
    let agent = match repos.agents().get(&request.agent_id).await? {
        Some(agent) => agent,
        None => {
            // Try looking up by slug if not found by ID
            repos
                .agents()
                .find_by_slug(&request.agent_id)
                .await?
                .ok_or_else(|| ApiError::not_found("Agent", &request.agent_id))?
        }
    };

    // Get agent version (latest or specific)
    let agent_version = match &request.agent_version {
        Some(version_id) => repos
            .agents()
            .get_version(version_id)
            .await?
            .ok_or_else(|| ApiError::not_found("AgentVersion", version_id))?,
        None => repos
            .agents()
            .get_latest_version(&agent.id)
            .await?
            .ok_or_else(|| ApiError::bad_request("Agent has no versions"))?,
    };

    // Check initial budget (ensure we're starting with empty budget)
    let initial_usage = BudgetUsage::default();
    let budget_decision = state.policy_engine.check_budget(&initial_usage, None);
    if budget_decision.is_denied() {
        warn!(reason = %budget_decision.reason, "Initial budget check failed");
        return Err(ApiError::budget_exceeded(&budget_decision.reason));
    }

    // Create the run
    let run_id = format!("run_{}", Ulid::new());
    tracing::Span::current().record("run_id", &run_id);

    let create_run = CreateRun {
        id: run_id.clone(),
        project_id: agent.project_id.clone(),
        agent_version_id: agent_version.id.clone(),
        input: request.input.clone(),
        config: request.config,
        trace_id: None,
        span_id: None,
    };

    let run = repos.runs().create(create_run).await?;

    // Audit: Run created
    let audit_event = AuditEventBuilder::new(action::RUN_CREATED, resource::RUN)
        .actor(actor::API_KEY, Some(auth.api_key_id.clone()))
        .resource_id(&run_id)
        .tenant(auth.tenant_id.clone())
        .project(&agent.project_id)
        .run(&run_id)
        .details(serde_json::json!({
            "agent_id": request.agent_id,
            "agent_version_id": agent_version.id,
        }))
        .build();
    // Spawn audit write in background to reduce latency
    repos.spawn_audit(audit_event);

    // Create the initial LLM step
    let step_id = format!("stp_{}", Ulid::new());
    let user_input = request.input.clone(); // Clone for later use in job
    let create_step = CreateStep {
        id: step_id.clone(),
        run_id: run_id.clone(),
        parent_step_id: None,
        step_number: 1,
        step_type: StepType::Llm,
        input: request.input,
        tool_name: None,
        tool_version: None,
        model: Some(agent_version.model.clone()),
        span_id: None,
    };

    repos.steps().create(create_step).await?;

    // Update run status to queued
    repos
        .runs()
        .update_status(&run_id, RunStatus::Queued, None)
        .await?;

    // Enqueue the step for processing
    // Merge user input (task, etc.) with agent version settings
    let mut job_input = serde_json::json!({
        "system_prompt": agent_version.system_prompt,
        "model": agent_version.model,
        "model_params": agent_version.model_params,
        "allowed_tools": agent_version.allowed_tools,
    });

    // Add user input fields (task, messages, etc.)
    if let serde_json::Value::Object(input_obj) = user_input {
        if let serde_json::Value::Object(ref mut job_obj) = job_input {
            for (key, value) in input_obj {
                job_obj.insert(key, value);
            }
        }
    }

    let job = StepJob {
        run_id: run_id.clone(),
        step_id: step_id.clone(),
        step_type: "llm".to_string(),
        input: job_input,
        context: JobContext {
            tenant_id: auth.tenant_id,
            project_id: agent.project_id,
            trace_id: None,
            span_id: None,
        },
    };

    let message = QueueMessage::new(&step_id, job);
    state.enqueue_step(&message).await?;

    info!(run_id = %run_id, "Run created and queued");

    Ok((StatusCode::CREATED, Json(run_to_response(run))))
}

/// Get a run by ID
#[utoipa::path(
    get,
    path = "/v1/runs/{run_id}",
    tag = "runs",
    params(("run_id" = String, Path, description = "Run ID")),
    responses(
        (status = 200, description = "Run details", body = RunResponse),
        (status = 404, description = "Run not found"),
    )
)]
#[instrument(skip(state, _auth))]
pub async fn get_run(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let run = state
        .repos()
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    Ok(Json(run_to_response(run)))
}

/// List runs
#[utoipa::path(
    get,
    path = "/v1/runs",
    tag = "runs",
    params(ListRunsQuery),
    responses(
        (status = 200, description = "List of runs", body = ListRunsResponse),
        (status = 400, description = "Invalid query parameters"),
    )
)]
#[instrument(skip(state, _auth))]
pub async fn list_runs(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    ValidatedQuery(query): ValidatedQuery<ListRunsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let project_id = query
        .project_id
        .as_ref()
        .ok_or_else(|| ApiError::bad_request("project_id is required"))?;

    let repos = state.repos();
    let runs = repos
        .runs()
        .list_by_project(project_id, query.limit, query.offset)
        .await?;
    let total = repos.runs().count_by_project(project_id).await?;

    let runs: Vec<RunResponse> = runs.into_iter().map(run_to_response).collect();

    Ok(Json(ListRunsResponse { runs, total }))
}

/// Cancel a run
#[utoipa::path(
    post,
    path = "/v1/runs/{run_id}/cancel",
    tag = "runs",
    params(("run_id" = String, Path, description = "Run ID to cancel")),
    responses(
        (status = 200, description = "Run cancelled", body = RunResponse),
        (status = 400, description = "Run already in terminal state"),
        (status = 404, description = "Run not found"),
    )
)]
#[instrument(skip(state, auth), fields(run_id = %run_id))]
pub async fn cancel_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let run = repos
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    if run.status.is_terminal() {
        return Err(ApiError::bad_request(format!(
            "Run is already in terminal state: {:?}",
            run.status
        )));
    }

    let updated = repos
        .runs()
        .update(
            &run_id,
            UpdateRun {
                status: Some(RunStatus::Cancelled),
                status_reason: Some("Cancelled by user".to_string()),
                completed_at: Some(Utc::now()),
                ..Default::default()
            },
        )
        .await?
        .ok_or_else(|| ApiError::internal("Failed to update run"))?;

    // Audit: Run cancelled
    let audit_event = AuditEventBuilder::new(action::RUN_CANCELLED, resource::RUN)
        .actor(actor::API_KEY, Some(auth.api_key_id.clone()))
        .resource_id(&run_id)
        .tenant(auth.tenant_id)
        .project(&run.project_id)
        .run(&run_id)
        .details(serde_json::json!({
            "previous_status": format!("{:?}", run.status),
        }))
        .build();
    repos.spawn_audit(audit_event);

    info!(run_id = %run_id, "Run cancelled by user");

    Ok(Json(run_to_response(updated)))
}

/// List steps for a run
#[utoipa::path(
    get,
    path = "/v1/runs/{run_id}/steps",
    tag = "runs",
    params(
        ("run_id" = String, Path, description = "Run ID")
    ),
    responses(
        (status = 200, description = "List of steps for the run", body = Vec<StepResponse>),
        (status = 404, description = "Run not found")
    )
)]
#[instrument(skip(state, _auth))]
pub async fn list_steps(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    state
        .repos()
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    let steps = state.repos().steps().list_by_run(&run_id).await?;

    let steps: Vec<StepResponse> = steps.into_iter().map(step_to_response).collect();

    Ok(Json(steps))
}

/// Submit step result (from worker)
#[instrument(skip(state, _auth), fields(run_id = %run_id, step_id = %step_id))]
pub async fn submit_step_result(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path((run_id, step_id)): Path<(String, String)>,
    ValidatedJson(request): ValidatedJson<SubmitStepResultRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let run = repos
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    let step = repos
        .steps()
        .get(&step_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Step", &step_id))?;

    if step.run_id != run_id {
        return Err(ApiError::bad_request("Step does not belong to this run"));
    }

    let status = match request.status.as_str() {
        "completed" => StepStatus::Completed,
        "failed" => StepStatus::Failed,
        "waiting_approval" => StepStatus::WaitingApproval,
        _ => return Err(ApiError::bad_request("Invalid status")),
    };

    let update = UpdateStep {
        status: Some(status),
        output: request.output.clone(),
        error: request.error.clone(),
        input_tokens: request.input_tokens,
        output_tokens: request.output_tokens,
        completed_at: Some(Utc::now()),
        ..Default::default()
    };

    let updated_step = repos
        .steps()
        .update(&step_id, update)
        .await?
        .ok_or_else(|| ApiError::internal("Failed to update step"))?;

    // Update token usage and calculate cost
    let (new_input_tokens, new_output_tokens, step_cost_cents) =
        match (request.input_tokens, request.output_tokens) {
            (Some(in_tokens), Some(out_tokens)) => {
                // Calculate cost based on model (from step)
                let model = step.model.as_deref().unwrap_or("gpt-4o");
                let cost =
                    pricing::calculate_cost_cents(model, in_tokens as u64, out_tokens as u64);

                // Update run with tokens and cost
                repos
                    .runs()
                    .increment_usage(&run_id, in_tokens, out_tokens, 0, cost as i32)
                    .await?;
                (in_tokens, out_tokens, cost)
            }
            _ => (0, 0, 0),
        };

    // Audit: Step completed/failed
    let audit_action = match status {
        StepStatus::Completed => action::STEP_COMPLETED,
        StepStatus::Failed => action::STEP_FAILED,
        _ => action::STEP_STARTED, // For WaitingApproval, use a neutral action
    };
    let audit_event = AuditEventBuilder::new(audit_action, resource::STEP)
        .actor(actor::SYSTEM, None)
        .resource_id(&step_id)
        .run(&run_id)
        .project(&run.project_id)
        .details(serde_json::json!({
            "step_type": format!("{:?}", step.step_type),
            "tool_name": step.tool_name,
            "model": step.model,
            "input_tokens": new_input_tokens,
            "output_tokens": new_output_tokens,
            "cost_cents": step_cost_cents,
        }))
        .build();
    repos.spawn_audit(audit_event);

    // Check budget after step completion
    let updated_run = repos.runs().get(&run_id).await?.unwrap();

    // Calculate wall time from run creation to now
    let wall_time_ms = Utc::now()
        .signed_duration_since(updated_run.created_at)
        .num_milliseconds()
        .max(0) as u64;

    let usage = BudgetUsage {
        input_tokens: updated_run.input_tokens as u64,
        output_tokens: updated_run.output_tokens as u64,
        tool_calls: updated_run.tool_calls as u32,
        wall_time_ms,
        cost_cents: updated_run.cost_cents as u64,
    };

    let budget_decision = state.policy_engine.check_budget(&usage, None);

    if budget_decision.is_denied() {
        warn!(
            run_id = %run_id,
            reason = %budget_decision.reason,
            "Budget exceeded, killing run"
        );

        // Audit: Budget exceeded
        let audit_event = AuditEventBuilder::new("budget.exceeded", resource::RUN)
            .actor(actor::SYSTEM, None)
            .resource_id(&run_id)
            .run(&run_id)
            .project(&run.project_id)
            .details(serde_json::json!({
                "reason": budget_decision.reason,
                "usage": usage,
            }))
            .build();
        repos.spawn_audit(audit_event);

        repos
            .runs()
            .update(
                &run_id,
                UpdateRun {
                    status: Some(RunStatus::BudgetKilled),
                    status_reason: Some(budget_decision.reason.clone()),
                    completed_at: Some(Utc::now()),
                    ..Default::default()
                },
            )
            .await?;

        // Return the step result, but the run is now killed
        return Ok(Json(step_to_response(updated_step)));
    }

    // Check if run is complete
    let pending_steps = repos.steps().get_pending_steps(&run_id).await?;

    if pending_steps.is_empty() && status == StepStatus::Completed {
        repos
            .runs()
            .update(
                &run_id,
                UpdateRun {
                    status: Some(RunStatus::Completed),
                    completed_at: Some(Utc::now()),
                    output: updated_step.output.clone(),
                    ..Default::default()
                },
            )
            .await?;

        // Audit: Run completed
        let audit_event = AuditEventBuilder::new(action::RUN_COMPLETED, resource::RUN)
            .actor(actor::SYSTEM, None)
            .resource_id(&run_id)
            .run(&run_id)
            .project(&run.project_id)
            .details(serde_json::json!({
                "input_tokens": updated_run.input_tokens,
                "output_tokens": updated_run.output_tokens,
                "tool_calls": updated_run.tool_calls,
                "cost_cents": updated_run.cost_cents,
            }))
            .build();
        repos.spawn_audit(audit_event);

        info!(run_id = %run_id, "Run completed successfully");
    } else if status == StepStatus::Failed {
        repos
            .runs()
            .update(
                &run_id,
                UpdateRun {
                    status: Some(RunStatus::Failed),
                    status_reason: Some("Step failed".to_string()),
                    completed_at: Some(Utc::now()),
                    error: updated_step.error.clone(),
                    ..Default::default()
                },
            )
            .await?;

        // Audit: Run failed
        let audit_event = AuditEventBuilder::new(action::RUN_FAILED, resource::RUN)
            .actor(actor::SYSTEM, None)
            .resource_id(&run_id)
            .run(&run_id)
            .project(&run.project_id)
            .details(serde_json::json!({
                "step_id": step_id,
                "error": updated_step.error,
            }))
            .build();
        repos.spawn_audit(audit_event);

        warn!(run_id = %run_id, step_id = %step_id, "Run failed due to step failure");
    } else if status == StepStatus::WaitingApproval {
        repos
            .runs()
            .update_status(&run_id, RunStatus::WaitingApproval, None)
            .await?;

        info!(run_id = %run_id, step_id = %step_id, "Run waiting for approval");
    }

    Ok(Json(step_to_response(updated_step)))
}

// =============================================================================
// Tool Policy Check
// =============================================================================

#[derive(Debug, Deserialize, Validate, ToSchema)]
pub struct CheckToolRequest {
    /// Tool name being called
    #[validate(length(min = 1, max = 255, message = "tool_name must be 1-255 characters"))]
    pub tool_name: String,

    /// Tool input payload for Airlock inspection
    #[serde(default)]
    pub tool_input: Option<serde_json::Value>,

    /// Estimated cost in cents for this tool call (for velocity tracking)
    #[serde(default)]
    pub estimated_cost_cents: Option<u64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CheckToolResponse {
    /// Whether the tool call is allowed
    pub allowed: bool,
    /// Whether approval is required before execution
    pub requires_approval: bool,
    /// Unique decision ID for audit trail
    pub decision_id: String,
    /// Human-readable reason for the decision
    pub reason: String,

    // Airlock security fields
    /// Risk score from Airlock inspection (0-100)
    #[serde(default)]
    pub risk_score: u8,
    /// Risk level: low, medium, high, critical
    #[serde(default)]
    pub risk_level: String,
    /// Type of violation detected (if any)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub violation_type: Option<String>,
    /// Details about the violation
    #[serde(skip_serializing_if = "Option::is_none")]
    pub violation_details: Option<String>,
    /// Whether blocked by Airlock (vs policy)
    #[serde(default)]
    pub blocked_by_airlock: bool,
    /// Whether Airlock is in shadow mode (log-only)
    #[serde(default)]
    pub shadow_mode: bool,
}

/// Check if a tool call is allowed by policy and Airlock security inspection
/// Workers should call this before executing tool steps
#[instrument(skip(state, auth), fields(run_id = %run_id, tool_name = %request.tool_name))]
pub async fn check_tool_policy(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
    ValidatedJson(request): ValidatedJson<CheckToolRequest>,
) -> Result<impl IntoResponse, ApiError> {
    use fd_core::RunId;
    use fd_policy::InspectionContext;
    use fd_storage::models::{CreateThreat, CreateVelocityEvent};
    use sha2::{Digest, Sha256};

    let repos = state.repos();

    let run = repos
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    // Step 1: Check tool against policy allowlist
    let decision = state.policy_engine.evaluate_tool_call(&request.tool_name);

    // Step 2: Run Airlock inspection on the tool input payload
    let tool_input = request.tool_input.clone().unwrap_or(serde_json::json!({}));
    let parsed_run_id = RunId::parse(&run_id).unwrap_or_else(|_| RunId::new());
    let inspection_ctx = InspectionContext {
        run_id: parsed_run_id,
        tool_name: request.tool_name.clone(),
        tool_input: tool_input.clone(),
        estimated_cost_cents: request.estimated_cost_cents,
    };

    let airlock_result = state.airlock.inspect(&inspection_ctx).await;

    // Step 3: Persist threat if detected
    if let Some(ref violation) = airlock_result.violation {
        let threat_id = format!("thr_{}", Ulid::new());

        let create_threat = CreateThreat {
            id: threat_id.clone(),
            run_id: run_id.clone(),
            step_id: None, // We don't have step_id at this point
            tool_name: request.tool_name.clone(),
            risk_score: violation.risk_score as i32,
            risk_level: violation.risk_level.as_str().to_string(),
            violation_type: format!("{:?}", violation.violation_type).to_lowercase(),
            violation_details: Some(violation.details.clone()),
            blocked_payload: Some(tool_input.clone()),
            trigger_pattern: Some(violation.trigger.clone()),
            action: if airlock_result.allowed {
                "logged".to_string()
            } else {
                "blocked".to_string()
            },
            shadow_mode: airlock_result.shadow_mode,
            project_id: Some(run.project_id.clone()),
            tenant_id: Some(auth.tenant_id.clone()),
        };

        // Spawn threat persistence in background
        let threats_repo = repos.threats();
        tokio::spawn(async move {
            if let Err(e) = threats_repo.create(create_threat).await {
                tracing::warn!(error = %e, "Failed to persist threat record");
            }
        });

        // Audit the Airlock violation
        let audit_event = AuditEventBuilder::new("airlock.violation_detected", resource::RUN)
            .actor(actor::SYSTEM, None)
            .resource_id(&run_id)
            .run(&run_id)
            .project(&run.project_id)
            .tenant(auth.tenant_id.clone())
            .details(serde_json::json!({
                "tool_name": request.tool_name,
                "violation_type": format!("{:?}", violation.violation_type),
                "risk_score": violation.risk_score,
                "risk_level": violation.risk_level.as_str(),
                "trigger": violation.trigger,
                "shadow_mode": airlock_result.shadow_mode,
                "blocked": !airlock_result.allowed,
            }))
            .build();
        repos.spawn_audit(audit_event);

        warn!(
            run_id = %run_id,
            tool_name = %request.tool_name,
            violation_type = ?violation.violation_type,
            risk_score = violation.risk_score,
            shadow_mode = airlock_result.shadow_mode,
            "Airlock violation detected"
        );
    }

    // Step 4: Record velocity event for successful calls
    if airlock_result.allowed && airlock_result.violation.is_none() {
        if let Some(cost) = request.estimated_cost_cents {
            // Use SHA256 for input hashing
            let mut hasher = Sha256::new();
            hasher.update(tool_input.to_string().as_bytes());
            let input_hash = format!("{:x}", hasher.finalize());

            let velocity_event = CreateVelocityEvent {
                run_id: run_id.clone(),
                tool_name: request.tool_name.clone(),
                tool_input_hash: input_hash,
                cost_cents: cost as i32,
            };

            let threats_repo = repos.threats();
            tokio::spawn(async move {
                if let Err(e) = threats_repo.create_velocity_event(velocity_event).await {
                    tracing::warn!(error = %e, "Failed to record velocity event");
                }
            });
        }
    }

    // Step 5: Audit the policy decision
    let audit_action = if decision.is_allowed() {
        action::POLICY_ALLOWED
    } else if decision.needs_approval() {
        action::POLICY_APPROVAL_REQUIRED
    } else {
        action::POLICY_DENIED
    };

    let audit_event = AuditEventBuilder::new(audit_action, resource::RUN)
        .actor(actor::SYSTEM, None)
        .resource_id(&run_id)
        .run(&run_id)
        .project(&run.project_id)
        .details(serde_json::json!({
            "tool_name": request.tool_name,
            "decision": format!("{:?}", decision.kind),
            "reason": decision.reason,
            "airlock_risk_score": airlock_result.risk_score,
            "airlock_blocked": !airlock_result.allowed,
        }))
        .build();
    repos.spawn_audit(audit_event);

    // Step 6: Determine final allowed status
    // Tool is allowed if: policy allows AND (airlock allows OR airlock is in shadow mode)
    let policy_allowed = decision.is_allowed();
    let airlock_blocked = !airlock_result.allowed;
    let final_allowed = policy_allowed && !airlock_blocked;

    // Step 7: If blocked by either policy or airlock, update run status
    if !final_allowed {
        let (status, reason) = if !policy_allowed {
            (RunStatus::PolicyBlocked, decision.reason.clone())
        } else {
            let violation_msg = airlock_result
                .violation
                .as_ref()
                .map(|v| v.details.clone())
                .unwrap_or_else(|| "Airlock security violation".to_string());
            (RunStatus::PolicyBlocked, violation_msg)
        };

        warn!(
            run_id = %run_id,
            tool_name = %request.tool_name,
            reason = %reason,
            "Tool call blocked"
        );

        repos
            .runs()
            .update(
                &run_id,
                UpdateRun {
                    status: Some(status),
                    status_reason: Some(reason.clone()),
                    completed_at: Some(Utc::now()),
                    ..Default::default()
                },
            )
            .await?;
    }

    // Step 8: Build response with both policy and Airlock information
    let violation_type = airlock_result
        .violation
        .as_ref()
        .map(|v| format!("{:?}", v.violation_type).to_lowercase());

    let violation_details = airlock_result.violation.as_ref().map(|v| v.details.clone());

    Ok(Json(CheckToolResponse {
        allowed: final_allowed,
        requires_approval: decision.needs_approval(),
        decision_id: decision.id.to_string(),
        reason: if !final_allowed && airlock_blocked {
            airlock_result
                .violation
                .as_ref()
                .map(|v| v.details.clone())
                .unwrap_or(decision.reason)
        } else {
            decision.reason
        },
        risk_score: airlock_result.risk_score,
        risk_level: airlock_result.risk_level.as_str().to_string(),
        violation_type,
        violation_details,
        blocked_by_airlock: airlock_blocked,
        shadow_mode: airlock_result.shadow_mode,
    }))
}
