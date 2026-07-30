//! Run management handlers

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use chrono::Utc;
use fd_core::{AgentId, RunId, ToolVersionId};
use fd_otel::genai::pricing;
use fd_policy::budget::{Budget, BudgetUsage};
use fd_policy::forecast::{compute_forecast, ForecastInputs, ForecastSnapshot};
use fd_policy::reversibility::ResponseLevel;
use fd_policy::routing::RoutingDecision;
use fd_policy::{CoherenceSpan, TrajectoryEvent};
use fd_storage::{
    models::{
        action, actor, resource, AgentVersion, AuditEventBuilder, CreateRun, CreateStep, RunStatus,
        StepStatus, StepType, ToolVersion, UpdateRun, UpdateStep,
    },
    queue::{JobContext, StepJob},
    QueueMessage, RunForecastSnapshot,
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
    /// Linear projection of end-of-run cost in cents (null until the first
    /// step completes).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub projected_cost_cents: Option<i64>,
    /// EWMA-smoothed projection of end-of-run cost in cents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ewma_cost_cents: Option<i64>,
    /// `true` when any axis is projected to exceed its configured cap before
    /// the run can terminate.
    #[serde(default)]
    pub budget_breach_projected: bool,
    /// Axis that triggered the breach projection: `cost_cents`, `tool_calls`,
    /// or `wall_time`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub breach_kind: Option<String>,
    /// When the latest forecast snapshot was computed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub forecast_at: Option<String>,
    /// Graduated reversibility-aware response level last applied to a tool call
    /// on this run (`allow_and_log` | `allow_under_budget` | `require_approval`,
    /// the DeepMind R1–R3 ladder). `None` until the first policy check runs.
    /// This is the field the run console renders (via the polled run endpoint).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_level: Option<String>,
    /// Per-run claim-grounding rate (VeriGraph, arXiv:2606.16603): fraction of
    /// the final output's claims reachable from a tool-output source node.
    /// `None` until the run completes. Rendered on the run console next to cost.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub claim_grounding_rate: Option<f32>,
    /// `true` when the grounding rate fell below the project's optional
    /// `min_claim_grounding_rate` threshold (a reliability flag, not enforcement).
    #[serde(default)]
    pub claim_grounding_flagged: bool,
    /// Coherence-divergence signal (Strained Coherence, arXiv:2606.07889):
    /// `true` when the live monitor surfaced a stated-blocking-fact →
    /// contradicting-closure-action divergence on this run, `false` for a
    /// coherent completed run, `None` for legacy runs (renders null-for-legacy
    /// on the console). A reliability flag only — never enforcement.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub coherence_divergence_flagged: Option<bool>,
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
        projected_cost_cents: run.projected_cost_cents,
        ewma_cost_cents: run.ewma_cost_cents,
        budget_breach_projected: run.budget_breach_projected,
        breach_kind: run.breach_kind,
        forecast_at: run.forecast_at.map(|t| t.to_rfc3339()),
        response_level: run.response_level,
        claim_grounding_rate: run.claim_grounding_rate,
        claim_grounding_flagged: run.claim_grounding_flagged,
        coherence_divergence_flagged: run.coherence_divergence_flagged,
    }
}

/// Flatten a JSON value to plain text for claim-grounding tokenization. A
/// string value is used verbatim; anything else is serialized (tokenization
/// strips punctuation, so the formatting doesn't affect the token set). Mirrors
/// the Python `claim_grounding._stringify`.
fn value_to_text(value: &serde_json::Value) -> String {
    match value.as_str() {
        Some(s) => s.to_string(),
        None => value.to_string(),
    }
}

/// Project a completed step into the trajectory events the [`CoherenceMonitor`]
/// consumes, in observation order: a *Tool* step is an advancing **action**
/// (the invocation — where a closure like `git_commit` lives) followed by a
/// **statement** (its observed output/error — where a blocking fact like
/// "tests failed" lives); a reasoning/other step contributes statements only.
/// Feeding action-before-statement means a later step's closure action is
/// checked against blocking facts opened by earlier steps' outputs — exactly
/// the sequential pattern the monitor detects.
///
/// [`CoherenceMonitor`]: fd_policy::CoherenceMonitor
fn step_trajectory_events(step: &fd_storage::models::Step) -> Vec<TrajectoryEvent> {
    let mut events = Vec::new();
    if matches!(step.step_type, StepType::Tool) {
        if let Some(name) = step.tool_name.as_deref() {
            events.push(TrajectoryEvent::action(name, value_to_text(&step.input)));
        }
    }
    if let Some(output) = step.output.as_ref() {
        events.push(TrajectoryEvent::statement(value_to_text(output)));
    }
    if let Some(error) = step.error.as_ref() {
        events.push(TrajectoryEvent::statement(value_to_text(error)));
    }
    events
}

/// Build the audit event that surfaces a coherence divergence through the
/// **same** `airlock.violation_detected` `audit_events` path every other
/// Airlock layer uses — no parallel store, no parallel decision channel. The
/// span is projected via [`CoherenceSpan::to_violation`] so `violation_type`,
/// `trigger`, and the full evidence ride the identical `details` shape.
///
/// The chosen reversibility-ladder rung (`response_level` / `response_rung`,
/// from [`CoherenceSpan::response_level`]) and the effective `mode`
/// (`shadow` | `enforce`) ride the same `details`. `gated = true` only when
/// `enforce` mode actually halts the run (R3); in `shadow` mode the rung is
/// recorded but `gated = false` and the run is untouched.
fn coherence_audit_event(
    run_id: &str,
    project_id: &str,
    span: &CoherenceSpan,
    level: ResponseLevel,
    enforce: bool,
    gated: bool,
) -> fd_storage::models::CreateAuditEvent {
    let violation = span.to_violation();
    let coherence = serde_json::to_value(span).unwrap_or(serde_json::Value::Null);
    AuditEventBuilder::new("airlock.violation_detected", resource::RUN)
        .actor(actor::SYSTEM, None)
        .resource_id(run_id)
        .run(run_id)
        .project(project_id)
        .details(serde_json::json!({
            "violation_type": "coherence_divergence",
            "trigger": violation.trigger,
            "risk_score": violation.risk_score,
            "risk_level": violation.risk_level.as_str(),
            "response_level": level.as_str(),
            "response_rung": level.rung(),
            "mode": if enforce { "enforce" } else { "shadow" },
            "shadow_mode": !enforce,
            "gated": gated,
            "blocked": gated,
            "coherence": coherence,
        }))
        .build()
}

/// Emit the `coherence.divergence.detected` SSE event shape for the dashboard
/// run stream. The gateway has no direct SSE push path yet — like every other
/// run-channel event (`run.forecast.updated`, `routing.decision.recorded`),
/// the gateway→BFF push is **deferred**; the BFF locks the wire shape via its
/// mock generator and the console picks the persisted rung up on the next poll.
/// This records the exact payload as a structured `event = "coherence.divergence.detected"`
/// trace so the shape is defined + observable server-side.
fn emit_coherence_sse(run_id: &str, span: &CoherenceSpan, level: ResponseLevel, gated: bool) {
    info!(
        event = "coherence.divergence.detected",
        run_id = run_id,
        category = span.category.label(),
        confidence = span.confidence,
        response_level = level.as_str(),
        response_rung = level.rung(),
        gated = gated,
        anchor = span.anchor.as_str(),
        "coherence divergence detected"
    );
}

/// Convert a [`ForecastSnapshot`] into the storage-shape snapshot that the
/// repository persists. Saturating casts keep us safe against the rare case
/// where the projection overflows `i64`.
fn forecast_to_storage(
    snapshot: ForecastSnapshot,
    breach_kind_label: Option<String>,
    forecast_at: chrono::DateTime<chrono::Utc>,
) -> RunForecastSnapshot {
    fn saturating_i64(value: u64) -> i64 {
        value.min(i64::MAX as u64) as i64
    }
    RunForecastSnapshot {
        projected_cost_cents: saturating_i64(snapshot.projected_cost_cents),
        ewma_cost_cents: saturating_i64(snapshot.ewma_cost_cents),
        ewma_step_cost_cents: saturating_i64(snapshot.ewma_step_cost_cents),
        budget_breach_projected: snapshot.budget_breach_projected,
        breach_kind: breach_kind_label,
        forecast_at,
    }
}

/// Stable string labels for [`fd_policy::forecast::BreachKind`] used on the
/// API + SSE wire and persisted on the `runs` table.
fn breach_kind_label(kind: fd_policy::forecast::BreachKind) -> &'static str {
    use fd_policy::forecast::BreachKind;
    match kind {
        BreachKind::CostCents => "cost_cents",
        BreachKind::ToolCalls => "tool_calls",
        BreachKind::WallTime => "wall_time",
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
#[instrument(skip(state, auth))]
pub async fn get_run(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let run = state
        .repos()
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    // SECURITY: Verify tenant owns this run's project
    // The run belongs to a project, and the project must belong to the authenticated tenant
    if !super::project_access_allowed(state.repos(), &auth, &run.project_id).await? {
        warn!(
            run_id = %run_id,
            run_project = %run.project_id,
            auth_tenant = %auth.tenant_id,
            "Unauthorized access attempt to run from different tenant"
        );
        return Err(ApiError::forbidden("Access denied to this run"));
    }

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

    // SECURITY: Verify tenant owns this run's project
    if !super::project_access_allowed(state.repos(), &auth, &run.project_id).await? {
        warn!(
            run_id = %run_id,
            run_project = %run.project_id,
            auth_tenant = %auth.tenant_id,
            "Unauthorized cancel attempt for run from different tenant"
        );
        return Err(ApiError::forbidden("Access denied to cancel this run"));
    }

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
#[instrument(skip(state, auth))]
pub async fn list_steps(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let run = state
        .repos()
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    // SECURITY: Verify tenant owns this run's project
    if !super::project_access_allowed(state.repos(), &auth, &run.project_id).await? {
        warn!(
            run_id = %run_id,
            run_project = %run.project_id,
            auth_tenant = %auth.tenant_id,
            "Unauthorized access attempt to run steps from different tenant"
        );
        return Err(ApiError::forbidden("Access denied to this run"));
    }

    let steps = state.repos().steps().list_by_run(&run_id).await?;

    let steps: Vec<StepResponse> = steps.into_iter().map(step_to_response).collect();

    Ok(Json(steps))
}

// =============================================================================
// Routing-decision read endpoint (AgensFlow, arXiv:2605.27466)
// =============================================================================

/// One routing-decision record, projected from `audit_events.details` for
/// the API response. Mirrors `fd_policy::routing::RoutingDecision` plus the
/// `occurred_at` timestamp that the audit row carries.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoutingDecisionResponse {
    /// `rtg_*` ULID of the decision.
    pub id: String,
    /// Run this decision belongs to.
    pub run_id: String,
    /// Subtask / DAG step the decision bound.
    pub subtask_id: String,
    /// Every candidate the orchestrator considered, in evaluation order.
    pub candidates: serde_json::Value,
    /// The candidate that won.
    pub chosen: serde_json::Value,
    /// Reason for the choice (`code` + operator-readable `detail`).
    pub reason: serde_json::Value,
    /// SHA-256 over a stable JSON projection of the structural fields.
    /// fd-evals replays compare this to detect coordination drift.
    pub content_hash: String,
    /// Wall-clock UTC when the audit row was written.
    pub occurred_at: String,
    /// Stable arXiv anchor for the audit methodology.
    pub anchor: String,
}

/// Response wrapper around the routing-decision chain for one run.
#[derive(Debug, Serialize, ToSchema)]
pub struct RoutingResponse {
    pub run_id: String,
    /// Decisions ordered oldest → newest. Empty when the run has not yet
    /// dispatched any subtasks (or when the orchestrator path that emits
    /// them has not been exercised — see runbook).
    pub decisions: Vec<RoutingDecisionResponse>,
    /// Stable arXiv anchor mirrored at the response root for consumers
    /// that read the envelope without iterating decisions.
    pub anchor: String,
}

/// Get the routing-decision chain for a run.
///
/// Reads the existing `audit_events` table filtered by
/// `action = "routing.decided"`; no parallel store. Each row's `details`
/// JSON deserialises through
/// [`fd_policy::routing::RoutingDecision::from_audit_details`]. Anchor:
/// AgensFlow ([arXiv:2605.27466](https://arxiv.org/abs/2605.27466)).
#[utoipa::path(
    get,
    path = "/v1/runs/{run_id}/routing",
    tag = "runs",
    params(
        ("run_id" = String, Path, description = "Run ID")
    ),
    responses(
        (status = 200, description = "Routing-decision chain for the run", body = RoutingResponse),
        (status = 404, description = "Run not found")
    )
)]
#[instrument(skip(state, auth))]
pub async fn get_routing(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(run_id): Path<String>,
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
            "Unauthorized routing-chain access attempt"
        );
        return Err(ApiError::forbidden("Access denied to this run"));
    }

    let events = state
        .repos()
        .audit()
        .list_routing_decisions(&run_id)
        .await?;

    let mut decisions = Vec::with_capacity(events.len());
    for event in events {
        let parsed = match RoutingDecision::from_audit_details(&event.details) {
            Ok(d) => d,
            Err(err) => {
                warn!(
                    audit_event_id = %event.id,
                    error = %err,
                    "Skipping malformed routing-decision audit row"
                );
                continue;
            }
        };
        decisions.push(RoutingDecisionResponse {
            id: parsed.id,
            run_id: parsed.run_id,
            subtask_id: parsed.subtask_id,
            candidates: serde_json::to_value(&parsed.candidates).unwrap_or(serde_json::Value::Null),
            chosen: serde_json::to_value(&parsed.chosen).unwrap_or(serde_json::Value::Null),
            reason: serde_json::to_value(&parsed.reason).unwrap_or(serde_json::Value::Null),
            content_hash: parsed.content_hash,
            occurred_at: event.occurred_at.to_rfc3339(),
            anchor: parsed.anchor,
        });
    }

    Ok(Json(RoutingResponse {
        run_id,
        decisions,
        anchor: fd_policy::routing::ROUTING_ANCHOR.to_string(),
    }))
}

/// Submit step result (from worker)
#[instrument(skip(state, _auth), fields(
    run_id = %run_id,
    step_id = %step_id,
    ferrumdeck.reliability.claim_grounding_rate = tracing::field::Empty,
    ferrumdeck.reliability.claim_grounding_below_threshold = tracing::field::Empty,
    ferrumdeck.reliability.claim_grounding_threshold = tracing::field::Empty,
    ferrumdeck.reliability.coherence_divergence = tracing::field::Empty,
))]
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

    // -----------------------------------------------------------------------
    // Coherence-divergence monitor (Strained Coherence, arXiv:2606.07889)
    // -----------------------------------------------------------------------
    // Feed THIS step's trajectory events into the per-run monitor as they
    // stream in. A divergence — a stated blocking fact followed by a
    // contradicting closure action — surfaces the instant it completes,
    // mid-run, through the same `airlock.violation_detected` audit path every
    // other Airlock layer uses. Each divergence maps onto the existing
    // reversibility ladder (R1–R3) via `CoherenceSpan::response_level`; the
    // rung is recorded + emitted (SSE `coherence.divergence.detected`). In
    // `shadow` mode (default) the run is untouched; in `enforce` mode an R3
    // rung gates the run (→ `WaitingApproval`) for human review.
    let coherence_run_id = RunId::parse(&run_id).unwrap_or_else(|_| RunId::new());
    let mut coherence_fired = false;
    let mut coherence_gated = false;
    let mut coherence_level: Option<ResponseLevel> = None;
    for event in step_trajectory_events(&updated_step) {
        if let Some(span) = state
            .coherence
            .observe_event(&coherence_run_id, &event, &state.coherence_config)
            .await
        {
            coherence_fired = true;
            let level = span.response_level();
            coherence_level = Some(level);
            let gate = state.coherence_enforce && level == ResponseLevel::RequireApproval;
            coherence_gated |= gate;
            repos.spawn_audit(coherence_audit_event(
                &run_id,
                &run.project_id,
                &span,
                level,
                state.coherence_enforce,
                gate,
            ));
            // Lock in the SSE wire shape (gateway→BFF push deferred, same as
            // run.forecast.updated / routing.decision.recorded).
            emit_coherence_sse(&run_id, &span, level, gate);
        }
    }
    if coherence_fired {
        // Reflect the flag + the selected graduated-response rung on the run
        // row immediately so `GET /v1/runs/{id}` shows it live, before the run
        // completes. In enforce mode an R3 divergence also gates the run now.
        let mut upd = UpdateRun {
            coherence_divergence_flagged: Some(true),
            response_level: coherence_level.map(|l| l.as_str().to_string()),
            ..Default::default()
        };
        if coherence_gated {
            upd.status = Some(RunStatus::WaitingApproval);
            upd.status_reason =
                Some("coherence divergence — human review required (enforce mode)".to_string());
            warn!(run_id = %run_id, "Coherence divergence gated run (enforce mode, R3)");
        }
        if let Err(err) = repos.runs().update(&run_id, upd).await {
            warn!(run_id = %run_id, error = %err, "Failed to persist coherence flag");
        }
    }

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

    // Resolve the budget this run is actually held to (per-run config override >
    // agent-version caps > engine default), so the forecast and the auto-kill
    // below evaluate against the run's real limits — not a single global default.
    let effective_budget = {
        let agent_version = repos
            .agents()
            .get_version(&updated_run.agent_version_id)
            .await?;
        resolve_run_budget(
            &updated_run.config,
            agent_version.as_ref(),
            state.policy_engine.default_budget(),
        )
    };

    // -----------------------------------------------------------------------
    // Predictive run-budget forecast
    // -----------------------------------------------------------------------
    // Project end-of-run cost (linear + EWMA) against the same budget the
    // policy engine would auto-kill on, then persist the snapshot so the
    // dashboard sees it on the next poll / SSE event. Failures are
    // non-fatal — the forecast is a UX/observability signal, not a gate.
    let forecast_inputs = ForecastInputs {
        cost_so_far_cents: updated_run.cost_cents as u64,
        tool_calls_so_far: updated_run.tool_calls as u32,
        wall_time_ms_so_far: wall_time_ms,
        steps_completed: updated_run.tool_calls.max(1) as u32,
        step_cost_cents,
        prior_ewma_step_cost_cents: updated_run.ewma_step_cost_cents.map(|v| v.max(0) as u64),
    };
    let forecast = compute_forecast(forecast_inputs, &effective_budget);
    let breach_label = forecast
        .breach_kind
        .map(breach_kind_label)
        .map(str::to_owned);
    let storage_forecast = forecast_to_storage(forecast.clone(), breach_label.clone(), Utc::now());
    if let Err(err) = repos
        .runs()
        .update_forecast(&run_id, &storage_forecast)
        .await
    {
        warn!(run_id = %run_id, error = %err, "Failed to persist run forecast snapshot");
    } else if forecast.budget_breach_projected {
        info!(
            run_id = %run_id,
            projected_cost_cents = forecast.projected_cost_cents,
            ewma_cost_cents = forecast.ewma_cost_cents,
            breach_kind = breach_label.as_deref().unwrap_or("unknown"),
            "Run projected to breach budget"
        );
    }

    let budget_decision = state
        .policy_engine
        .check_budget(&usage, Some(&effective_budget));

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

        // Emit the budget circuit-breaker kill as an OTel GenAI decision span
        // (`ferrumdeck.decision=kill`), the run-level counterpart to the
        // per-tool allow/deny/approval spans. A budget kill is not tied to a
        // single tool call, so the tool name is the `budget_gate` sentinel and
        // no reversibility rung applies; remaining headroom is 0 by definition.
        let kill_call_id = budget_decision.id.to_string();
        fd_otel::emit_tool_decision_span(
            fd_otel::GenAiSemconv::from_env(),
            "budget_gate",
            fd_otel::DecisionOutcome::Kill,
            &budget_decision.reason,
            None,
            effective_budget.cost_remaining_cents(&usage),
            Some(kill_call_id.as_str()),
            None, // no Colorado ADMT context on the budget circuit breaker
            None, // no MCP `_meta` trace context on the budget circuit breaker
        );

        // Terminal — free the run's coherence trajectory state.
        state.coherence.clear_run(&coherence_run_id).await;

        // Return the step result, but the run is now killed
        return Ok(Json(step_to_response(updated_step)));
    }

    // Check if run is complete
    let pending_steps = repos.steps().get_pending_steps(&run_id).await?;

    if pending_steps.is_empty() && status == StepStatus::Completed {
        // Reliability signal (VeriGraph, arXiv:2606.16603): the per-run
        // claim-grounding rate — fraction of the final output's claims
        // reachable from a tool-output source node. Computed here at the
        // run-completion choke point from the final output + the run's
        // tool-step outputs. Deterministic; never gates — an optional
        // per-project threshold only *flags* the run.
        let final_output_text = updated_step
            .output
            .as_ref()
            .map(value_to_text)
            .unwrap_or_default();
        let all_steps = repos.steps().list_by_run(&run_id).await?;
        let source_texts: Vec<String> = all_steps
            .iter()
            .filter(|s| matches!(s.step_type, StepType::Tool))
            .filter_map(|s| s.output.as_ref().map(value_to_text))
            .collect();
        // Optional per-project threshold — absent ⇒ off ⇒ never flags.
        let project_threshold = repos
            .projects()
            .get_settings(&run.project_id)
            .await
            .ok()
            .flatten()
            .and_then(|s| {
                s.get("min_claim_grounding_rate")
                    .and_then(serde_json::Value::as_f64)
            });
        let grounding = fd_otel::ClaimGrounding::compute_from_texts(
            &final_output_text,
            &source_texts,
            project_threshold.unwrap_or(fd_otel::DEFAULT_MIN_CLAIM_GROUNDING_RATE),
        );
        // Flag only when the project explicitly opted into a threshold.
        let grounding_flagged = project_threshold.is_some() && grounding.below_threshold;
        fd_otel::claim_grounding::record_on_span(&tracing::Span::current(), &grounding);

        // Coherence-divergence: the run is terminating with a "reports success"
        // outcome. Feed a synthetic terminal closure action carrying the final
        // output text — so a run that ends with an unresolved blocking fact
        // (and does not disclaim it) fires, while an honest disclaimer in the
        // final output ("cannot complete, tests failing") is suppressed by the
        // monitor's own guard. `mark_complete` is a recognized closure token.
        let terminal_action = TrajectoryEvent::action("mark_complete", &final_output_text);
        if let Some(span) = state
            .coherence
            .observe_event(&coherence_run_id, &terminal_action, &state.coherence_config)
            .await
        {
            coherence_fired = true;
            let level = span.response_level();
            coherence_level = Some(level);
            let gate = state.coherence_enforce && level == ResponseLevel::RequireApproval;
            coherence_gated |= gate;
            repos.spawn_audit(coherence_audit_event(
                &run_id,
                &run.project_id,
                &span,
                level,
                state.coherence_enforce,
                gate,
            ));
            emit_coherence_sse(&run_id, &span, level, gate);
        }
        // Final flag: fired this invocation OR already persisted by an earlier
        // step submission. Coherent completed runs record `Some(false)` so the
        // console shows a green "Coherent" card; only legacy runs stay `None`.
        let coherence_flagged =
            coherence_fired || updated_run.coherence_divergence_flagged.unwrap_or(false);
        tracing::Span::current().record(
            fd_otel::genai::attrs::FERRUMDECK_RELIABILITY_COHERENCE_DIVERGENCE,
            coherence_flagged,
        );
        // Trajectory state for this run is no longer needed — free it.
        state.coherence.clear_run(&coherence_run_id).await;

        if grounding_flagged {
            let audit_event =
                AuditEventBuilder::new(action::CLAIM_GROUNDING_BELOW_THRESHOLD, resource::RUN)
                    .actor(actor::SYSTEM, None)
                    .resource_id(&run_id)
                    .run(&run_id)
                    .project(&run.project_id)
                    .details(serde_json::json!({
                        "claim_grounding_rate": grounding.rate,
                        "threshold": grounding.threshold,
                        "claims_total": grounding.claims_total,
                        "claims_grounded": grounding.claims_grounded,
                    }))
                    .build();
            repos.spawn_audit(audit_event);
        }

        // In enforce mode an R3 coherence divergence gates the run instead of
        // completing it: the run reported success while ignoring a blocking
        // fact, so it halts for human review (→ WaitingApproval) rather than
        // being marked Completed. In shadow mode (default) the rung is recorded
        // but the run completes normally.
        let (final_status, final_reason, final_completed_at) = if coherence_gated {
            (
                RunStatus::WaitingApproval,
                Some("coherence divergence — human review required (enforce mode)".to_string()),
                None,
            )
        } else {
            (RunStatus::Completed, None, Some(Utc::now()))
        };
        repos
            .runs()
            .update(
                &run_id,
                UpdateRun {
                    status: Some(final_status),
                    status_reason: final_reason,
                    completed_at: final_completed_at,
                    output: updated_step.output.clone(),
                    claim_grounding_rate: Some(grounding.rate as f32),
                    claim_grounding_flagged: Some(grounding_flagged),
                    coherence_divergence_flagged: Some(coherence_flagged),
                    response_level: coherence_level.map(|l| l.as_str().to_string()),
                    ..Default::default()
                },
            )
            .await?;

        if coherence_gated {
            info!(run_id = %run_id, "Run gated for human review (coherence divergence, enforce mode)");
        } else {
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
        }
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

        // Terminal — free the run's coherence trajectory state.
        state.coherence.clear_run(&coherence_run_id).await;

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

    /// MCP request metadata (`_meta`). Per MCP **SEP-414**, a caller may carry
    /// W3C trace context here under the unprefixed keys `traceparent` /
    /// `tracestate` / `baggage`, so the enforcement decision joins the caller's
    /// distributed trace. Read only when the OTel semconv stability opt-in is
    /// enabled; ignored otherwise. Passed through untouched by the SDK.
    #[serde(rename = "_meta", default)]
    #[schema(value_type = Object, nullable = true)]
    pub meta: Option<serde_json::Value>,
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

    /// Audit-grade explanation of how the policy decision was reached:
    /// every matched verdict, which one fired, and which were overridden
    /// by precedence. Additive — older clients can ignore the field.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Object)]
    pub decision_trace: Option<fd_policy::trace::DecisionTrace>,

    /// The tool's reversibility tier that drove the graduated response
    /// (`reversible` | `costly` | `irreversible`).
    #[serde(default)]
    pub reversibility: String,
    /// The chosen graduated response level (DeepMind R1–R3 ladder):
    /// `allow_and_log` (R1) | `allow_under_budget` (R2) | `require_approval`
    /// (R3). Folded with the allowlist decision, more-restrictive-wins.
    #[serde(default)]
    pub response_level: String,
}

/// Derive the Airlock inspection `tool_version_id` from the tool's latest
/// registered version. Returns `None` when there is no version, or when the
/// stored id does not parse as a `ToolVersionId` — the schema-drift layer then
/// simply skips this call (fail-open for the drift SIGNAL; the allowlist still
/// governs whether the call runs).
fn inspection_tool_version_id(version: Option<&ToolVersion>) -> Option<ToolVersionId> {
    version.and_then(|v| ToolVersionId::parse(&v.id).ok())
}

/// Derive the Airlock inspection `agent_id` from the run's agent version.
/// Returns `None` when the agent version is absent, or when its `agent_id`
/// does not parse — the behavioral-drift layer then skips this call (fail-open
/// for the drift SIGNAL only).
fn inspection_agent_id(agent_version: Option<&AgentVersion>) -> Option<AgentId> {
    agent_version.and_then(|av| AgentId::parse(&av.agent_id).ok())
}

/// Check if a tool call is allowed by policy and Airlock security inspection
/// Workers should call this before executing tool steps
#[instrument(skip(state, auth), fields(
    run_id = %run_id,
    tool_name = %request.tool_name,
    ferrumdeck.policy.response_level = tracing::field::Empty,
    ferrumdeck.policy.reversibility = tracing::field::Empty,
))]
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

    // MCP SEP-414: when the OTel semconv stability opt-in is enabled, extract W3C
    // trace context from the request `_meta` (`traceparent`/`tracestate`/
    // `baggage`) so the enforcement decision span joins the caller's distributed
    // trace and the persisted decision record can be joined to the trace. Gated
    // behind the SAME opt-in as the GenAI span naming
    // (`OTEL_SEMCONV_STABILITY_OPT_IN=gen_ai_latest_experimental`); a malformed or
    // absent context yields `None`, and everything below behaves exactly as
    // before — a pure extension for callers who send nothing.
    let semconv = fd_otel::GenAiSemconv::from_env();
    let mcp_trace_parent = if semconv.is_latest_experimental() {
        request
            .meta
            .as_ref()
            .and_then(fd_otel::extract_trace_context)
    } else {
        None
    };

    let run = repos
        .runs()
        .get(&run_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Run", &run_id))?;

    // Step 1: Check the tool against THIS run's agent allowlist (deny-by-default).
    // The agent version stores the allowed / approval-required / denied tool tiers;
    // we build the per-run allowlist from it and evaluate against that, rather than
    // a process-global default — so each agent is held to exactly the tools it was
    // configured with. A run whose agent version is missing falls back to an empty
    // allowlist, i.e. deny-by-default.
    let agent_version = repos.agents().get_version(&run.agent_version_id).await?;
    let allowlist = agent_version
        .as_ref()
        .map(|av| fd_policy::ToolAllowlist {
            allowed_tools: av.allowed_tools.clone(),
            approval_required: av.approval_required_tools.clone(),
            denied_tools: av.denied_tools.clone(),
        })
        .unwrap_or_default();
    let decision = state
        .policy_engine
        .evaluate_tool_call_with(&allowlist, &request.tool_name);

    // Step 1b: Reversibility-aware graduated response (DeepMind AI Control
    // Roadmap R1–R3 ladder). Reversibility is orthogonal to the allowlist's
    // risk tiers: a `Reversible` tool is allowed-and-logged (R1), a `Costly`
    // one is allowed only while the run's cost budget has headroom and
    // escalates to approval once exhausted (R2→R3), and an `Irreversible` one
    // always requires approval (R3). An UNREGISTERED tool defaults to
    // Irreversible (deny-by-default). The rung is folded into the allowlist
    // decision more-restrictive-wins, so it can only ever *add* friction.
    let tool_row = repos
        .tools()
        .find_by_name_or_slug(&request.tool_name)
        .await?;
    let reversibility = tool_row
        .as_ref()
        .map(|t| fd_policy::Reversibility::parse(&t.reversibility))
        .unwrap_or_default();

    // The tool's latest registered version carries the input schema the
    // schema-drift guard (Airlock Layer 0) was compiled from at boot. We resolve
    // it here so its id can be threaded into the inspection context below; an
    // unregistered tool (no row) or a tool with no versions yields None, and the
    // schema-drift layer simply skips — fail-open for the drift SIGNAL only, the
    // deny-by-default allowlist above still governs whether the call runs.
    let latest_version = match &tool_row {
        Some(t) => repos.tools().get_latest_version(&t.id).await?,
        None => None,
    };
    let effective_budget =
        resolve_run_budget(&run.config, agent_version.as_ref(), &Budget::default());
    let usage = fd_policy::budget::BudgetUsage {
        input_tokens: run.input_tokens.max(0) as u64,
        output_tokens: run.output_tokens.max(0) as u64,
        tool_calls: run.tool_calls.max(0) as u32,
        wall_time_ms: 0,
        cost_cents: run.cost_cents.max(0) as u64,
    };
    let has_headroom =
        effective_budget.has_cost_headroom(&usage, request.estimated_cost_cents.unwrap_or(0));
    let response_level = fd_policy::graduated_response(reversibility, has_headroom);
    let combined_kind = fd_policy::combine_response(decision.kind, response_level);

    // Emit the chosen rung on the current OTel/GenAI span (mirrored to the
    // audit trail + the polled RunResponse below).
    let span = tracing::Span::current();
    span.record("ferrumdeck.policy.response_level", response_level.as_str());
    span.record("ferrumdeck.policy.reversibility", reversibility.as_str());

    // Step 2: Run Airlock inspection on the tool input payload
    let tool_input = request.tool_input.clone().unwrap_or(serde_json::json!({}));
    let parsed_run_id = RunId::parse(&run_id).unwrap_or_else(|_| RunId::new());
    let inspection_ctx = InspectionContext {
        run_id: parsed_run_id,
        tool_name: request.tool_name.clone(),
        tool_input: tool_input.clone(),
        estimated_cost_cents: request.estimated_cost_cents,
        // Schema-drift (Layer 0): the id of the tool's latest registered version,
        // whose input schema the boot-time guard holds. None when the tool is
        // unregistered / has no versions / has a malformed id — the layer skips.
        tool_version_id: inspection_tool_version_id(latest_version.as_ref()),
        // Behavioral-drift (Layer -1): the agent behind this run, so the monitor
        // can key its rolling baseline. None when the agent version is missing /
        // malformed — the layer skips.
        agent_id: inspection_agent_id(agent_version.as_ref()),
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

    let mut audit_details = serde_json::json!({
        "tool_name": request.tool_name,
        "decision": format!("{:?}", decision.kind),
        "effective_decision": format!("{:?}", combined_kind),
        "reason": decision.reason,
        "reversibility": reversibility.as_str(),
        "response_level": response_level.as_str(),
        "response_rung": response_level.rung(),
        "budget_headroom": has_headroom,
        "airlock_risk_score": airlock_result.risk_score,
        "airlock_blocked": !airlock_result.allowed,
    });
    // MCP SEP-414: record the extracted W3C trace linkage on the persisted
    // decision record so an audit query can join this policy decision to its
    // distributed trace. The trace-id + parent span-id also go on the dedicated
    // `audit_events.trace_id`/`span_id` columns (below) for a first-class join.
    if let Some(tc) = &mcp_trace_parent {
        if let Some(obj) = audit_details.as_object_mut() {
            obj.insert(
                "trace_context".to_string(),
                serde_json::json!({
                    "trace_id": tc.trace_id,
                    "parent_span_id": tc.parent_id,
                    "sampled": tc.sampled,
                    "dropped": tc.dropped,
                    "anchor": fd_otel::MCP_TRACE_CONTEXT_ANCHOR,
                }),
            );
        }
    }
    let mut audit_builder = AuditEventBuilder::new(audit_action, resource::RUN)
        .actor(actor::SYSTEM, None)
        .resource_id(&run_id)
        .run(&run_id)
        .project(&run.project_id)
        .details(audit_details);
    if let Some(tc) = &mcp_trace_parent {
        audit_builder = audit_builder.trace(tc.trace_id.clone(), tc.parent_id.clone());
    }
    repos.spawn_audit(audit_builder.build());

    // Step 6: Determine final allowed status, using the reversibility-folded
    // decision (`combined_kind`) rather than the raw allowlist decision — so a
    // tool the allowlist would `Allow` but whose reversibility demands a gate
    // correctly reports `requires_approval` / not-immediately-allowed.
    // Tool is allowed if: policy allows AND (airlock allows OR shadow mode).
    let policy_allowed = matches!(
        combined_kind,
        fd_policy::PolicyDecisionKind::Allow | fd_policy::PolicyDecisionKind::AllowWithWarning
    );
    let requires_approval = matches!(
        combined_kind,
        fd_policy::PolicyDecisionKind::RequiresApproval
    );
    let airlock_blocked = !airlock_result.allowed;
    let final_allowed = policy_allowed && !airlock_blocked;

    // Reason shown when the reversibility ladder (not the allowlist) is what
    // gated the call, so the operator sees *why* approval is now required.
    let ladder_upgraded = combined_kind != decision.kind;

    // Emit the effective enforcement decision as an OTel GenAI span so every
    // allow/deny/approval is queryable in Jaeger, not just logged. The span
    // name + `gen_ai.*` keys follow the GenAI semconv and flip under
    // `OTEL_SEMCONV_STABILITY_OPT_IN`; the `ferrumdeck.*` decision attrs are
    // stable. This is a sibling signal to the audit event above — the audit
    // trail is the immutable record, the span is the trace-queryable one.
    let decision_outcome = if requires_approval {
        fd_otel::DecisionOutcome::Approval
    } else if final_allowed {
        fd_otel::DecisionOutcome::Allow
    } else {
        fd_otel::DecisionOutcome::Deny
    };
    let decision_span_reason: String = if !final_allowed && airlock_blocked {
        airlock_result
            .violation
            .as_ref()
            .map(|v| v.details.clone())
            .unwrap_or_else(|| decision.reason.clone())
    } else if ladder_upgraded && requires_approval {
        format!(
            "reversibility ladder ({}, {}) requires approval: {}",
            reversibility.as_str(),
            response_level.rung(),
            decision.reason
        )
    } else {
        decision.reason.clone()
    };
    let decision_call_id = decision.id.to_string();
    fd_otel::emit_tool_decision_span(
        semconv,
        &request.tool_name,
        decision_outcome,
        &decision_span_reason,
        Some(response_level.rung()),
        effective_budget.cost_remaining_cents(&usage),
        Some(decision_call_id.as_str()),
        // Colorado SB 26-189 ADMT rule is a library-level enforcement rule (like
        // Art.50) and is not wired into this tool-policy path; no flag here.
        None,
        // MCP SEP-414: parent the decision span onto the caller's W3C trace
        // context (None unless opted in and a valid traceparent was sent).
        mcp_trace_parent.as_ref(),
    );

    // Step 7: Persist run state. Always record the chosen response level (so the
    // polled run console can render it); additionally mark the run blocked when
    // the call cannot proceed.
    let response_level_str = response_level.as_str().to_string();
    if !final_allowed {
        let (status, reason) = if !policy_allowed {
            let base = if ladder_upgraded {
                format!(
                    "reversibility ladder ({}, {}) requires approval: {}",
                    reversibility.as_str(),
                    response_level.rung(),
                    decision.reason
                )
            } else {
                decision.reason.clone()
            };
            (RunStatus::PolicyBlocked, base)
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
            response_level = %response_level_str,
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
                    response_level: Some(response_level_str.clone()),
                    ..Default::default()
                },
            )
            .await?;
    } else {
        // Allowed: still record the response level for the run console.
        repos
            .runs()
            .update(
                &run_id,
                UpdateRun {
                    response_level: Some(response_level_str.clone()),
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

    // Take the explanation trace before we consume `decision.reason` /
    // `decision.id` below — keeps the field-move pattern simple.
    let decision_trace = decision.trace.clone();

    Ok(Json(CheckToolResponse {
        allowed: final_allowed,
        requires_approval,
        decision_id: decision.id.to_string(),
        reason: if !final_allowed && airlock_blocked {
            airlock_result
                .violation
                .as_ref()
                .map(|v| v.details.clone())
                .unwrap_or(decision.reason)
        } else if ladder_upgraded && requires_approval {
            format!(
                "reversibility ladder ({}, {}) requires approval: {}",
                reversibility.as_str(),
                response_level.rung(),
                decision.reason
            )
        } else {
            decision.reason
        },
        risk_score: airlock_result.risk_score,
        risk_level: airlock_result.risk_level.as_str().to_string(),
        violation_type,
        violation_details,
        blocked_by_airlock: airlock_blocked,
        shadow_mode: airlock_result.shadow_mode,
        decision_trace,
        reversibility: reversibility.as_str().to_string(),
        response_level: response_level_str,
    }))
}

/// Resolve the effective budget a run is held to.
///
/// Precedence: an explicit per-run `config.budget` override wins; otherwise the
/// run's agent-version caps apply (if it set any); otherwise the engine default.
/// The auto-kill check and the forecast both evaluate against this, so per-agent
/// and per-run budget caps actually bound the run instead of a single
/// process-global default.
fn resolve_run_budget(
    run_config: &serde_json::Value,
    agent_version: Option<&AgentVersion>,
    default: &Budget,
) -> Budget {
    // 1. Explicit per-run override: config.budget. Partial objects are allowed —
    //    unset axes deserialize to None (unlimited for that axis).
    if let Some(raw) = run_config.get("budget") {
        if let Ok(budget) = serde_json::from_value::<Budget>(raw.clone()) {
            return budget;
        }
    }

    // 2. Agent-version caps, if the agent configured any.
    if let Some(av) = agent_version {
        let has_cap = av.max_tokens.is_some()
            || av.max_tool_calls.is_some()
            || av.max_wall_time_secs.is_some()
            || av.max_cost_cents.is_some();
        if has_cap {
            return Budget {
                max_input_tokens: None,
                max_output_tokens: None,
                max_total_tokens: av.max_tokens.map(|v| v.max(0) as u64),
                max_tool_calls: av.max_tool_calls.map(|v| v.max(0) as u32),
                max_wall_time_ms: av.max_wall_time_secs.map(|v| (v.max(0) as u64) * 1000),
                max_cost_cents: av.max_cost_cents.map(|v| v.max(0) as u64),
            };
        }
    }

    // 3. Engine default.
    default.clone()
}

#[cfg(test)]
mod budget_resolution_tests {
    use super::resolve_run_budget;
    use fd_policy::budget::Budget;
    use fd_storage::models::AgentVersion;

    fn agent_version_with_caps(
        max_tokens: Option<i32>,
        max_cost_cents: Option<i32>,
    ) -> AgentVersion {
        AgentVersion {
            id: "agv_test".into(),
            agent_id: "agt_test".into(),
            version: "1.0.0".into(),
            system_prompt: String::new(),
            model: "claude-sonnet-4-20250514".into(),
            model_params: serde_json::json!({}),
            allowed_tools: vec![],
            approval_required_tools: vec![],
            denied_tools: vec![],
            tool_configs: serde_json::json!({}),
            max_tokens,
            max_tool_calls: None,
            max_wall_time_secs: None,
            max_cost_cents,
            changelog: None,
            created_at: chrono::Utc::now(),
            created_by: None,
        }
    }

    #[test]
    fn per_run_config_override_wins() {
        let config = serde_json::json!({ "budget": { "max_cost_cents": 42 } });
        let av = agent_version_with_caps(Some(10_000), Some(999));
        let budget = resolve_run_budget(&config, Some(&av), &Budget::default());
        // The explicit per-run override beats agent caps and the default.
        assert_eq!(budget.max_cost_cents, Some(42));
        // Axes absent from the partial override are unlimited, not inherited.
        assert_eq!(budget.max_total_tokens, None);
    }

    #[test]
    fn agent_caps_used_when_no_override() {
        let config = serde_json::json!({});
        let av = agent_version_with_caps(Some(75_000), Some(100));
        let budget = resolve_run_budget(&config, Some(&av), &Budget::default());
        assert_eq!(budget.max_total_tokens, Some(75_000));
        assert_eq!(budget.max_cost_cents, Some(100));
    }

    #[test]
    fn falls_back_to_default_when_no_override_and_no_caps() {
        let config = serde_json::json!({});
        let av = agent_version_with_caps(None, None);
        let default = Budget::default();
        let budget = resolve_run_budget(&config, Some(&av), &default);
        assert_eq!(budget.max_cost_cents, default.max_cost_cents);
        assert_eq!(budget.max_total_tokens, default.max_total_tokens);
    }

    #[test]
    fn falls_back_to_default_when_no_agent_version() {
        let config = serde_json::json!({});
        let default = Budget::default();
        let budget = resolve_run_budget(&config, None, &default);
        assert_eq!(budget.max_cost_cents, default.max_cost_cents);
    }
}

/// Unit tests for the two pure derivations that thread the Airlock drift
/// signals' ids into the inspection context. These decide whether the
/// schema-drift (Layer 0) and behavioral-drift (Layer -1) layers fire at all:
/// a `None` return makes the layer skip (fail-open for the SIGNAL), a `Some`
/// return arms it.
#[cfg(test)]
mod airlock_id_derivation_tests {
    use super::{inspection_agent_id, inspection_tool_version_id};
    use fd_core::{AgentId, ToolVersionId};
    use fd_storage::models::{AgentVersion, ToolVersion};

    fn tool_version_with_id(id: &str) -> ToolVersion {
        ToolVersion {
            id: id.into(),
            tool_id: "tol_test".into(),
            version: "1.0.0".into(),
            input_schema: serde_json::json!({ "type": "object" }),
            output_schema: None,
            changelog: None,
            created_at: chrono::Utc::now(),
        }
    }

    fn agent_version_with_agent_id(agent_id: &str) -> AgentVersion {
        AgentVersion {
            id: "agv_test".into(),
            agent_id: agent_id.into(),
            version: "1.0.0".into(),
            system_prompt: String::new(),
            model: "claude-sonnet-4-20250514".into(),
            model_params: serde_json::json!({}),
            allowed_tools: vec![],
            approval_required_tools: vec![],
            denied_tools: vec![],
            tool_configs: serde_json::json!({}),
            max_tokens: None,
            max_tool_calls: None,
            max_wall_time_secs: None,
            max_cost_cents: None,
            changelog: None,
            created_at: chrono::Utc::now(),
            created_by: None,
        }
    }

    #[test]
    fn tool_version_id_none_when_absent() {
        // No registered version → schema-drift layer skips.
        assert!(inspection_tool_version_id(None).is_none());
    }

    #[test]
    fn tool_version_id_none_when_malformed() {
        // A row whose id is not a valid ToolVersionId must not arm the layer.
        let tv = tool_version_with_id("not-a-valid-id");
        assert!(inspection_tool_version_id(Some(&tv)).is_none());
    }

    #[test]
    fn tool_version_id_parsed_when_valid() {
        let valid = ToolVersionId::new();
        let tv = tool_version_with_id(&valid.to_string());
        assert_eq!(inspection_tool_version_id(Some(&tv)), Some(valid));
    }

    #[test]
    fn agent_id_none_when_absent() {
        // No agent version → behavioral-drift layer skips.
        assert!(inspection_agent_id(None).is_none());
    }

    #[test]
    fn agent_id_none_when_malformed() {
        let av = agent_version_with_agent_id("agt_not_a_ulid");
        assert!(inspection_agent_id(Some(&av)).is_none());
    }

    #[test]
    fn agent_id_parsed_from_agent_version() {
        let valid = AgentId::new();
        let av = agent_version_with_agent_id(&valid.to_string());
        assert_eq!(inspection_agent_id(Some(&av)), Some(valid));
    }
}

/// Integration test for the *live* coherence-divergence consumer: it drives a
/// divergent multi-step trajectory through the exact functions the
/// `submit_step_result` handler calls — `step_trajectory_events` (step →
/// trajectory projection), the streaming `CoherenceMonitor::observe_event`, and
/// `coherence_audit_event` (span → audit event) — and asserts the produced
/// `audit_events` record carries `violation_type = coherence_divergence` on the
/// shared `airlock.violation_detected` path. This exercises the wiring end-to-
/// end at the audit-record boundary without a live Postgres (the DB write is a
/// verbatim `AuditRepo::create` of the same record via `spawn_audit`).
#[cfg(test)]
mod coherence_live_consumer_tests {
    use super::{coherence_audit_event, step_trajectory_events};
    use chrono::Utc;
    use fd_core::RunId;
    use fd_policy::reversibility::ResponseLevel;
    use fd_policy::{CoherenceConfig, CoherenceMonitor};
    use fd_storage::models::{Step, StepStatus, StepType};

    fn tool_step(number: i32, name: &str, output: &str) -> Step {
        Step {
            id: format!("stp_{number}"),
            run_id: "run_x".into(),
            parent_step_id: None,
            step_number: number,
            step_type: StepType::Tool,
            input: serde_json::json!({ "cmd": name }),
            output: Some(serde_json::json!(output)),
            tool_name: Some(name.to_string()),
            tool_version: None,
            model: None,
            input_tokens: None,
            output_tokens: None,
            status: StepStatus::Completed,
            error: None,
            created_at: Utc::now(),
            started_at: None,
            completed_at: Some(Utc::now()),
            span_id: None,
        }
    }

    /// The canonical divergence: a tool step reports "tests failing", the next
    /// tool step commits. Fed step-by-step through the live consumer, it must
    /// emit exactly one `airlock.violation_detected` audit record whose details
    /// carry `violation_type = coherence_divergence`.
    #[tokio::test]
    async fn divergent_trajectory_produces_coherence_audit_record() {
        let monitor = CoherenceMonitor::new();
        let config = CoherenceConfig::default();
        let run_id = RunId::parse("run_x").unwrap_or_else(|_| RunId::new());
        let project_id = "prj_test";

        let trajectory = [
            tool_step(1, "run_tests", "2 tests failed: assertion error"),
            tool_step(2, "git_commit", "committing the change"),
        ];

        // Mirror the handler's per-step loop exactly (shadow mode: enforce=false).
        let mut audit_records = Vec::new();
        for step in &trajectory {
            for event in step_trajectory_events(step) {
                if let Some(span) = monitor.observe_event(&run_id, &event, &config).await {
                    let level = span.response_level();
                    // shadow mode → never gated
                    audit_records.push(coherence_audit_event(
                        "run_x", project_id, &span, level, false, false,
                    ));
                }
            }
        }

        assert_eq!(
            audit_records.len(),
            1,
            "exactly one divergence audit record expected: {audit_records:?}"
        );
        let record = &audit_records[0];
        assert_eq!(record.action, "airlock.violation_detected");
        assert_eq!(record.resource_type, "run");
        assert_eq!(record.run_id.as_deref(), Some("run_x"));
        assert_eq!(record.project_id.as_deref(), Some(project_id));
        assert_eq!(
            record.details["violation_type"], "coherence_divergence",
            "audit row must carry violation_type = coherence_divergence: {}",
            record.details
        );
        // The full evidence rides the same `details` payload.
        assert_eq!(record.details["blocked"], false, "surfaces, never blocks");
        assert_eq!(
            record.details["coherence"]["category"], "test_failure",
            "the stated-fact category is preserved in the record"
        );
        // The graduated-response rung rides the same record. Default severity
        // (risk_score 70 → High) maps to R3; in shadow mode it is recorded but
        // not gated.
        assert_eq!(record.details["response_level"], "require_approval");
        assert_eq!(record.details["response_rung"], "R3");
        assert_eq!(record.details["mode"], "shadow");
        assert_eq!(record.details["gated"], false);
    }

    /// In `enforce` mode the same divergence maps to R3 and the record is
    /// `gated = true` (the run halts for human review) — the enforce wedge.
    #[tokio::test]
    async fn enforce_mode_gates_r3_divergence() {
        let monitor = CoherenceMonitor::new();
        let config = CoherenceConfig::default();
        let run_id = RunId::parse("run_e").unwrap_or_else(|_| RunId::new());
        let trajectory = [
            tool_step(1, "run_tests", "2 tests failed: assertion error"),
            tool_step(2, "git_commit", "committing the change"),
        ];
        let mut gated_any = false;
        for step in &trajectory {
            for event in step_trajectory_events(step) {
                if let Some(span) = monitor.observe_event(&run_id, &event, &config).await {
                    let level = span.response_level();
                    let gate = level == ResponseLevel::RequireApproval; // enforce
                    gated_any |= gate;
                    let rec = coherence_audit_event("run_e", "prj_test", &span, level, true, gate);
                    assert_eq!(rec.details["mode"], "enforce");
                    assert_eq!(rec.details["gated"], true);
                    assert_eq!(rec.details["blocked"], true);
                }
            }
        }
        assert!(gated_any, "an R3 divergence must gate in enforce mode");
    }

    /// A coherent run — states the failure, resolves it, then commits — must
    /// produce NO coherence audit record through the same live consumer.
    #[tokio::test]
    async fn coherent_trajectory_produces_no_audit_record() {
        let monitor = CoherenceMonitor::new();
        let config = CoherenceConfig::default();
        let run_id = RunId::parse("run_ok").unwrap_or_else(|_| RunId::new());

        let trajectory = [
            tool_step(1, "run_tests", "tests failing: 1 assertion"),
            tool_step(2, "edit_file", "all tests pass now"),
            tool_step(3, "git_commit", "commit the fix"),
        ];

        let mut count = 0usize;
        for step in &trajectory {
            for event in step_trajectory_events(step) {
                if monitor
                    .observe_event(&run_id, &event, &config)
                    .await
                    .is_some()
                {
                    count += 1;
                }
            }
        }
        assert_eq!(count, 0, "a resolved trajectory must not fire");
    }
}
