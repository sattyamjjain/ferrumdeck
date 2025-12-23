//! Health check handlers

use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct HealthResponse {
    pub status: &'static str,
    pub version: &'static str,
}

pub async fn health_check() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "healthy",
        version: env!("CARGO_PKG_VERSION"),
    })
}

pub async fn readiness_check() -> Json<HealthResponse> {
    // TODO: Check database and Redis connectivity
    Json(HealthResponse {
        status: "ready",
        version: env!("CARGO_PKG_VERSION"),
    })
}
