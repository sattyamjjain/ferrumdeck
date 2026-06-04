//! OpenAPI documentation configuration
//!
//! This module configures the OpenAPI specification and Swagger UI
//! for the FerrumDeck Gateway API.

use utoipa::OpenApi;

use crate::handlers::{health, promotions, runs};

/// OpenAPI documentation for the FerrumDeck Gateway API
#[derive(OpenApi)]
#[openapi(
    info(
        title = "FerrumDeck Gateway API",
        version = "0.1.0",
        description = "AgentOps Control Plane API for running agentic AI workflows with deterministic governance.",
        license(name = "Apache-2.0", url = "https://www.apache.org/licenses/LICENSE-2.0"),
        contact(name = "FerrumDeck Team", url = "https://github.com/ferrumdeck/ferrumdeck")
    ),
    servers(
        (url = "/", description = "Current server")
    ),
    tags(
        (name = "health", description = "Health check endpoints"),
        (name = "runs", description = "Run management endpoints"),
        (name = "promotions", description = "Champion-challenger promotion gate")
    ),
    paths(
        // Health endpoints
        health::health_check,
        health::readiness_check,
        // Run endpoints
        runs::create_run,
        runs::get_run,
        runs::list_runs,
        runs::cancel_run,
        runs::list_steps,
        runs::get_routing,
        // Promotion-gate endpoints
        promotions::evaluate_promotion,
        promotions::get_promotions,
    ),
    components(
        schemas(
            // Health schemas
            health::HealthResponse,
            health::ReadinessResponse,
            health::ComponentStatus,
            health::ComponentHealth,
            // Run schemas
            runs::CreateRunRequest,
            runs::RunResponse,
            runs::ListRunsResponse,
            runs::StepResponse,
            // Routing-decision audit (AgensFlow, arXiv:2605.27466)
            runs::RoutingResponse,
            runs::RoutingDecisionResponse,
            // Champion-challenger promotion gate
            promotions::EvaluatePromotionRequest,
            promotions::MetricThresholdRequest,
            promotions::PromotionDecisionResponse,
            promotions::PromotionHistoryResponse,
        )
    )
)]
pub struct ApiDoc;
