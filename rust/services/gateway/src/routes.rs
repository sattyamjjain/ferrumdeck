//! API routes

use axum::{middleware, routing::get, routing::post, routing::put, Router};

use crate::handlers;
use crate::middleware::{auth_middleware, rate_limit_middleware, request_id_middleware};
use crate::state::AppState;

/// Build the full application router
pub fn build_router(state: AppState) -> Router {
    Router::new()
        // Health check (no auth required)
        .route("/health", get(handlers::health::health_check))
        .route("/ready", get(handlers::health::readiness_check))
        // V1 API (with auth)
        .nest(
            "/v1",
            Router::new()
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
                // Registry
                .route("/registry/agents", get(handlers::registry::list_agents))
                .route("/registry/agents", post(handlers::registry::create_agent))
                .route(
                    "/registry/agents/{agent_id}",
                    get(handlers::registry::get_agent),
                )
                .route(
                    "/registry/agents/{agent_id}/versions",
                    post(handlers::registry::create_agent_version),
                )
                .route("/registry/tools", get(handlers::registry::list_tools))
                .route("/registry/tools", post(handlers::registry::create_tool))
                // Workflows
                .route("/workflows", post(handlers::workflows::create_workflow))
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
                // Apply rate limiting after auth (so we can use tenant ID)
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    rate_limit_middleware,
                ))
                // Apply auth middleware to all v1 routes
                .layer(middleware::from_fn_with_state(
                    state.clone(),
                    auth_middleware,
                )),
        )
        // Request ID middleware for all routes
        .layer(middleware::from_fn(request_id_middleware))
        .with_state(state)
}
