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
    /// What the two NAME-MATCHED Airlock layers actually inspect here.
    ///
    /// Reported because both filter by tool name before doing any work: a tool
    /// not on a layer's `target_tools` is never inspected by it. Both default
    /// to empty (= inspect everything) as of 0.8.12, but narrowing is still
    /// allowed, and a narrowed layer covering nothing is invisible in logs
    /// after boot. So it is a field.
    pub airlock_coverage: AirlockCoverageReport,
    /// Realtime push (issue #5): how many events this process has published
    /// since it started.
    ///
    /// Reported for the same reason `airlock_coverage` is. The dashboard's SSE
    /// channel carried heartbeats only for a long time, and a stream that is
    /// connected but silent looks identical to one that is connected and has
    /// nothing to say. This number tells an operator which it is without
    /// reading logs: still `0` after traffic has flowed means the push path is
    /// not wired, not that nothing happened.
    pub realtime_events_published: u64,
}

/// Coverage for every name-matched Airlock layer.
#[derive(Serialize, ToSchema)]
pub struct AirlockCoverageReport {
    /// Airlock Layer 1 — anti-RCE pattern matching.
    pub anti_rce: LayerCoverageReport,
    /// Airlock Layer 3 — exfiltration shield + credential DLP.
    pub exfiltration: LayerCoverageReport,
}

/// One name-matched layer's coverage of the registered tool set.
#[derive(Serialize, ToSchema)]
pub struct LayerCoverageReport {
    /// `full` | `partial` | `blind` | `disabled` | `no_tools_registered`.
    /// **`blind` means tools are registered and none of them is inspected.**
    #[schema(example = "blind")]
    pub status: &'static str,
    /// One line stating the consequence, suitable for an alert body.
    pub summary: String,
    /// How many tools the registry holds.
    pub registered_tools: usize,
    /// Registered tools Layer 1 will pattern-scan.
    pub inspected: Vec<String>,
    /// Registered tools Layer 1 will NOT pattern-scan.
    pub uninspected: Vec<String>,
    /// The configured `target_tools` list, so the two can be compared here.
    /// **Empty means every tool is inspected** — that is the default.
    pub target_tools: Vec<String>,
}

impl LayerCoverageReport {
    fn from(c: &fd_policy::airlock::LayerCoverage) -> Self {
        Self {
            status: c.status().as_str(),
            summary: c.summary(),
            registered_tools: c.registered_tools,
            inspected: c.inspected.clone(),
            uninspected: c.uninspected.clone(),
            target_tools: c.target_tools.clone(),
        }
    }
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
// `(StatusCode, Json<ReadinessResponse>)` is 152 bytes, which trips
// `clippy::result_large_err` as of Rust 1.98 (2026-08-18); it did not fire on
// 1.97, so this is a lint change rather than a code change. The suggested fix --
// boxing the Err variant -- is not available here: Axum resolves a handler's
// return type through `IntoResponse`, and `Box<(StatusCode, Json<T>)>` does not
// implement it, so boxing would stop this compiling as a route. The tuple is
// also the idiomatic Axum way to return a body alongside a non-200 status, which
// this probe needs: /ready answers 503 WITH the same ReadinessResponse body as
// 200, so a caller can see which dependency is unhealthy rather than just that
// something is. Scoped to this one function.
#[allow(clippy::result_large_err)]
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
        // Reconciled once at boot (AppState::new) rather than per probe: the
        // registry is read there already, and a readiness probe should not do
        // a table scan on every poll.
        airlock_coverage: AirlockCoverageReport {
            anti_rce: LayerCoverageReport::from(&state.airlock_coverage.rce),
            exfiltration: LayerCoverageReport::from(&state.airlock_coverage.exfiltration),
        },
        realtime_events_published: state.events.latest_seq(),
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
