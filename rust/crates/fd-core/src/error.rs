//! Error types for FerrumDeck

/// Result type alias using FerrumDeck Error
pub type Result<T> = std::result::Result<T, Error>;

/// FerrumDeck error types
#[derive(Debug, thiserror::Error)]
pub enum Error {
    // ==========================================================================
    // Client errors (4xx)
    // ==========================================================================
    #[error("not found: {entity} with id {id}")]
    NotFound { entity: &'static str, id: String },

    #[error("validation error: {message}")]
    Validation {
        message: String,
        field: Option<String>,
    },

    #[error("unauthorized: {message}")]
    Unauthorized { message: String },

    #[error("forbidden: {message}")]
    Forbidden { message: String },

    #[error("conflict: {message}")]
    Conflict { message: String },

    #[error("rate limited: retry after {retry_after_secs}s")]
    RateLimited { retry_after_secs: u64 },

    // ==========================================================================
    // Policy errors
    // ==========================================================================
    #[error("policy denied: {reason}")]
    PolicyDenied {
        reason: String,
        rule_id: Option<String>,
    },

    #[error("budget exceeded: {resource} limit of {limit} reached")]
    BudgetExceeded { resource: String, limit: String },

    #[error("approval required for action: {action}")]
    ApprovalRequired { action: String, request_id: String },

    // ==========================================================================
    // Internal errors (5xx)
    // ==========================================================================
    #[error("database error: {0}")]
    Database(String),

    #[error("queue error: {0}")]
    Queue(String),

    #[error("external service error: {service} - {message}")]
    ExternalService { service: String, message: String },

    #[error("internal error: {0}")]
    Internal(String),

    #[error("configuration error: {0}")]
    Config(String),
}

impl Error {
    /// HTTP status code for this error
    pub fn status_code(&self) -> u16 {
        match self {
            Error::NotFound { .. } => 404,
            Error::Validation { .. } => 400,
            Error::Unauthorized { .. } => 401,
            Error::Forbidden { .. } => 403,
            Error::Conflict { .. } => 409,
            Error::RateLimited { .. } => 429,
            Error::PolicyDenied { .. } => 403,
            Error::BudgetExceeded { .. } => 402,
            Error::ApprovalRequired { .. } => 202,
            Error::Database(_) => 500,
            Error::Queue(_) => 500,
            Error::ExternalService { .. } => 502,
            Error::Internal(_) => 500,
            Error::Config(_) => 500,
        }
    }

    /// Error code for API responses
    pub fn error_code(&self) -> &'static str {
        match self {
            Error::NotFound { .. } => "NOT_FOUND",
            Error::Validation { .. } => "VALIDATION_ERROR",
            Error::Unauthorized { .. } => "UNAUTHORIZED",
            Error::Forbidden { .. } => "FORBIDDEN",
            Error::Conflict { .. } => "CONFLICT",
            Error::RateLimited { .. } => "RATE_LIMITED",
            Error::PolicyDenied { .. } => "POLICY_DENIED",
            Error::BudgetExceeded { .. } => "BUDGET_EXCEEDED",
            Error::ApprovalRequired { .. } => "APPROVAL_REQUIRED",
            Error::Database(_) => "DATABASE_ERROR",
            Error::Queue(_) => "QUEUE_ERROR",
            Error::ExternalService { .. } => "EXTERNAL_SERVICE_ERROR",
            Error::Internal(_) => "INTERNAL_ERROR",
            Error::Config(_) => "CONFIG_ERROR",
        }
    }

    /// Whether this error should be retried
    pub fn is_retryable(&self) -> bool {
        matches!(
            self,
            Error::RateLimited { .. }
                | Error::Database(_)
                | Error::Queue(_)
                | Error::ExternalService { .. }
        )
    }
}

/// Validation error builder
pub struct ValidationError {
    message: String,
    field: Option<String>,
}

impl ValidationError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            field: None,
        }
    }

    pub fn field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }

    pub fn build(self) -> Error {
        Error::Validation {
            message: self.message,
            field: self.field,
        }
    }
}
