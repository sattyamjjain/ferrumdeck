//! Run management handlers

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::Utc;
use fd_storage::{
    models::{CreateRun, CreateStep, RunStatus, StepStatus, StepType, UpdateRun, UpdateStep},
    queue::{JobContext, StepJob},
    QueueMessage,
};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use ulid::Ulid;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

// =============================================================================
// Request/Response DTOs
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateRunRequest {
    pub agent_id: String,
    #[serde(default)]
    pub agent_version: Option<String>,
    pub input: serde_json::Value,
    #[serde(default)]
    pub config: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct RunResponse {
    pub id: String,
    pub project_id: String,
    pub agent_version_id: String,
    pub status: String,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub tool_calls: i32,
    pub cost_cents: i32,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ListRunsQuery {
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    pub project_id: Option<String>,
}

fn default_limit() -> i64 {
    20
}

#[derive(Debug, Serialize)]
pub struct ListRunsResponse {
    pub runs: Vec<RunResponse>,
    pub total: i64,
}

#[derive(Debug, Serialize)]
pub struct StepResponse {
    pub id: String,
    pub run_id: String,
    pub step_number: i32,
    pub step_type: String,
    pub status: String,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub tool_name: Option<String>,
    pub model: Option<String>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitStepResultRequest {
    pub status: String,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
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
#[instrument(skip(state, auth))]
pub async fn create_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(request): Json<CreateRunRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Get the agent
    let agent = repos
        .agents()
        .get(&request.agent_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Agent", &request.agent_id))?;

    // Get agent version (latest or specific)
    let agent_version = match &request.agent_version {
        Some(version_id) => repos
            .agents()
            .get_version(version_id)
            .await?
            .ok_or_else(|| ApiError::not_found("AgentVersion", version_id))?,
        None => repos
            .agents()
            .get_latest_version(&request.agent_id)
            .await?
            .ok_or_else(|| ApiError::bad_request("Agent has no versions"))?,
    };

    // Create the run
    let run_id = format!("run_{}", Ulid::new());
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

    // Create the initial LLM step
    let step_id = format!("stp_{}", Ulid::new());
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
    let job = StepJob {
        run_id: run_id.clone(),
        step_id: step_id.clone(),
        step_type: "llm".to_string(),
        input: serde_json::json!({
            "system_prompt": agent_version.system_prompt,
            "model": agent_version.model,
            "model_params": agent_version.model_params,
            "allowed_tools": agent_version.allowed_tools,
        }),
        context: JobContext {
            tenant_id: auth.tenant_id,
            project_id: agent.project_id,
            trace_id: None,
            span_id: None,
        },
    };

    let message = QueueMessage::new(&step_id, job);
    state.enqueue_step(&message).await?;

    Ok((StatusCode::CREATED, Json(run_to_response(run))))
}

/// Get a run by ID
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
#[instrument(skip(state, _auth))]
pub async fn list_runs(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListRunsQuery>,
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
#[instrument(skip(state, _auth))]
pub async fn cancel_run(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
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

    Ok(Json(run_to_response(updated)))
}

/// List steps for a run
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
#[instrument(skip(state, _auth))]
pub async fn submit_step_result(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path((run_id, step_id)): Path<(String, String)>,
    Json(request): Json<SubmitStepResultRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let _run = repos
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
        output: request.output,
        error: request.error,
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

    if let (Some(in_tokens), Some(out_tokens)) = (request.input_tokens, request.output_tokens) {
        repos
            .runs()
            .increment_usage(&run_id, in_tokens, out_tokens, 0, 0)
            .await?;
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
    } else if status == StepStatus::WaitingApproval {
        repos
            .runs()
            .update_status(&run_id, RunStatus::WaitingApproval, None)
            .await?;
    }

    Ok(Json(step_to_response(updated_step)))
}
