//! API Keys handlers

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::IntoResponse,
    Extension, Json,
};
use serde::{Deserialize, Serialize};
use tracing::instrument;

use crate::handlers::ApiError;
use crate::middleware::AuthContext;
use crate::state::AppState;

// =============================================================================
// DTOs
// =============================================================================

#[derive(Debug, Deserialize)]
pub struct ListApiKeysQuery {
    pub project_id: Option<String>,
    #[serde(default)]
    pub include_revoked: bool,
}

#[derive(Debug, Serialize)]
pub struct ApiKeyResponse {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub created_at: String,
    pub last_used_at: Option<String>,
    pub expires_at: Option<String>,
    pub revoked_at: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateApiKeyRequest {
    pub name: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub expires_at: Option<String>,
}

// =============================================================================
// Handlers
// =============================================================================

/// List API keys for the current tenant
#[instrument(skip(state, auth))]
pub async fn list_api_keys(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Query(query): Query<ListApiKeysQuery>,
) -> Result<impl IntoResponse, ApiError> {
    let keys = state
        .repos()
        .api_keys()
        .list_by_tenant(&auth.tenant_id, query.include_revoked)
        .await?;

    let responses: Vec<ApiKeyResponse> = keys
        .into_iter()
        .map(|k| ApiKeyResponse {
            id: k.id,
            name: k.name,
            key_prefix: k.key_prefix,
            scopes: k.scopes,
            created_at: k.created_at.to_rfc3339(),
            last_used_at: k.last_used_at.map(|t| t.to_rfc3339()),
            expires_at: k.expires_at.map(|t| t.to_rfc3339()),
            revoked_at: k.revoked_at.map(|t| t.to_rfc3339()),
        })
        .collect();

    Ok(Json(responses))
}

/// Get a single API key
#[instrument(skip(state, _auth))]
pub async fn get_api_key(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(key_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let key = state
        .repos()
        .api_keys()
        .get(&key_id)
        .await?
        .ok_or_else(|| ApiError::not_found("ApiKey", &key_id))?;

    let response = ApiKeyResponse {
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        scopes: key.scopes,
        created_at: key.created_at.to_rfc3339(),
        last_used_at: key.last_used_at.map(|t| t.to_rfc3339()),
        expires_at: key.expires_at.map(|t| t.to_rfc3339()),
        revoked_at: key.revoked_at.map(|t| t.to_rfc3339()),
    };

    Ok(Json(response))
}

/// Revoke an API key
#[instrument(skip(state, _auth))]
pub async fn revoke_api_key(
    State(state): State<AppState>,
    Extension(_auth): Extension<AuthContext>,
    Path(key_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let key = state
        .repos()
        .api_keys()
        .revoke(&key_id)
        .await?
        .ok_or_else(|| ApiError::not_found("ApiKey", &key_id))?;

    let response = ApiKeyResponse {
        id: key.id,
        name: key.name,
        key_prefix: key.key_prefix,
        scopes: key.scopes,
        created_at: key.created_at.to_rfc3339(),
        last_used_at: key.last_used_at.map(|t| t.to_rfc3339()),
        expires_at: key.expires_at.map(|t| t.to_rfc3339()),
        revoked_at: key.revoked_at.map(|t| t.to_rfc3339()),
    };

    Ok((StatusCode::OK, Json(response)))
}
