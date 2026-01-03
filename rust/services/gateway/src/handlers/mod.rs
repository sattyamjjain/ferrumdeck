//! Request handlers

pub mod api_keys;
pub mod approvals;
pub mod health;
pub mod orchestrator;
pub mod policies;
pub mod registry;
pub mod runs;
pub mod workflows;

#[cfg(test)]
mod tests;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// Standard API error response
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl ApiError {
    pub fn not_found(entity: &str, id: &str) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            code: "NOT_FOUND",
            message: format!("{} with id '{}' not found", entity, id),
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            code: "BAD_REQUEST",
            message: message.into(),
        }
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            code: "INTERNAL_ERROR",
            message: message.into(),
        }
    }

    #[allow(dead_code)]
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "FORBIDDEN",
            message: message.into(),
        }
    }

    /// Return when a tool call is blocked by policy
    #[allow(dead_code)]
    pub fn policy_blocked(reason: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "POLICY_BLOCKED",
            message: reason.into(),
        }
    }

    /// Return when budget limits are exceeded
    pub fn budget_exceeded(reason: impl Into<String>) -> Self {
        Self {
            status: StatusCode::FORBIDDEN,
            code: "BUDGET_EXCEEDED",
            message: reason.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({
            "error": {
                "code": self.code,
                "message": self.message
            }
        });
        (self.status, Json(body)).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        tracing::error!(error = %e, "Database error");
        Self::internal("Database error")
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        tracing::error!(error = %e, "Redis error");
        Self::internal("Queue error")
    }
}
