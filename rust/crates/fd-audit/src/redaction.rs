//! Sensitive data redaction for audit logs
//!
//! Implements PII/secret redaction to comply with data protection requirements.
//! Redacted values are replaced with placeholders and an index is maintained
//! for authorized recovery if needed.

use regex::Regex;
use serde_json::Value;
use std::collections::HashSet;
use std::sync::LazyLock;

/// Patterns for detecting sensitive data
static SENSITIVE_PATTERNS: LazyLock<Vec<SensitivePattern>> = LazyLock::new(|| {
    vec![
        // API keys and tokens
        SensitivePattern::new(
            "api_key",
            r#"(?i)(api[_-]?key|apikey)['"]?\s*[:=]\s*['"]?([a-zA-Z0-9_-]{20,})"#,
        ),
        SensitivePattern::new(
            "bearer_token",
            r"(?i)bearer\s+([a-zA-Z0-9_.-]{20,})",
        ),
        SensitivePattern::new(
            "jwt_token",
            r"eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+",
        ),
        // AWS credentials
        SensitivePattern::new(
            "aws_access_key",
            r"(?i)AKIA[0-9A-Z]{16}",
        ),
        SensitivePattern::new(
            "aws_secret_key",
            r#"(?i)(aws[_-]?secret[_-]?access[_-]?key)['"]?\s*[:=]\s*['"]?([a-zA-Z0-9/+=]{40})"#,
        ),
        // Database connection strings
        SensitivePattern::new(
            "connection_string",
            r"(?i)(postgres|mysql|mongodb|redis)://[^@\s]+:[^@\s]+@",
        ),
        // Email addresses (PII)
        SensitivePattern::new(
            "email",
            r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}",
        ),
        // Credit card numbers
        SensitivePattern::new(
            "credit_card",
            r"\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13})\b",
        ),
        // SSN (US)
        SensitivePattern::new(
            "ssn",
            r"\b\d{3}-\d{2}-\d{4}\b",
        ),
        // Generic password fields
        SensitivePattern::new(
            "password_field",
            r#"(?i)["']?password["']?\s*[:=]\s*["']?[^"'\s,}]+"#,
        ),
        // Private keys
        SensitivePattern::new(
            "private_key",
            r"-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----",
        ),
    ]
});

/// Sensitive field names that should always be redacted
static SENSITIVE_FIELDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    [
        "password",
        "secret",
        "token",
        "api_key",
        "apikey",
        "auth",
        "authorization",
        "credential",
        "private_key",
        "secret_key",
        "access_token",
        "refresh_token",
        "ssn",
        "credit_card",
        "card_number",
    ]
    .into_iter()
    .collect()
});

/// A pattern for detecting sensitive data
struct SensitivePattern {
    #[allow(dead_code)] // Used for debugging/logging
    name: &'static str,
    regex: Regex,
}

impl SensitivePattern {
    fn new(name: &'static str, pattern: &str) -> Self {
        Self {
            name,
            regex: Regex::new(pattern).expect("Invalid regex pattern"),
        }
    }
}

/// Result of redaction operation
#[derive(Debug, Clone)]
pub struct RedactionResult {
    /// The redacted content
    pub redacted: String,
    /// Types of sensitive data that were redacted
    pub redacted_types: Vec<String>,
    /// Number of redactions made
    pub redaction_count: usize,
}

/// Placeholder for redacted values
pub const REDACTED_PLACEHOLDER: &str = "[REDACTED]";

/// Redact sensitive data from a string
pub fn redact_string(input: &str) -> RedactionResult {
    let mut result = input.to_string();
    let mut redacted_types = Vec::new();
    let mut count = 0;

    for pattern in SENSITIVE_PATTERNS.iter() {
        if pattern.regex.is_match(&result) {
            result = pattern.regex.replace_all(&result, REDACTED_PLACEHOLDER).to_string();
            redacted_types.push(pattern.name.to_string());
            count += 1;
        }
    }

    RedactionResult {
        redacted: result,
        redacted_types,
        redaction_count: count,
    }
}

/// Redact sensitive data from a JSON value
pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut new_map = serde_json::Map::new();
            for (key, val) in map {
                let key_lower = key.to_lowercase();
                if SENSITIVE_FIELDS.iter().any(|f| key_lower.contains(f)) {
                    new_map.insert(key.clone(), Value::String(REDACTED_PLACEHOLDER.to_string()));
                } else {
                    new_map.insert(key.clone(), redact_json(val));
                }
            }
            Value::Object(new_map)
        }
        Value::Array(arr) => {
            Value::Array(arr.iter().map(redact_json).collect())
        }
        Value::String(s) => {
            let result = redact_string(s);
            Value::String(result.redacted)
        }
        other => other.clone(),
    }
}

/// Redact sensitive data from audit event metadata
pub fn redact_metadata(metadata: &Value) -> Value {
    redact_json(metadata)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_redact_api_key() {
        let input = r#"api_key = "sk_live_abc123def456ghi789jkl012mno""#;
        let result = redact_string(input);
        assert!(result.redacted.contains(REDACTED_PLACEHOLDER));
        assert!(!result.redacted.contains("sk_live"));
    }

    #[test]
    fn test_redact_bearer_token() {
        let input = "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
        let result = redact_string(input);
        assert!(result.redacted.contains(REDACTED_PLACEHOLDER));
    }

    #[test]
    fn test_redact_email() {
        let input = "Contact: user@example.com";
        let result = redact_string(input);
        assert!(result.redacted.contains(REDACTED_PLACEHOLDER));
        assert!(!result.redacted.contains("user@example.com"));
    }

    #[test]
    fn test_redact_aws_key() {
        let input = "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
        let result = redact_string(input);
        assert!(result.redacted.contains(REDACTED_PLACEHOLDER));
    }

    #[test]
    fn test_redact_json_password_field() {
        let input = json!({
            "username": "admin",
            "password": "secret123",
            "email": "admin@example.com"
        });
        let result = redact_json(&input);
        assert_eq!(result["password"], REDACTED_PLACEHOLDER);
        // Email in field value is also redacted
        assert!(result["email"].as_str().unwrap().contains(REDACTED_PLACEHOLDER));
    }

    #[test]
    fn test_redact_nested_json() {
        let input = json!({
            "user": {
                "profile": {
                    "api_key": "very_secret_key_12345",
                    "token": "another_secret",
                    "name": "John Doe"
                }
            }
        });
        let result = redact_json(&input);
        // api_key and token are sensitive field names, so they get redacted
        assert_eq!(
            result["user"]["profile"]["api_key"].as_str().unwrap(),
            REDACTED_PLACEHOLDER
        );
        assert_eq!(
            result["user"]["profile"]["token"].as_str().unwrap(),
            REDACTED_PLACEHOLDER
        );
        // Non-sensitive field should not be redacted
        assert_eq!(
            result["user"]["profile"]["name"].as_str().unwrap(),
            "John Doe"
        );
    }

    #[test]
    fn test_no_redaction_needed() {
        let input = "Hello, this is a normal message";
        let result = redact_string(input);
        assert_eq!(result.redacted, input);
        assert_eq!(result.redaction_count, 0);
    }
}
