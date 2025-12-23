//! FerrumDeck Gateway Service
//!
//! The main API gateway for the FerrumDeck control plane.
//! Handles authentication, rate limiting, and request routing.

use std::net::SocketAddr;
use tower_http::trace::TraceLayer;
use tracing::info;

mod handlers;
mod middleware;
mod routes;
mod state;

use state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load environment variables
    let _ = dotenvy::dotenv();

    // Initialize telemetry
    let otel_endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT")
        .unwrap_or_else(|_| "http://localhost:4317".to_string());

    fd_otel::init_telemetry("ferrumdeck-gateway", Some(&otel_endpoint))
        .map_err(|e| anyhow::anyhow!("Failed to initialize telemetry: {}", e))?;

    info!("Starting FerrumDeck Gateway");

    // Build application state
    let state = AppState::new().await?;
    info!("Connected to database and Redis");

    // Build router with all middleware
    let app = routes::build_router(state).layer(TraceLayer::new_for_http());

    // Get server address from environment
    let host = std::env::var("GATEWAY_HOST").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port: u16 = std::env::var("GATEWAY_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);

    let addr: SocketAddr = format!("{}:{}", host, port).parse()?;
    info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
