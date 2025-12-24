//! Registry handlers for agents and tools

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use fd_storage::models::{
    AgentStatus, CreateAgent, CreateAgentVersion, CreateTool, CreateToolVersion, ToolRiskLevel,
};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use ulid::Ulid;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

// =============================================================================
// Agent DTOs
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateAgentRequest {
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateAgentVersionRequest {
    pub version: String,
    pub system_prompt: String,
    pub model: String,
    #[serde(default)]
    pub model_params: serde_json::Value,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub tool_configs: serde_json::Value,
    pub max_tokens: Option<i32>,
    pub max_tool_calls: Option<i32>,
    pub max_wall_time_secs: Option<i32>,
    pub max_cost_cents: Option<i32>,
    pub changelog: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct AgentResponse {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
    pub latest_version: Option<AgentVersionResponse>,
}

#[derive(Debug, Serialize)]
pub struct AgentVersionResponse {
    pub id: String,
    pub version: String,
    pub model: String,
    pub allowed_tools: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ListAgentsQuery {
    pub project_id: String,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    50
}

// =============================================================================
// Tool DTOs
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreateToolRequest {
    pub project_id: Option<String>,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub mcp_server: String,
    pub risk_level: String,
    pub input_schema: serde_json::Value,
    pub output_schema: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct ToolResponse {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub slug: String,
    pub description: Option<String>,
    pub mcp_server: String,
    pub status: String,
    pub risk_level: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct ListToolsQuery {
    pub project_id: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
}

// =============================================================================
// Helpers
// =============================================================================

fn agent_to_response(
    agent: fd_storage::models::Agent,
    latest_version: Option<fd_storage::models::AgentVersion>,
) -> AgentResponse {
    AgentResponse {
        id: agent.id,
        project_id: agent.project_id,
        name: agent.name,
        slug: agent.slug,
        description: agent.description,
        status: format!("{:?}", agent.status).to_lowercase(),
        created_at: agent.created_at.to_rfc3339(),
        latest_version: latest_version.map(|v| AgentVersionResponse {
            id: v.id,
            version: v.version,
            model: v.model,
            allowed_tools: v.allowed_tools,
            created_at: v.created_at.to_rfc3339(),
        }),
    }
}

fn tool_to_response(tool: fd_storage::models::Tool) -> ToolResponse {
    ToolResponse {
        id: tool.id,
        project_id: tool.project_id,
        name: tool.name,
        slug: tool.slug,
        description: tool.description,
        mcp_server: tool.mcp_server,
        status: format!("{:?}", tool.status).to_lowercase(),
        risk_level: format!("{:?}", tool.risk_level).to_lowercase(),
        created_at: tool.created_at.to_rfc3339(),
    }
}

// =============================================================================
// Agent Handlers
// =============================================================================

/// List agents for a project
#[instrument(skip(state, _auth))]
pub async fn list_agents(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListAgentsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let agents = repos
        .agents()
        .list_by_project(
            &query.project_id,
            Some(AgentStatus::Active),
            query.limit,
            query.offset,
        )
        .await?;

    let mut responses = Vec::new();
    for agent in agents {
        let latest = repos.agents().get_latest_version(&agent.id).await?;
        responses.push(agent_to_response(agent, latest));
    }

    Ok(Json(responses))
}

/// Create a new agent
#[instrument(skip(state, _auth))]
pub async fn create_agent(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Json(request): Json<CreateAgentRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let agent_id = format!("agt_{}", Ulid::new());

    let create = CreateAgent {
        id: agent_id,
        project_id: request.project_id,
        name: request.name,
        slug: request.slug,
        description: request.description,
    };

    let agent = state.repos().agents().create(create).await?;

    Ok((StatusCode::CREATED, Json(agent_to_response(agent, None))))
}

/// Get an agent by ID
#[instrument(skip(state, _auth))]
pub async fn get_agent(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(agent_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let agent = repos
        .agents()
        .get(&agent_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Agent", &agent_id))?;

    let latest = repos.agents().get_latest_version(&agent_id).await?;

    Ok(Json(agent_to_response(agent, latest)))
}

/// Create a new agent version
#[instrument(skip(state, auth))]
pub async fn create_agent_version(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(agent_id): Path<String>,
    Json(request): Json<CreateAgentVersionRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    // Verify agent exists
    repos
        .agents()
        .get(&agent_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Agent", &agent_id))?;

    let version_id = format!("agv_{}", Ulid::new());

    let create = CreateAgentVersion {
        id: version_id,
        agent_id,
        version: request.version,
        system_prompt: request.system_prompt,
        model: request.model,
        model_params: if request.model_params.is_null() {
            serde_json::json!({})
        } else {
            request.model_params
        },
        allowed_tools: request.allowed_tools,
        tool_configs: if request.tool_configs.is_null() {
            serde_json::json!({})
        } else {
            request.tool_configs
        },
        max_tokens: request.max_tokens,
        max_tool_calls: request.max_tool_calls,
        max_wall_time_secs: request.max_wall_time_secs,
        max_cost_cents: request.max_cost_cents,
        changelog: request.changelog,
        created_by: Some(auth.api_key_id),
    };

    let version = repos.agents().create_version(create).await?;

    let response = AgentVersionResponse {
        id: version.id,
        version: version.version,
        model: version.model,
        allowed_tools: version.allowed_tools,
        created_at: version.created_at.to_rfc3339(),
    };

    Ok((StatusCode::CREATED, Json(response)))
}

// =============================================================================
// Tool Handlers
// =============================================================================

/// List tools
#[instrument(skip(state, _auth))]
pub async fn list_tools(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListToolsQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let tools = state
        .repos()
        .tools()
        .list(query.project_id.as_deref(), None, query.limit, query.offset)
        .await?;

    let responses: Vec<ToolResponse> = tools.into_iter().map(tool_to_response).collect();

    Ok(Json(responses))
}

/// Create a new tool
#[instrument(skip(state, _auth))]
pub async fn create_tool(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Json(request): Json<CreateToolRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let repos = state.repos();

    let risk_level = match request.risk_level.as_str() {
        "read" => ToolRiskLevel::Read,
        "write" => ToolRiskLevel::Write,
        "destructive" => ToolRiskLevel::Destructive,
        _ => return Err(ApiError::bad_request("Invalid risk_level")),
    };

    let tool_id = format!("tol_{}", Ulid::new());
    let version_id = format!("tlv_{}", Ulid::new());

    let create_tool = CreateTool {
        id: tool_id.clone(),
        project_id: request.project_id,
        name: request.name,
        slug: request.slug,
        description: request.description,
        mcp_server: request.mcp_server,
        risk_level,
    };

    let tool = repos.tools().create(create_tool).await?;

    // Create initial version
    let create_version = CreateToolVersion {
        id: version_id,
        tool_id: tool_id.clone(),
        version: "1.0.0".to_string(),
        input_schema: request.input_schema,
        output_schema: request.output_schema,
        changelog: Some("Initial version".to_string()),
    };

    repos.tools().create_version(create_version).await?;

    Ok((StatusCode::CREATED, Json(tool_to_response(tool))))
}
