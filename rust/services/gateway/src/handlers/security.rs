//! Security and Airlock handlers

use axum::{extract::State, Json};
use fd_policy::AirlockMode;
use fd_storage::models::threats::Threat;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::handlers::{ApiError, ValidatedQuery};
use crate::state::AppState;

// =============================================================================
// Request/Response Types
// =============================================================================

/// Query parameters for listing threats
#[derive(Debug, Clone, Deserialize, Validate)]
pub struct ListThreatsQuery {
    /// Filter by run ID
    pub run_id: Option<String>,
    /// Filter by risk level (low, medium, high, critical)
    pub risk_level: Option<String>,
    /// Filter by violation type
    pub violation_type: Option<String>,
    /// Filter by action (blocked, logged)
    pub action: Option<String>,
    /// Max results to return (default 50, max 100)
    #[validate(range(min = 1, max = 100, message = "limit must be between 1 and 100"))]
    #[serde(default = "default_limit")]
    pub limit: i64,
    /// Offset for pagination
    #[validate(range(min = 0, message = "offset must be non-negative"))]
    #[serde(default)]
    pub offset: i64,
}

fn default_limit() -> i64 {
    50
}

/// Response for listing threats
#[derive(Debug, Serialize)]
pub struct ListThreatsResponse {
    pub threats: Vec<Threat>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

/// Airlock configuration response
#[derive(Debug, Serialize)]
pub struct AirlockConfigResponse {
    pub mode: String,
    pub rce_detection_enabled: bool,
    pub velocity_tracking_enabled: bool,
    pub exfiltration_shield_enabled: bool,
    pub max_cost_cents_per_window: u64,
    pub velocity_window_seconds: u64,
    pub loop_threshold: u32,
    pub allowed_domains: Vec<String>,
    pub block_ip_addresses: bool,
}

/// Request to update Airlock configuration
#[derive(Debug, Deserialize, Validate)]
pub struct UpdateAirlockConfigRequest {
    /// Mode: "shadow" or "enforce"
    pub mode: Option<String>,
}

// =============================================================================
// Handlers
// =============================================================================

/// List security threats
///
/// GET /v1/security/threats
#[axum::debug_handler]
pub async fn list_threats(
    State(state): State<AppState>,
    ValidatedQuery(query): ValidatedQuery<ListThreatsQuery>,
) -> Result<Json<ListThreatsResponse>, ApiError> {
    let threats_repo = state.repos().threats();

    // Get threats with filtering
    let threats = threats_repo
        .list_all(
            query.run_id.as_deref(),
            query.risk_level.as_deref(),
            query.violation_type.as_deref(),
            query.action.as_deref(),
            query.limit,
            query.offset,
        )
        .await?;

    // Get total count for pagination
    let total = threats_repo
        .count_all(
            query.run_id.as_deref(),
            query.risk_level.as_deref(),
            query.violation_type.as_deref(),
            query.action.as_deref(),
        )
        .await?;

    Ok(Json(ListThreatsResponse {
        threats,
        total,
        limit: query.limit,
        offset: query.offset,
    }))
}

/// Get a specific threat by ID
///
/// GET /v1/security/threats/{threat_id}
#[axum::debug_handler]
pub async fn get_threat(
    State(state): State<AppState>,
    axum::extract::Path(threat_id): axum::extract::Path<String>,
) -> Result<Json<Threat>, ApiError> {
    let threats_repo = state.repos().threats();

    let threat = threats_repo
        .get(&threat_id)
        .await?
        .ok_or_else(|| ApiError::not_found("Threat", &threat_id))?;

    Ok(Json(threat))
}

/// Get Airlock configuration
///
/// GET /v1/security/config
#[axum::debug_handler]
pub async fn get_config(State(state): State<AppState>) -> Json<AirlockConfigResponse> {
    let config = state.airlock.config();

    Json(AirlockConfigResponse {
        mode: match config.mode {
            AirlockMode::Shadow => "shadow".to_string(),
            AirlockMode::Enforce => "enforce".to_string(),
        },
        rce_detection_enabled: config.rce.enabled,
        velocity_tracking_enabled: config.velocity.enabled,
        exfiltration_shield_enabled: config.exfiltration.enabled,
        max_cost_cents_per_window: config.velocity.max_cost_cents,
        velocity_window_seconds: config.velocity.window_seconds,
        loop_threshold: config.velocity.loop_threshold,
        allowed_domains: config.exfiltration.allowed_domains.clone(),
        block_ip_addresses: config.exfiltration.block_ip_addresses,
    })
}

/// Update Airlock configuration (mode only for now)
///
/// PUT /v1/security/config
#[axum::debug_handler]
pub async fn update_config(
    State(_state): State<AppState>,
    Json(request): Json<UpdateAirlockConfigRequest>,
) -> Result<Json<AirlockConfigResponse>, ApiError> {
    // Note: In a real implementation, this would update the config in Redis or DB
    // and the Airlock inspector would reload it. For now, we just validate
    // and return the requested config (mode changes require restart).

    if let Some(mode) = &request.mode {
        if mode != "shadow" && mode != "enforce" {
            return Err(ApiError::bad_request(
                "Invalid mode. Must be 'shadow' or 'enforce'",
            ));
        }
    }

    // For now, return success but note that actual mode changes require restart
    // A full implementation would store in DB and have the inspector reload
    Ok(Json(AirlockConfigResponse {
        mode: request.mode.unwrap_or_else(|| "shadow".to_string()),
        rce_detection_enabled: true,
        velocity_tracking_enabled: true,
        exfiltration_shield_enabled: true,
        max_cost_cents_per_window: 100,
        velocity_window_seconds: 10,
        loop_threshold: 3,
        allowed_domains: vec!["github.com".to_string(), "api.anthropic.com".to_string()],
        block_ip_addresses: true,
    }))
}
