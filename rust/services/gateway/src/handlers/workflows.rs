//! Workflow management handlers

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::Utc;
use fd_storage::models::{
    CreateWorkflow, CreateWorkflowRun, CreateWorkflowStepExecution, UpdateWorkflowRun,
    UpdateWorkflowStepExecution, WorkflowRunStatus, WorkflowStepExecutionStatus, WorkflowStepType,
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
pub struct CreateWorkflowRequest {
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub definition: serde_json::Value,
    #[serde(default = "default_max_iterations")]
    pub max_iterations: i32,
    #[serde(default = "default_on_error")]
    pub on_error: String,
}

fn default_max_iterations() -> i32 {
    10
}

fn default_on_error() -> String {
    "fail".to_string()
}

#[derive(Debug, Serialize)]
pub struct WorkflowResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub description: Option<String>,
    pub version: String,
    pub status: String,
    pub definition: serde_json::Value,
    pub max_iterations: i32,
    pub on_error: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ListWorkflowsQuery {
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
pub struct ListWorkflowsResponse {
    pub workflows: Vec<WorkflowResponse>,
}

#[derive(Debug, Deserialize)]
pub struct CreateWorkflowRunRequest {
    pub workflow_id: String,
    pub input: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub struct WorkflowRunResponse {
    pub id: String,
    pub workflow_id: String,
    pub project_id: String,
    pub status: String,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub current_step_id: Option<String>,
    pub step_results: serde_json::Value,
    pub input_tokens: i32,
    pub output_tokens: i32,
    pub tool_calls: i32,
    pub cost_cents: i32,
    pub created_at: String,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct WorkflowStepExecutionResponse {
    pub id: String,
    pub workflow_run_id: String,
    pub step_id: String,
    pub step_type: String,
    pub status: String,
    pub input: serde_json::Value,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub attempt: i32,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct SubmitStepExecutionResultRequest {
    pub status: String,
    pub output: Option<serde_json::Value>,
    pub error: Option<serde_json::Value>,
    pub input_tokens: Option<i32>,
    pub output_tokens: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CreateStepExecutionRequest {
    pub step_id: String,
    pub step_type: String,
    pub input: serde_json::Value,
    #[serde(default = "default_attempt")]
    pub attempt: i32,
}

fn default_attempt() -> i32 {
    1
}

// =============================================================================
// Helpers
// =============================================================================

fn workflow_to_response(workflow: fd_storage::models::Workflow) -> WorkflowResponse {
    WorkflowResponse {
        id: workflow.id,
        project_id: workflow.project_id,
        name: workflow.name,
        description: workflow.description,
        version: workflow.version,
        status: format!("{:?}", workflow.status).to_lowercase(),
        definition: workflow.definition,
        max_iterations: workflow.max_iterations,
        on_error: workflow.on_error,
        created_at: workflow.created_at.to_rfc3339(),
        updated_at: workflow.updated_at.to_rfc3339(),
    }
}

fn workflow_run_to_response(run: fd_storage::models::WorkflowRun) -> WorkflowRunResponse {
    WorkflowRunResponse {
        id: run.id,
        workflow_id: run.workflow_id,
        project_id: run.project_id,
        status: format!("{:?}", run.status).to_lowercase(),
        input: run.input,
        output: run.output,
        error: run.error,
        current_step_id: run.current_step_id,
        step_results: run.step_results,
        input_tokens: run.input_tokens,
        output_tokens: run.output_tokens,
        tool_calls: run.tool_calls,
        cost_cents: run.cost_cents,
        created_at: run.created_at.to_rfc3339(),
        started_at: run.started_at.map(|t| t.to_rfc3339()),
        completed_at: run.completed_at.map(|t| t.to_rfc3339()),
    }
}

fn step_execution_to_response(
    exec: fd_storage::models::WorkflowStepExecution,
) -> WorkflowStepExecutionResponse {
    WorkflowStepExecutionResponse {
        id: exec.id,
        workflow_run_id: exec.workflow_run_id,
        step_id: exec.step_id,
        step_type: format!("{:?}", exec.step_type).to_lowercase(),
        status: format!("{:?}", exec.status).to_lowercase(),
        input: exec.input,
        output: exec.output,
        error: exec.error,
        attempt: exec.attempt,
        input_tokens: exec.input_tokens,
        output_tokens: exec.output_tokens,
        started_at: exec.started_at.map(|t| t.to_rfc3339()),
        completed_at: exec.completed_at.map(|t| t.to_rfc3339()),
    }
}

fn parse_step_type(s: &str) -> Result<WorkflowStepType, ApiError> {
    match s {
        "llm" => Ok(WorkflowStepType::Llm),
        "tool" => Ok(WorkflowStepType::Tool),
        "condition" => Ok(WorkflowStepType::Condition),
        "loop" => Ok(WorkflowStepType::Loop),
        "parallel" => Ok(WorkflowStepType::Parallel),
        "approval" => Ok(WorkflowStepType::Approval),
        _ => Err(ApiError::bad_request(format!("Invalid step type: {}", s))),
    }
}

// =============================================================================
// Workflow Handlers
// =============================================================================

/// Create a new workflow definition
#[instrument(skip(state, auth))]
pub async fn create_workflow(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(request): Json<CreateWorkflowRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let workflow_id = format!("wf_{}", Ulid::new());
    let create = CreateWorkflow {
        id: workflow_id.clone(),
        project_id: auth.tenant_id.clone(),
        name: request.name,
        description: request.description,
        version: request.version,
        definition: request.definition,
        max_iterations: request.max_iterations,
        on_error: request.on_error,
    };

    let workflow = repos.workflows().create(create).await?;

    Ok((StatusCode::CREATED, Json(workflow_to_response(workflow))))
}

/// Get a workflow by ID
#[instrument(skip(state, _auth))]
pub async fn get_workflow(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(workflow_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let workflow = state
        .repos()
        .workflows()
        .get(&workflow_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Workflow", &workflow_id))?;

    Ok(Json(workflow_to_response(workflow)))
}

/// List workflows
#[instrument(skip(state, auth))]
pub async fn list_workflows(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListWorkflowsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let project_id = query.project_id.unwrap_or_else(|| auth.tenant_id.clone());

    let workflows = state
        .repos()
        .workflows()
        .list_by_project(&project_id, query.limit, query.offset)
        .await?;

    let workflows: Vec<WorkflowResponse> =
        workflows.into_iter().map(workflow_to_response).collect();

    Ok(Json(ListWorkflowsResponse { workflows }))
}

// =============================================================================
// Workflow Run Handlers
// =============================================================================

/// Create a new workflow run
#[instrument(skip(state, auth))]
pub async fn create_workflow_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(request): Json<CreateWorkflowRunRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Verify workflow exists
    let workflow = repos
        .workflows()
        .get(&request.workflow_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Workflow", &request.workflow_id))?;

    let run_id = format!("wfr_{}", Ulid::new());
    let create = CreateWorkflowRun {
        id: run_id.clone(),
        workflow_id: workflow.id.clone(),
        project_id: auth.tenant_id.clone(),
        input: request.input,
        trace_id: None,
    };

    let run = repos.workflows().create_run(create).await?;

    // Parse workflow definition to get first steps
    let definition: serde_json::Value = workflow.definition;
    if let Some(steps) = definition.get("steps").and_then(|s| s.as_array()) {
        // Find steps with no dependencies (entry points)
        for step in steps {
            let step_id = step.get("id").and_then(|s| s.as_str()).unwrap_or_default();
            let depends_on = step
                .get("depends_on")
                .and_then(|d| d.as_array())
                .map(|arr| arr.len())
                .unwrap_or(0);

            if depends_on == 0 && !step_id.is_empty() {
                let step_type_str = step.get("type").and_then(|t| t.as_str()).unwrap_or("llm");
                let step_type = parse_step_type(step_type_str)?;

                let exec_id = format!("wfse_{}", Ulid::new());
                let create_exec = CreateWorkflowStepExecution {
                    id: exec_id,
                    workflow_run_id: run_id.clone(),
                    step_id: step_id.to_string(),
                    step_type,
                    input: step.get("config").cloned().unwrap_or(serde_json::json!({})),
                    attempt: 1,
                    span_id: None,
                };

                repos.workflows().create_step_execution(create_exec).await?;
            }
        }
    }

    // Update run status to running
    repos
        .workflows()
        .update_run_status(&run_id, WorkflowRunStatus::Running)
        .await?;

    Ok((StatusCode::CREATED, Json(workflow_run_to_response(run))))
}

/// Get a workflow run by ID
#[instrument(skip(state, _auth))]
pub async fn get_workflow_run(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let run = state
        .repos()
        .workflows()
        .get_run(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("WorkflowRun", &run_id))?;

    Ok(Json(workflow_run_to_response(run)))
}

/// List workflow runs
#[instrument(skip(state, _auth))]
pub async fn list_workflow_runs(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(workflow_id): Path<String>,
    Query(query): Query<ListWorkflowsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify workflow exists
    state
        .repos()
        .workflows()
        .get(&workflow_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Workflow", &workflow_id))?;

    let runs = state
        .repos()
        .workflows()
        .list_runs_by_workflow(&workflow_id, query.limit, query.offset)
        .await?;

    let runs: Vec<WorkflowRunResponse> = runs.into_iter().map(workflow_run_to_response).collect();

    Ok(Json(serde_json::json!({ "runs": runs })))
}

/// Cancel a workflow run
#[instrument(skip(state, _auth))]
pub async fn cancel_workflow_run(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let run = repos
        .workflows()
        .get_run(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("WorkflowRun", &run_id))?;

    if run.status.is_terminal() {
        return Err(ApiError::bad_request(format!(
            "Run is already in terminal state: {:?}",
            run.status
        )));
    }

    let updated = repos
        .workflows()
        .update_run(
            &run_id,
            UpdateWorkflowRun {
                status: Some(WorkflowRunStatus::Cancelled),
                completed_at: Some(Utc::now()),
                ..Default::default()
            },
        )
        .await?
        .ok_or_else(|| ApiError::internal("Failed to update run"))?;

    Ok(Json(workflow_run_to_response(updated)))
}

// =============================================================================
// Step Execution Handlers
// =============================================================================

/// List step executions for a workflow run
#[instrument(skip(state, _auth))]
pub async fn list_step_executions(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify run exists
    state
        .repos()
        .workflows()
        .get_run(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("WorkflowRun", &run_id))?;

    let executions = state
        .repos()
        .workflows()
        .list_step_executions_by_run(&run_id)
        .await?;

    let executions: Vec<WorkflowStepExecutionResponse> = executions
        .into_iter()
        .map(step_execution_to_response)
        .collect();

    Ok(Json(serde_json::json!({ "executions": executions })))
}

/// Create a new step execution (for orchestration)
#[instrument(skip(state, _auth))]
pub async fn create_step_execution(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
    Json(request): Json<CreateStepExecutionRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Verify run exists
    repos
        .workflows()
        .get_run(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("WorkflowRun", &run_id))?;

    let step_type = parse_step_type(&request.step_type)?;
    let exec_id = format!("wfse_{}", Ulid::new());

    let create = CreateWorkflowStepExecution {
        id: exec_id,
        workflow_run_id: run_id,
        step_id: request.step_id,
        step_type,
        input: request.input,
        attempt: request.attempt,
        span_id: None,
    };

    let execution = repos.workflows().create_step_execution(create).await?;

    Ok((
        StatusCode::CREATED,
        Json(step_execution_to_response(execution)),
    ))
}

/// Submit step execution result (from worker)
#[instrument(skip(state, _auth))]
pub async fn submit_step_execution_result(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path((run_id, execution_id)): Path<(String, String)>,
    Json(request): Json<SubmitStepExecutionResultRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Verify run exists
    let run = repos
        .workflows()
        .get_run(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("WorkflowRun", &run_id))?;

    // Verify execution exists
    let execution = repos
        .workflows()
        .get_step_execution(&execution_id)
        .await?
        .ok_or_else(|| ApiError::not_found("WorkflowStepExecution", &execution_id))?;

    if execution.workflow_run_id != run_id {
        return Err(ApiError::bad_request(
            "Execution does not belong to this run",
        ));
    }

    let status = match request.status.as_str() {
        "completed" => WorkflowStepExecutionStatus::Completed,
        "failed" => WorkflowStepExecutionStatus::Failed,
        "waiting_approval" => WorkflowStepExecutionStatus::WaitingApproval,
        "skipped" => WorkflowStepExecutionStatus::Skipped,
        "retrying" => WorkflowStepExecutionStatus::Retrying,
        _ => return Err(ApiError::bad_request("Invalid status")),
    };

    let update = UpdateWorkflowStepExecution {
        status: Some(status),
        output: request.output.clone(),
        error: request.error.clone(),
        input_tokens: request.input_tokens,
        output_tokens: request.output_tokens,
        completed_at: Some(Utc::now()),
        ..Default::default()
    };

    let updated_execution = repos
        .workflows()
        .update_step_execution(&execution_id, update)
        .await?
        .ok_or_else(|| ApiError::internal("Failed to update execution"))?;

    // Update run step results
    if let Some(ref output) = request.output {
        repos
            .workflows()
            .update_run_step_results(&run_id, &execution.step_id, output.clone())
            .await?;
    }

    // Update run usage
    if let (Some(in_tokens), Some(out_tokens)) = (request.input_tokens, request.output_tokens) {
        repos
            .workflows()
            .increment_run_usage(&run_id, in_tokens, out_tokens, 0, 0)
            .await?;
    }

    // Check if workflow run should be updated based on step status
    match status {
        WorkflowStepExecutionStatus::Failed => {
            // Check on_error policy from workflow
            let workflow = repos
                .workflows()
                .get(&run.workflow_id)
                .await?
                .ok_or_else(|| ApiError::internal("Workflow not found"))?;

            let on_error = workflow.on_error.as_str();
            if on_error == "fail" {
                repos
                    .workflows()
                    .update_run(
                        &run_id,
                        UpdateWorkflowRun {
                            status: Some(WorkflowRunStatus::Failed),
                            error: request.error,
                            completed_at: Some(Utc::now()),
                            ..Default::default()
                        },
                    )
                    .await?;
            }
        }
        WorkflowStepExecutionStatus::WaitingApproval => {
            repos
                .workflows()
                .update_run(
                    &run_id,
                    UpdateWorkflowRun {
                        status: Some(WorkflowRunStatus::WaitingApproval),
                        current_step_id: Some(execution.step_id.clone()),
                        ..Default::default()
                    },
                )
                .await?;
        }
        WorkflowStepExecutionStatus::Completed => {
            // Check if all steps are completed
            let pending = repos
                .workflows()
                .get_pending_step_executions(&run_id)
                .await?;

            if pending.is_empty() {
                // All steps done - check if there are more steps to execute
                // For now, mark as completed
                repos
                    .workflows()
                    .update_run(
                        &run_id,
                        UpdateWorkflowRun {
                            status: Some(WorkflowRunStatus::Completed),
                            output: request.output,
                            completed_at: Some(Utc::now()),
                            ..Default::default()
                        },
                    )
                    .await?;
            }
        }
        _ => {}
    }

    Ok(Json(step_execution_to_response(updated_execution)))
}
