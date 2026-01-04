//! Health check handlers

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use tracing::{debug, warn};
use utoipa::ToSchema;

use crate::state::AppState;

/// Basic health check response (no dependencies)
#[derive(Serialize, ToSchema)]
pub struct HealthResponse {
    /// Service health status
    #[schema(example = "healthy")]
    pub status: &'static str,
    /// Service version
    #[schema(example = "0.1.0")]
    pub version: &'static str,
}

/// Detailed readiness check response with component status
#[derive(Serialize, ToSchema)]
pub struct ReadinessResponse {
    /// Overall readiness status
    #[schema(example = "ready")]
    pub status: &'static str,
    /// Service version
    #[schema(example = "0.1.0")]
    pub version: &'static str,
    /// Individual component health status
    pub components: ComponentStatus,
}

/// Health status of all backend components
#[derive(Serialize, ToSchema)]
pub struct ComponentStatus {
    /// Database (PostgreSQL) health
    pub database: ComponentHealth,
    /// Redis health
    pub redis: ComponentHealth,
}

/// Health status of an individual component
#[derive(Serialize, ToSchema)]
pub struct ComponentHealth {
    /// Component health status
    #[schema(example = "healthy")]
    pub status: &'static str,
    /// Response latency in milliseconds
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(example = 5)]
    pub latency_ms: Option<u64>,
    /// Error message if unhealthy
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Liveness probe - just checks if the service is running
/// Does not check dependencies (useful for Kubernetes liveness probes)
#[utoipa::path(
    get,
    path = "/health",
    tag = "health",
    responses(
        (status = 200, description = "Service is alive", body = HealthResponse)
    )
)]
pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Readiness probe - checks if the service can handle requests
/// Verifies database and Redis connectivity
#[utoipa::path(
    get,
    path = "/ready",
    tag = "health",
    responses(
        (status = 200, description = "Service is ready to handle requests", body = ReadinessResponse),
        (status = 503, description = "Service is not ready", body = ReadinessResponse)
    )
)]
pub async fn readiness_check(
    State(state): State<AppState>,
) -> Result<Json<ReadinessResponse>, (StatusCode, Json<ReadinessResponse>)> {
    let start = std::time::Instant::now();

    // Check database connectivity
    let db_health = check_database(&state).await;
    let db_latency = start.elapsed().as_millis() as u64;

    let redis_start = std::time::Instant::now();
    // Check Redis connectivity
    let redis_health = check_redis(&state).await;
    let redis_latency = redis_start.elapsed().as_millis() as u64;

    let db_status = ComponentHealth {
        status: if db_health.is_ok() {
            "healthy"
        } else {
            "unhealthy"
        },
        latency_ms: Some(db_latency),
        error: db_health.err(),
    };

    let redis_status = ComponentHealth {
        status: if redis_health.is_ok() {
            "healthy"
        } else {
            "unhealthy"
        },
        latency_ms: Some(redis_latency),
        error: redis_health.err(),
    };

    let all_healthy = db_status.status == "healthy" && redis_status.status == "healthy";

    let response = ReadinessResponse {
        status: if all_healthy { "ready" } else { "not_ready" },
        version: env!("CARGO_PKG_VERSION"),
        components: ComponentStatus {
            database: db_status,
            redis: redis_status,
        },
    };

    if all_healthy {
        debug!("Readiness check passed");
        Ok(Json(response))
    } else {
        warn!("Readiness check failed: one or more components unhealthy");
        Err((StatusCode::SERVICE_UNAVAILABLE, Json(response)))
    }
}

/// Check database connectivity by running a simple query
async fn check_database(state: &AppState) -> Result<(), String> {
    use sqlx::Row;

    let result: Result<i32, sqlx::Error> = sqlx::query("SELECT 1 as health_check")
        .map(|row: sqlx::postgres::PgRow| row.get("health_check"))
        .fetch_one(&state.db)
        .await;

    match result {
        Ok(_) => Ok(()),
        Err(e) => {
            warn!(error = %e, "Database health check failed");
            Err(format!("Database connection failed: {}", e))
        }
    }
}

/// Check Redis connectivity by pinging the server
async fn check_redis(state: &AppState) -> Result<(), String> {
    // Try to get the queue length as a connectivity check
    // This exercises the Redis connection without modifying data
    // Note: No locking required - QueueClient uses multiplexed connection
    match state.queue.len("steps").await {
        Ok(_) => Ok(()),
        Err(e) => {
            warn!(error = %e, "Redis health check failed");
            Err(format!("Redis connection failed: {}", e))
        }
    }
}
