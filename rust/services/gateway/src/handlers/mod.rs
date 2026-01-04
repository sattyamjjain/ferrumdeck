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
        match &e {
            sqlx::Error::RowNotFound => {
                tracing::debug!(error = %e, "Record not found");
                Self::not_found("Record", "unknown")
            }
            sqlx::Error::Database(db_err) => {
                // PostgreSQL error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
                let code = db_err.code().map(|c| c.to_string());
                match code.as_deref() {
                    // 23505 = unique_violation
                    Some("23505") => {
                        tracing::warn!(error = %e, "Unique constraint violation");
                        Self::bad_request("Resource already exists")
                    }
                    // 23503 = foreign_key_violation
                    Some("23503") => {
                        tracing::warn!(error = %e, "Foreign key violation");
                        Self::bad_request("Referenced resource does not exist")
                    }
                    // 23502 = not_null_violation
                    Some("23502") => {
                        tracing::warn!(error = %e, "Not null constraint violation");
                        Self::bad_request("Required field is missing")
                    }
                    // 23514 = check_violation
                    Some("23514") => {
                        tracing::warn!(error = %e, "Check constraint violation");
                        Self::bad_request("Invalid field value")
                    }
                    _ => {
                        tracing::error!(error = %e, code = ?code, "Database error");
                        Self::internal("Database error")
                    }
                }
            }
            sqlx::Error::PoolTimedOut => {
                tracing::error!(error = %e, "Database pool timeout");
                Self::internal("Database temporarily unavailable")
            }
            _ => {
                tracing::error!(error = %e, "Database error");
                Self::internal("Database error")
            }
        }
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        tracing::error!(error = %e, "Redis error");
        Self::internal("Queue error")
    }
}
