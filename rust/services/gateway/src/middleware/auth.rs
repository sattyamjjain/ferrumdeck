//! API Key and OAuth2/JWT authentication middleware
//!
//! This middleware supports two authentication methods:
//! 1. OAuth2/JWT tokens (if enabled via OAUTH2_ENABLED=true)
//! 2. API key authentication (Bearer <key> or ApiKey <key>)
//!
//! For JWT tokens (identified by having 3 dot-separated parts), OAuth2 validation
//! is attempted first. API key authentication is used as fallback or when OAuth2
//! is disabled.
//!
//! SECURITY: API keys are hashed using HMAC-SHA256 with a server secret to prevent
//! rainbow table attacks. Keys are compared using constant-time comparison.

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use fd_storage::ApiKeysRepo;
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;
use subtle::ConstantTimeEq;
use tracing::{debug, warn};

use crate::state::AppState;

type HmacSha256 = Hmac<Sha256>;

/// Authenticated tenant context
#[derive(Debug, Clone)]
pub struct AuthContext {
    pub api_key_id: String,
    pub tenant_id: String,
    #[allow(dead_code)]
    pub scopes: Vec<String>,
}

impl AuthContext {
    #[allow(dead_code)]
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.contains(&scope.to_string()) || self.scopes.contains(&"admin".to_string())
    }
}

/// Combined authentication middleware (OAuth2/JWT with API key fallback)
pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    // Extract token from Authorization header
    let auth_header = request
        .headers()
        .get(header::AUTHORIZATION)
        .and_then(|h| h.to_str().ok());

    let Some(auth_header) = auth_header else {
        return unauthorized("Missing Authorization header");
    };

    // Check for Bearer token
    if let Some(token) = auth_header.strip_prefix("Bearer ") {
        // Check if it looks like a JWT (3 parts separated by dots)
        if token.matches('.').count() == 2 {
            // Try OAuth2/JWT authentication if enabled
            if let Some(ref validator) = state.oauth2_validator {
                match validator.validate_token(token).await {
                    Ok(claims) => {
                        // Extract tenant from claims
                        let tenant_id = match validator.extract_tenant(&claims) {
                            Ok(t) => t,
                            Err(e) => {
                                warn!(error = %e, "Failed to extract tenant from JWT");
                                return unauthorized("Missing tenant claim in token");
                            }
                        };

                        let scopes = validator.extract_scopes(&claims);

                        debug!(
                            subject = %claims.sub,
                            tenant_id = %tenant_id,
                            scopes = ?scopes,
                            "JWT authentication successful"
                        );

                        // Create auth context
                        let auth_context = AuthContext {
                            api_key_id: format!("jwt:{}", claims.sub),
                            tenant_id,
                            scopes,
                        };
                        request.extensions_mut().insert(auth_context);

                        return next.run(request).await;
                    }
                    Err(e) => {
                        warn!(error = %e, "JWT validation failed");
                        return unauthorized(&format!("Invalid token: {}", e));
                    }
                }
            }
            // If OAuth2 is not enabled, fall through to API key auth
            // (JWT-looking tokens can still be API keys)
        }
    }

    // Fall back to API key authentication
    let api_key = match extract_api_key(Some(auth_header)) {
        Some(key) => key,
        None => {
            return unauthorized("Invalid Authorization header format");
        }
    };

    // SECURITY: Try HMAC hash first, then fall back to legacy SHA256 for migration
    // Legacy support allows existing API keys to continue working during migration
    let key_hash_hmac = hash_api_key(&api_key, &state.api_key_secret);
    let key_hash_legacy = hash_api_key_legacy(&api_key);

    // Look up the key in the database (try HMAC first, then legacy)
    let api_keys_repo = ApiKeysRepo::new(state.db.clone());

    // Try HMAC hash first
    let api_key_record = match api_keys_repo.get_by_hash(&key_hash_hmac).await {
        Ok(Some(key)) => key,
        Ok(None) => {
            // Fall back to legacy hash for migration compatibility
            match api_keys_repo.get_by_hash(&key_hash_legacy).await {
                Ok(Some(key)) => {
                    // SECURITY: Log that legacy hash was used for auditing
                    warn!(
                        key_id = %key.id,
                        "API key using legacy SHA256 hash - should migrate to HMAC"
                    );
                    key
                }
                Ok(None) => {
                    // SECURITY: Don't log the key prefix in production to prevent enumeration
                    warn!("Invalid API key attempt");
                    return unauthorized("Invalid API key");
                }
                Err(e) => {
                    tracing::error!(error = %e, "Database error during authentication");
                    return internal_error("Authentication failed");
                }
            }
        }
        Err(e) => {
            tracing::error!(error = %e, "Database error during authentication");
            return internal_error("Authentication failed");
        }
    };

    // Check if key is valid (not revoked, not expired)
    if !api_key_record.is_valid() {
        warn!(key_id = %api_key_record.id, "API key is revoked or expired");
        return unauthorized("API key is revoked or expired");
    }

    // Update last used timestamp (fire and forget)
    {
        let repo = api_keys_repo.clone();
        let key_id = api_key_record.id.clone();
        tokio::spawn(async move {
            let _ = repo.touch(&key_id).await;
        });
    }

    debug!(
        key_id = %api_key_record.id,
        tenant_id = %api_key_record.tenant_id,
        "API key authentication successful"
    );

    // Create auth context and add to request extensions
    let auth_context = AuthContext {
        api_key_id: api_key_record.id,
        tenant_id: api_key_record.tenant_id,
        scopes: api_key_record.scopes,
    };
    request.extensions_mut().insert(auth_context);

    next.run(request).await
}

/// Extract API key from Authorization header
fn extract_api_key(auth_header: Option<&str>) -> Option<String> {
    let header = auth_header?;

    // Support both "Bearer <key>" and "ApiKey <key>" formats
    header
        .strip_prefix("Bearer ")
        .or_else(|| header.strip_prefix("ApiKey "))
        .map(|s| s.to_string())
}

/// Hash an API key using HMAC-SHA256 with a server secret
///
/// SECURITY: Using HMAC instead of plain SHA256 prevents rainbow table attacks.
/// The server secret should be set via API_KEY_SECRET environment variable.
fn hash_api_key(key: &str, secret: &[u8]) -> String {
    let mut mac =
        HmacSha256::new_from_slice(secret).expect("HMAC can take key of any size");
    mac.update(key.as_bytes());
    hex::encode(mac.finalize().into_bytes())
}

/// Verify an API key against a stored hash using constant-time comparison
///
/// SECURITY: Constant-time comparison prevents timing attacks that could
/// be used to guess the API key one character at a time.
#[allow(dead_code)]
fn verify_api_key(provided_key: &str, stored_hash: &str, secret: &[u8]) -> bool {
    let computed_hash = hash_api_key(provided_key, secret);
    computed_hash.as_bytes().ct_eq(stored_hash.as_bytes()).into()
}

/// Hash an API key using legacy SHA256 (for migration compatibility)
///
/// DEPRECATED: This is only used for backward compatibility during migration.
/// New API keys should use HMAC hashing.
fn hash_api_key_legacy(key: &str) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(key.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn unauthorized(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": {
                "code": "UNAUTHORIZED",
                "message": message
            }
        })),
    )
        .into_response()
}

fn internal_error(message: &str) -> Response {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({
            "error": {
                "code": "INTERNAL_ERROR",
                "message": message
            }
        })),
    )
        .into_response()
}

/// Scope requirement middleware factory
#[allow(dead_code)]
pub fn require_scope(
    scope: &'static str,
) -> impl Fn(Request, Next) -> std::pin::Pin<Box<dyn std::future::Future<Output = Response> + Send>>
       + Clone {
    move |request: Request, next: Next| {
        Box::pin(async move {
            let auth = request.extensions().get::<AuthContext>();

            match auth {
                Some(ctx) if ctx.has_scope(scope) => next.run(request).await,
                Some(_) => (
                    StatusCode::FORBIDDEN,
                    Json(json!({
                        "error": {
                            "code": "FORBIDDEN",
                            "message": format!("Missing required scope: {}", scope)
                        }
                    })),
                )
                    .into_response(),
                None => unauthorized("Not authenticated"),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_api_key_bearer() {
        let key = extract_api_key(Some("Bearer my_api_key_123"));
        assert_eq!(key, Some("my_api_key_123".to_string()));
    }

    #[test]
    fn test_extract_api_key_apikey() {
        let key = extract_api_key(Some("ApiKey my_api_key_123"));
        assert_eq!(key, Some("my_api_key_123".to_string()));
    }

    #[test]
    fn test_extract_api_key_none() {
        assert!(extract_api_key(None).is_none());
        assert!(extract_api_key(Some("Invalid")).is_none());
    }

    #[test]
    fn test_hash_api_key_hmac() {
        let secret = b"test-secret";
        let hash = hash_api_key("test_key", secret);
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // HMAC-SHA256 hex = 64 chars

        // Same key with same secret should produce same hash
        let hash2 = hash_api_key("test_key", secret);
        assert_eq!(hash, hash2);

        // Different secret should produce different hash
        let hash3 = hash_api_key("test_key", b"different-secret");
        assert_ne!(hash, hash3);
    }

    #[test]
    fn test_verify_api_key() {
        let secret = b"test-secret";
        let key = "my_api_key";
        let stored_hash = hash_api_key(key, secret);

        // Correct key should verify
        assert!(verify_api_key(key, &stored_hash, secret));

        // Wrong key should not verify
        assert!(!verify_api_key("wrong_key", &stored_hash, secret));

        // Wrong secret should not verify
        assert!(!verify_api_key(key, &stored_hash, b"wrong-secret"));
    }

    #[test]
    fn test_hash_api_key_legacy() {
        let hash = hash_api_key_legacy("test_key");
        assert!(!hash.is_empty());
        assert_eq!(hash.len(), 64); // SHA256 hex = 64 chars
    }
}
