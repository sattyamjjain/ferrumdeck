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

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // CORE-ERR-001: Status codes map correctly
    // ==========================================================================
    #[test]
    fn test_not_found_status_code() {
        let err = Error::NotFound {
            entity: "Run",
            id: "run_123".to_string(),
        };
        assert_eq!(err.status_code(), 404);
    }

    #[test]
    fn test_validation_status_code() {
        let err = Error::Validation {
            message: "Invalid input".to_string(),
            field: None,
        };
        assert_eq!(err.status_code(), 400);
    }

    #[test]
    fn test_unauthorized_status_code() {
        let err = Error::Unauthorized {
            message: "Invalid token".to_string(),
        };
        assert_eq!(err.status_code(), 401);
    }

    #[test]
    fn test_forbidden_status_code() {
        let err = Error::Forbidden {
            message: "Access denied".to_string(),
        };
        assert_eq!(err.status_code(), 403);
    }

    #[test]
    fn test_conflict_status_code() {
        let err = Error::Conflict {
            message: "Resource already exists".to_string(),
        };
        assert_eq!(err.status_code(), 409);
    }

    #[test]
    fn test_rate_limited_status_code() {
        let err = Error::RateLimited {
            retry_after_secs: 60,
        };
        assert_eq!(err.status_code(), 429);
    }

    #[test]
    fn test_policy_denied_status_code() {
        let err = Error::PolicyDenied {
            reason: "Tool not allowed".to_string(),
            rule_id: None,
        };
        assert_eq!(err.status_code(), 403);
    }

    #[test]
    fn test_budget_exceeded_status_code() {
        let err = Error::BudgetExceeded {
            resource: "tokens".to_string(),
            limit: "10000".to_string(),
        };
        assert_eq!(err.status_code(), 402);
    }

    #[test]
    fn test_approval_required_status_code() {
        let err = Error::ApprovalRequired {
            action: "deploy".to_string(),
            request_id: "req_123".to_string(),
        };
        assert_eq!(err.status_code(), 202);
    }

    #[test]
    fn test_database_status_code() {
        let err = Error::Database("Connection failed".to_string());
        assert_eq!(err.status_code(), 500);
    }

    #[test]
    fn test_queue_status_code() {
        let err = Error::Queue("Redis unavailable".to_string());
        assert_eq!(err.status_code(), 500);
    }

    #[test]
    fn test_external_service_status_code() {
        let err = Error::ExternalService {
            service: "LLM".to_string(),
            message: "Timeout".to_string(),
        };
        assert_eq!(err.status_code(), 502);
    }

    #[test]
    fn test_internal_status_code() {
        let err = Error::Internal("Unexpected state".to_string());
        assert_eq!(err.status_code(), 500);
    }

    #[test]
    fn test_config_status_code() {
        let err = Error::Config("Missing required setting".to_string());
        assert_eq!(err.status_code(), 500);
    }

    // ==========================================================================
    // CORE-ERR-002: Error codes map correctly
    // ==========================================================================
    #[test]
    fn test_error_code_not_found() {
        let err = Error::NotFound {
            entity: "Run",
            id: "123".to_string(),
        };
        assert_eq!(err.error_code(), "NOT_FOUND");
    }

    #[test]
    fn test_error_code_validation() {
        let err = Error::Validation {
            message: "test".to_string(),
            field: None,
        };
        assert_eq!(err.error_code(), "VALIDATION_ERROR");
    }

    #[test]
    fn test_error_code_unauthorized() {
        let err = Error::Unauthorized {
            message: "test".to_string(),
        };
        assert_eq!(err.error_code(), "UNAUTHORIZED");
    }

    #[test]
    fn test_error_code_forbidden() {
        let err = Error::Forbidden {
            message: "test".to_string(),
        };
        assert_eq!(err.error_code(), "FORBIDDEN");
    }

    #[test]
    fn test_error_code_conflict() {
        let err = Error::Conflict {
            message: "test".to_string(),
        };
        assert_eq!(err.error_code(), "CONFLICT");
    }

    #[test]
    fn test_error_code_rate_limited() {
        let err = Error::RateLimited { retry_after_secs: 30 };
        assert_eq!(err.error_code(), "RATE_LIMITED");
    }

    #[test]
    fn test_error_code_policy_denied() {
        let err = Error::PolicyDenied {
            reason: "test".to_string(),
            rule_id: None,
        };
        assert_eq!(err.error_code(), "POLICY_DENIED");
    }

    #[test]
    fn test_error_code_budget_exceeded() {
        let err = Error::BudgetExceeded {
            resource: "test".to_string(),
            limit: "100".to_string(),
        };
        assert_eq!(err.error_code(), "BUDGET_EXCEEDED");
    }

    #[test]
    fn test_error_code_approval_required() {
        let err = Error::ApprovalRequired {
            action: "test".to_string(),
            request_id: "req_1".to_string(),
        };
        assert_eq!(err.error_code(), "APPROVAL_REQUIRED");
    }

    #[test]
    fn test_error_code_database() {
        let err = Error::Database("test".to_string());
        assert_eq!(err.error_code(), "DATABASE_ERROR");
    }

    #[test]
    fn test_error_code_queue() {
        let err = Error::Queue("test".to_string());
        assert_eq!(err.error_code(), "QUEUE_ERROR");
    }

    #[test]
    fn test_error_code_external_service() {
        let err = Error::ExternalService {
            service: "test".to_string(),
            message: "msg".to_string(),
        };
        assert_eq!(err.error_code(), "EXTERNAL_SERVICE_ERROR");
    }

    #[test]
    fn test_error_code_internal() {
        let err = Error::Internal("test".to_string());
        assert_eq!(err.error_code(), "INTERNAL_ERROR");
    }

    #[test]
    fn test_error_code_config() {
        let err = Error::Config("test".to_string());
        assert_eq!(err.error_code(), "CONFIG_ERROR");
    }

    // ==========================================================================
    // CORE-ERR-003: is_retryable() identifies transient errors
    // ==========================================================================
    #[test]
    fn test_rate_limited_is_retryable() {
        let err = Error::RateLimited { retry_after_secs: 60 };
        assert!(err.is_retryable());
    }

    #[test]
    fn test_database_is_retryable() {
        let err = Error::Database("Connection lost".to_string());
        assert!(err.is_retryable());
    }

    #[test]
    fn test_queue_is_retryable() {
        let err = Error::Queue("Timeout".to_string());
        assert!(err.is_retryable());
    }

    #[test]
    fn test_external_service_is_retryable() {
        let err = Error::ExternalService {
            service: "LLM".to_string(),
            message: "Rate limited".to_string(),
        };
        assert!(err.is_retryable());
    }

    #[test]
    fn test_not_found_is_not_retryable() {
        let err = Error::NotFound {
            entity: "Run",
            id: "123".to_string(),
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_validation_is_not_retryable() {
        let err = Error::Validation {
            message: "Invalid".to_string(),
            field: None,
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_unauthorized_is_not_retryable() {
        let err = Error::Unauthorized {
            message: "Bad token".to_string(),
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_forbidden_is_not_retryable() {
        let err = Error::Forbidden {
            message: "Access denied".to_string(),
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_policy_denied_is_not_retryable() {
        let err = Error::PolicyDenied {
            reason: "Tool blocked".to_string(),
            rule_id: None,
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_budget_exceeded_is_not_retryable() {
        let err = Error::BudgetExceeded {
            resource: "tokens".to_string(),
            limit: "1000".to_string(),
        };
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_internal_is_not_retryable() {
        let err = Error::Internal("Bug".to_string());
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_config_is_not_retryable() {
        let err = Error::Config("Missing key".to_string());
        assert!(!err.is_retryable());
    }

    // ==========================================================================
    // CORE-ERR-004: Error display messages are correct
    // ==========================================================================
    #[test]
    fn test_not_found_display() {
        let err = Error::NotFound {
            entity: "Run",
            id: "run_abc123".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("not found"));
        assert!(msg.contains("Run"));
        assert!(msg.contains("run_abc123"));
    }

    #[test]
    fn test_validation_display() {
        let err = Error::Validation {
            message: "Invalid email format".to_string(),
            field: Some("email".to_string()),
        };
        let msg = err.to_string();
        assert!(msg.contains("validation error"));
        assert!(msg.contains("Invalid email format"));
    }

    #[test]
    fn test_rate_limited_display() {
        let err = Error::RateLimited { retry_after_secs: 120 };
        let msg = err.to_string();
        assert!(msg.contains("rate limited"));
        assert!(msg.contains("120"));
    }

    #[test]
    fn test_policy_denied_display() {
        let err = Error::PolicyDenied {
            reason: "Tool not in allowlist".to_string(),
            rule_id: Some("pol_xyz".to_string()),
        };
        let msg = err.to_string();
        assert!(msg.contains("policy denied"));
        assert!(msg.contains("Tool not in allowlist"));
    }

    #[test]
    fn test_budget_exceeded_display() {
        let err = Error::BudgetExceeded {
            resource: "API calls".to_string(),
            limit: "1000".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("budget exceeded"));
        assert!(msg.contains("API calls"));
        assert!(msg.contains("1000"));
    }

    #[test]
    fn test_approval_required_display() {
        let err = Error::ApprovalRequired {
            action: "delete_production".to_string(),
            request_id: "req_999".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("approval required"));
        assert!(msg.contains("delete_production"));
    }

    #[test]
    fn test_external_service_display() {
        let err = Error::ExternalService {
            service: "OpenAI".to_string(),
            message: "API quota exceeded".to_string(),
        };
        let msg = err.to_string();
        assert!(msg.contains("external service error"));
        assert!(msg.contains("OpenAI"));
        assert!(msg.contains("API quota exceeded"));
    }

    // ==========================================================================
    // CORE-ERR-005: ValidationError builder works
    // ==========================================================================
    #[test]
    fn test_validation_error_builder_simple() {
        let err = ValidationError::new("Invalid value").build();
        match err {
            Error::Validation { message, field } => {
                assert_eq!(message, "Invalid value");
                assert!(field.is_none());
            }
            _ => panic!("Expected Validation error"),
        }
    }

    #[test]
    fn test_validation_error_builder_with_field() {
        let err = ValidationError::new("Must be positive")
            .field("amount")
            .build();
        match err {
            Error::Validation { message, field } => {
                assert_eq!(message, "Must be positive");
                assert_eq!(field, Some("amount".to_string()));
            }
            _ => panic!("Expected Validation error"),
        }
    }

    #[test]
    fn test_validation_error_builder_string_ownership() {
        let msg = String::from("Dynamic error");
        let field_name = String::from("dynamic_field");
        let err = ValidationError::new(msg).field(field_name).build();
        match err {
            Error::Validation { message, field } => {
                assert_eq!(message, "Dynamic error");
                assert_eq!(field, Some("dynamic_field".to_string()));
            }
            _ => panic!("Expected Validation error"),
        }
    }

    #[test]
    fn test_validation_error_builder_status_code() {
        let err = ValidationError::new("test").build();
        assert_eq!(err.status_code(), 400);
    }

    #[test]
    fn test_validation_error_builder_error_code() {
        let err = ValidationError::new("test").build();
        assert_eq!(err.error_code(), "VALIDATION_ERROR");
    }

    // ==========================================================================
    // CORE-ERR-006: Policy error variants work correctly
    // ==========================================================================
    #[test]
    fn test_policy_denied_without_rule_id() {
        let err = Error::PolicyDenied {
            reason: "Tool not allowed".to_string(),
            rule_id: None,
        };
        assert_eq!(err.status_code(), 403);
        assert_eq!(err.error_code(), "POLICY_DENIED");
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_policy_denied_with_rule_id() {
        let err = Error::PolicyDenied {
            reason: "Blocked by rule".to_string(),
            rule_id: Some("pol_123".to_string()),
        };
        let msg = err.to_string();
        assert!(msg.contains("Blocked by rule"));
    }

    #[test]
    fn test_approval_required_full() {
        let err = Error::ApprovalRequired {
            action: "production_deploy".to_string(),
            request_id: "apr_456".to_string(),
        };
        assert_eq!(err.status_code(), 202); // Accepted (pending approval)
        assert_eq!(err.error_code(), "APPROVAL_REQUIRED");
        assert!(!err.is_retryable());
    }

    #[test]
    fn test_budget_exceeded_full() {
        let err = Error::BudgetExceeded {
            resource: "input_tokens".to_string(),
            limit: "100000".to_string(),
        };
        assert_eq!(err.status_code(), 402); // Payment Required
        assert_eq!(err.error_code(), "BUDGET_EXCEEDED");
        assert!(!err.is_retryable());
    }

    // ==========================================================================
    // Additional edge case tests
    // ==========================================================================
    #[test]
    fn test_error_debug_format() {
        let err = Error::NotFound {
            entity: "Agent",
            id: "agt_xyz".to_string(),
        };
        let debug = format!("{:?}", err);
        assert!(debug.contains("NotFound"));
        assert!(debug.contains("Agent"));
        assert!(debug.contains("agt_xyz"));
    }

    #[test]
    fn test_result_type_alias() {
        fn returns_error() -> Result<()> {
            Err(Error::Internal("test".to_string()))
        }

        let result = returns_error();
        assert!(result.is_err());
    }

    #[test]
    fn test_error_can_be_matched() {
        let err = Error::NotFound {
            entity: "Step",
            id: "stp_123".to_string(),
        };

        let is_not_found = matches!(err, Error::NotFound { .. });
        assert!(is_not_found);
    }
}
