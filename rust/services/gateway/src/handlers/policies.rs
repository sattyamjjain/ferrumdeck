//! Policies handlers for policy rules management

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use fd_storage::models::{CreatePolicyRule, PolicyEffect, UpdatePolicyRule};
use serde::{Deserialize, Serialize};
use tracing::instrument;
use ulid::Ulid;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

// =============================================================================
// DTOs
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct CreatePolicyRuleRequest {
    pub project_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub priority: Option<i32>,
    pub conditions: serde_json::Value,
    pub effect: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePolicyRuleRequest {
    pub name: Option<String>,
    pub description: Option<String>,
    pub priority: Option<i32>,
    pub conditions: Option<serde_json::Value>,
    pub effect: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
pub struct PolicyRuleResponse {
    pub id: String,
    pub project_id: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub priority: i32,
    pub conditions: serde_json::Value,
    pub effect: String,
    pub enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub created_by: Option<String>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
pub struct ListPoliciesQuery {
    pub project_id: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: i64,
    #[serde(default)]
    pub offset: i64,
    pub status: Option<String>,
}

fn default_limit() -> i64 {
    50
}

// =============================================================================
// Helpers
// =============================================================================

fn effect_to_string(effect: PolicyEffect) -> String {
    match effect {
        PolicyEffect::Allow => "allow".to_string(),
        PolicyEffect::Deny => "deny".to_string(),
        PolicyEffect::RequireApproval => "require_approval".to_string(),
    }
}

fn string_to_effect(s: &str) -> Result<PolicyEffect, ApiError> {
    match s {
        "allow" => Ok(PolicyEffect::Allow),
        "deny" => Ok(PolicyEffect::Deny),
        "require_approval" => Ok(PolicyEffect::RequireApproval),
        _ => Err(ApiError::bad_request(format!(
            "Invalid effect '{}'. Must be one of: allow, deny, require_approval",
            s
        ))),
    }
}

fn policy_to_response(rule: fd_storage::models::PolicyRule) -> PolicyRuleResponse {
    PolicyRuleResponse {
        id: rule.id,
        project_id: rule.project_id,
        name: rule.name,
        description: rule.description,
        priority: rule.priority,
        conditions: rule.conditions,
        effect: effect_to_string(rule.effect),
        enabled: rule.enabled,
        created_at: rule.created_at.to_rfc3339(),
        updated_at: rule.updated_at.to_rfc3339(),
        created_by: rule.created_by,
    }
}

// =============================================================================
// Handlers
// =============================================================================

/// List policy rules
#[instrument(skip(state, _auth))]
pub async fn list_policies(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Query(query): Query<ListPoliciesQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let rules = state
        .repos()
        .policies()
        .list_rules(query.project_id.as_deref())
        .await?;

    let responses: Vec<PolicyRuleResponse> = rules.into_iter().map(policy_to_response).collect();

    Ok(Json(responses))
}

/// Get a specific policy rule
#[instrument(skip(state, _auth))]
pub async fn get_policy(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(policy_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let rule = state
        .repos()
        .policies()
        .get_rule(&policy_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Policy", &policy_id))?;

    Ok(Json(policy_to_response(rule)))
}

/// Create a new policy rule
#[instrument(skip(state, auth))]
pub async fn create_policy(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(request): Json<CreatePolicyRuleRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let effect = string_to_effect(&request.effect)?;
    let policy_id = format!("pol_{}", Ulid::new());

    let create = CreatePolicyRule {
        id: policy_id,
        project_id: request.project_id,
        name: request.name,
        description: request.description,
        priority: request.priority.unwrap_or(100),
        conditions: request.conditions,
        effect,
        created_by: Some(auth.api_key_id),
    };

    let rule = state.repos().policies().create_rule(create).await?;

    Ok((StatusCode::CREATED, Json(policy_to_response(rule))))
}

/// Update a policy rule
#[instrument(skip(state, _auth))]
pub async fn update_policy(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(policy_id): Path<String>,
    Json(request): Json<UpdatePolicyRuleRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Verify policy exists
    state
        .repos()
        .policies()
        .get_rule(&policy_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Policy", &policy_id))?;

    let effect = if let Some(e) = &request.effect {
        Some(string_to_effect(e)?)
    } else {
        None
    };

    let update = UpdatePolicyRule {
        name: request.name,
        description: request.description,
        priority: request.priority,
        conditions: request.conditions,
        effect,
        enabled: request.enabled,
    };

    let rule = state
        .repos()
        .policies()
        .update_rule(&policy_id, update)
        .await?
        .ok_or_else(|| ApiError::not_found("Policy", &policy_id))?;

    Ok(Json(policy_to_response(rule)))
}

/// Delete a policy rule (disable it)
#[instrument(skip(state, _auth))]
pub async fn delete_policy(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(policy_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    // Disable the policy instead of hard delete
    let update = UpdatePolicyRule {
        enabled: Some(false),
        ..Default::default()
    };

    state
        .repos()
        .policies()
        .update_rule(&policy_id, update)
        .await?
        .ok_or_else(|| ApiError::not_found("Policy", &policy_id))?;

    Ok(StatusCode::NO_CONTENT)
}
