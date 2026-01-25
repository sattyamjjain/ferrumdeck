//! API routes

use axum::{
    middleware, routing::delete, routing::get, routing::patch, routing::post, routing::put, Router,
};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

use crate::handlers;
use crate::middleware::{
    auth_middleware, pre_auth_rate_limit_middleware, rate_limit_middleware, request_id_middleware,
    require_admin, require_write,
};
use crate::openapi::ApiDoc;
use crate::state::AppState;

/// Build the full application router
pub fn build_router(state: AppState) -> Router {
    Router::new()
        // Health check (no auth required)
        .route("/health", get(handlers::health::health_check))
        .route("/ready", get(handlers::health::readiness_check))
        // OpenAPI documentation (no auth required)
        .merge(SwaggerUi::new("/docs").url("/api-docs/openapi.json", ApiDoc::openapi()))
        // V1 API (with auth)
        .nest(
            "/v1",
            Router::new()
                // ========================================
                // ADMIN-ONLY routes (require "admin" scope)
                // ========================================
                .nest(
                    "",
                    Router::new()
                        // API Key management (admin only)
                        .route(
                            "/api-keys/{key_id}/revoke",
                            post(handlers::api_keys::revoke_api_key),
                        )
                        // Policy management (admin only)
                        .route("/policies", post(handlers::policies::create_policy))
                        .route(
                            "/policies/{policy_id}",
                            patch(handlers::policies::update_policy),
                        )
                        .route(
                            "/policies/{policy_id}",
                            delete(handlers::policies::delete_policy),
                        )
                        // Security config update (admin only)
                        .route(
                            "/security/config",
                            put(handlers::security::update_config),
                        )
                        .layer(middleware::from_fn(require_admin())),
                )
                // ========================================
                // WRITE routes (require "write" scope)
                // ========================================
                .nest(
                    "",
                    Router::new()
                        // Registry writes
                        .route("/registry/agents", post(handlers::registry::create_agent))
                        .route(
                            "/registry/agents/{agent_id}/versions",
                            post(handlers::registry::create_agent_version),
                        )
                        .route("/registry/tools", post(handlers::registry::create_tool))
                        // Workflow creation
                        .route("/workflows", post(handlers::workflows::create_workflow))
                        .layer(middleware::from_fn(require_write())),
                )
                // ========================================
                // READ routes (any authenticated user)
                // ========================================
                // Runs
                .route("/runs", post(handlers::runs::create_run))
                .route("/runs", get(handlers::runs::list_runs))
                .route("/runs/{run_id}", get(handlers::runs::get_run))
                .route("/runs/{run_id}/cancel", post(handlers::runs::cancel_run))
                .route("/runs/{run_id}/steps", get(handlers::runs::list_steps))
                .route(
                    "/runs/{run_id}/steps/{step_id}",
                    post(handlers::runs::submit_step_result),
                )
                .route(
                    "/runs/{run_id}/check-tool",
                    post(handlers::runs::check_tool_policy),
                )
                // Approvals
                .route(
                    "/approvals",
                    get(handlers::approvals::list_pending_approvals),
                )
                .route(
                    "/approvals/{approval_id}",
                    put(handlers::approvals::resolve_approval),
                )
                // Policies (read)
                .route("/policies", get(handlers::policies::list_policies))
                .route("/policies/{policy_id}", get(handlers::policies::get_policy))
                // Registry (read)
                .route("/registry/agents", get(handlers::registry::list_agents))
                .route(
                    "/registry/agents/{agent_id}",
                    get(handlers::registry::get_agent),
                )
                .route(
                    "/registry/agents/{agent_id}/versions",
                    get(handlers::registry::list_agent_versions),
                )
                .route(
                    "/registry/agents/{agent_id}/stats",
                    get(handlers::registry::get_agent_stats),
                )
                .route(
                    "/registry/tools/{tool_id}",
                    get(handlers::registry::get_tool),
                )
                .route("/registry/tools", get(handlers::registry::list_tools))
                .route(
                    "/registry/mcp-servers",
                    get(handlers::registry::list_mcp_servers),
                )
                // API Keys (read)
                .route("/api-keys", get(handlers::api_keys::list_api_keys))
                .route("/api-keys/{key_id}", get(handlers::api_keys::get_api_key))
                // Workflows (read)
                .route("/workflows", get(handlers::workflows::list_workflows))
                .route(
                    "/workflows/{workflow_id}",
                    get(handlers::workflows::get_workflow),
                )
                .route(
                    "/workflows/{workflow_id}/runs",
                    get(handlers::workflows::list_workflow_runs),
                )
                // Workflow Runs
                .route(
                    "/workflow-runs",
                    post(handlers::workflows::create_workflow_run),
                )
                .route(
                    "/workflow-runs/{run_id}",
                    get(handlers::workflows::get_workflow_run),
                )
                .route(
                    "/workflow-runs/{run_id}/cancel",
                    post(handlers::workflows::cancel_workflow_run),
                )
                .route(
                    "/workflow-runs/{run_id}/executions",
                    get(handlers::workflows::list_step_executions),
                )
                .route(
                    "/workflow-runs/{run_id}/executions",
                    post(handlers::workflows::create_step_execution),
                )
                .route(
                    "/workflow-runs/{run_id}/executions/{execution_id}",
                    post(handlers::workflows::submit_step_execution_result),
                )
                // Security (read)
                .route("/security/threats", get(handlers::security::list_threats))
                .route(
                    "/security/threats/{threat_id}",
                    get(handlers::security::get_threat),
                )
                .route("/security/config", get(handlers::security::get_config))
                // Apply tenant-based rate limiting after auth (so we can use tenant ID)
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    rate_limit_middleware,
                ))
                // Apply auth middleware to all v1 routes
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    auth_middleware,
                ))
                // SECURITY: Apply IP-based rate limiting BEFORE auth to prevent brute-force attacks
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    pre_auth_rate_limit_middleware,
                )),
        )
        // Request ID middleware for all routes
        .layer(middleware::from_fn(request_id_middleware))
        .with_state(state)
}
