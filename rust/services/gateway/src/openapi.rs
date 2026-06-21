//! OpenAPI documentation configuration
//!
//! This module configures the OpenAPI specification and Swagger UI
//! for the FerrumDeck Gateway API.

use utoipa::OpenApi;

use crate::handlers::{harness_suggestions, health, promotions, runs, training_signal};

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
        (name = "promotions", description = "Champion-challenger promotion gate"),
        (name = "harness", description = "Eval-driven harness/policy suggestions (proposed, human-in-the-loop)")
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
        // Harness-suggestion endpoints (trace→delta)
        harness_suggestions::create_harness_suggestion,
        harness_suggestions::get_harness_suggestions,
        harness_suggestions::resolve_harness_suggestion,
        // Training-signal export (trace→signal)
        training_signal::export_training_signal,
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
            // Harness-suggestion schemas (trace→delta)
            harness_suggestions::CreateHarnessSuggestionRequest,
            harness_suggestions::EvidenceRequest,
            harness_suggestions::ResolveHarnessSuggestionRequest,
            harness_suggestions::HarnessSuggestionResponse,
            harness_suggestions::HarnessSuggestionsResponse,
            // Training-signal export (trace→signal)
            training_signal::TrainingSignalRequest,
        )
    )
)]
pub struct ApiDoc;
