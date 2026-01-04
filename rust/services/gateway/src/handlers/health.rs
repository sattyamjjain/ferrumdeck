//! Health check handlers

use axum::{extract::State, http::StatusCode, Json};
use serde::Serialize;
use tracing::{debug, warn};

use crate::state::AppState;

/// Basic health check response (no dependencies)
#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

/// Detailed readiness check response with component status
#[derive(Serialize)]
pub struct ReadinessResponse {
    pub status: &'static str,
    pub version: &'static str,
    pub components: ComponentStatus,
}

#[derive(Serialize)]
pub struct ComponentStatus {
    pub database: ComponentHealth,
    pub redis: ComponentHealth,
}

#[derive(Serialize)]
pub struct ComponentHealth {
    pub status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Liveness probe - just checks if the service is running
/// Does not check dependencies (useful for Kubernetes liveness probes)
pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        version: env!("CARGO_PKG_VERSION"),
    })
}

/// Readiness probe - checks if the service can handle requests
/// Verifies database and Redis connectivity
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
