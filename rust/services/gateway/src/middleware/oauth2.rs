//! OAuth2/JWT authentication middleware
//!
//! Supports JWT tokens from OAuth2 providers like Auth0, Okta, Keycloak, etc.
//! Features:
//! - JWKS (JSON Web Key Set) fetching with caching
//! - JWT signature verification
//! - Claims validation (issuer, audience, expiration)
//! - Tenant extraction from token claims
//!
//! Configuration (via environment variables):
//! - OAUTH2_ENABLED: Set to "true" to enable OAuth2 authentication
//! - OAUTH2_JWKS_URI: URL to fetch JWKS (e.g., https://your-idp/.well-known/jwks.json)
//! - OAUTH2_ISSUER: Expected token issuer
//! - OAUTH2_AUDIENCE: Expected token audience
//! - OAUTH2_TENANT_CLAIM: Claim name for tenant ID (default: "tenant_id")
//! - OAUTH2_SCOPE_CLAIM: Claim name for scopes (default: "scope")
//!
//! Note: OAuth2 authentication is integrated into the auth_middleware.
//! Enable it by setting OAUTH2_ENABLED=true with appropriate configuration.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use jsonwebtoken::{decode, decode_header, jwk::JwkSet, DecodingKey, TokenData, Validation};
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::sync::RwLock;
use tracing::{debug, error, info, warn};

use super::auth::AuthContext;
use crate::state::AppState;

/// OAuth2 configuration
#[derive(Debug, Clone)]
pub struct OAuth2Config {
    /// JWKS URI for fetching public keys
    pub jwks_uri: String,
    /// Expected issuer (iss claim)
    pub issuer: String,
    /// Expected audience (aud claim)
    pub audience: String,
    /// Claim name for tenant ID (e.g., "tenant_id", "org_id", or custom claim)
    pub tenant_claim: String,
    /// Claim name for scopes (e.g., "scope", "permissions")
    pub scope_claim: String,
    /// Whether OAuth2 is enabled
    pub enabled: bool,
}

impl Default for OAuth2Config {
    fn default() -> Self {
        Self {
            jwks_uri: String::new(),
            issuer: String::new(),
            audience: String::new(),
            tenant_claim: "tenant_id".to_string(),
            scope_claim: "scope".to_string(),
            enabled: false,
        }
    }
}

impl OAuth2Config {
    /// Create config from environment variables
    pub fn from_env() -> Self {
        let enabled = std::env::var("OAUTH2_ENABLED")
            .map(|v| v.to_lowercase() == "true")
            .unwrap_or(false);

        Self {
            jwks_uri: std::env::var("OAUTH2_JWKS_URI").unwrap_or_default(),
            issuer: std::env::var("OAUTH2_ISSUER").unwrap_or_default(),
            audience: std::env::var("OAUTH2_AUDIENCE").unwrap_or_default(),
            tenant_claim: std::env::var("OAUTH2_TENANT_CLAIM")
                .unwrap_or_else(|_| "tenant_id".to_string()),
            scope_claim: std::env::var("OAUTH2_SCOPE_CLAIM")
                .unwrap_or_else(|_| "scope".to_string()),
            enabled,
        }
    }

    /// Validate configuration
    pub fn validate(&self) -> Result<(), String> {
        if !self.enabled {
            return Ok(());
        }

        if self.jwks_uri.is_empty() {
            return Err("OAUTH2_JWKS_URI is required when OAuth2 is enabled".to_string());
        }
        if self.issuer.is_empty() {
            return Err("OAUTH2_ISSUER is required when OAuth2 is enabled".to_string());
        }
        if self.audience.is_empty() {
            return Err("OAUTH2_AUDIENCE is required when OAuth2 is enabled".to_string());
        }
        Ok(())
    }
}

/// JWKS cache with automatic refresh
pub struct JwksCache {
    keys: RwLock<Option<CachedJwks>>,
    config: OAuth2Config,
    http_client: reqwest::Client,
    cache_duration: Duration,
}

struct CachedJwks {
    jwks: JwkSet,
    fetched_at: Instant,
}

impl JwksCache {
    pub fn new(config: OAuth2Config) -> Self {
        Self {
            keys: RwLock::new(None),
            config,
            http_client: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("Failed to create HTTP client"),
            cache_duration: Duration::from_secs(3600), // 1 hour cache
        }
    }

    /// Get JWKS, fetching from remote if needed
    pub async fn get_jwks(&self) -> Result<JwkSet, OAuth2Error> {
        // Check cache
        {
            let cache = self.keys.read().await;
            if let Some(cached) = cache.as_ref() {
                if cached.fetched_at.elapsed() < self.cache_duration {
                    return Ok(cached.jwks.clone());
                }
            }
        }

        // Fetch new JWKS
        self.refresh_jwks().await
    }

    /// Force refresh JWKS
    pub async fn refresh_jwks(&self) -> Result<JwkSet, OAuth2Error> {
        info!(jwks_uri = %self.config.jwks_uri, "Fetching JWKS");

        let response = self
            .http_client
            .get(&self.config.jwks_uri)
            .send()
            .await
            .map_err(|e| OAuth2Error::JwksFetchError(e.to_string()))?;

        if !response.status().is_success() {
            return Err(OAuth2Error::JwksFetchError(format!(
                "JWKS fetch returned status {}",
                response.status()
            )));
        }

        let jwks: JwkSet = response
            .json()
            .await
            .map_err(|e| OAuth2Error::JwksParseError(e.to_string()))?;

        info!(keys_count = jwks.keys.len(), "JWKS fetched successfully");

        // Update cache
        {
            let mut cache = self.keys.write().await;
            *cache = Some(CachedJwks {
                jwks: jwks.clone(),
                fetched_at: Instant::now(),
            });
        }

        Ok(jwks)
    }

    /// Get decoding key for a specific key ID (kid)
    pub async fn get_decoding_key(&self, kid: &str) -> Result<DecodingKey, OAuth2Error> {
        let jwks = self.get_jwks().await?;

        let jwk = jwks
            .keys
            .iter()
            .find(|k| k.common.key_id.as_deref() == Some(kid))
            .ok_or_else(|| OAuth2Error::KeyNotFound(kid.to_string()))?;

        DecodingKey::from_jwk(jwk).map_err(|e| OAuth2Error::KeyDecodeError(e.to_string()))
    }
}

/// JWT claims structure
#[derive(Debug, Serialize, Deserialize)]
pub struct JwtClaims {
    /// Subject (usually user ID)
    pub sub: String,
    /// Issuer
    pub iss: String,
    /// Audience (can be string or array)
    #[serde(default)]
    pub aud: Audience,
    /// Expiration time (Unix timestamp)
    pub exp: i64,
    /// Issued at (Unix timestamp)
    #[serde(default)]
    pub iat: i64,
    /// Not before (Unix timestamp)
    #[serde(default)]
    pub nbf: i64,
    /// All other claims
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

/// Audience can be a single string or array of strings
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Audience {
    #[default]
    None,
    Single(String),
    Multiple(Vec<String>),
}

impl Audience {
    pub fn contains(&self, aud: &str) -> bool {
        match self {
            Audience::None => false,
            Audience::Single(s) => s == aud,
            Audience::Multiple(v) => v.iter().any(|s| s == aud),
        }
    }
}

/// OAuth2 authentication errors
#[derive(Debug, thiserror::Error)]
pub enum OAuth2Error {
    #[error("Missing Authorization header")]
    MissingToken,
    #[error("Invalid token format")]
    InvalidTokenFormat,
    #[error("Token missing kid header")]
    MissingKid,
    #[error("Failed to fetch JWKS: {0}")]
    JwksFetchError(String),
    #[error("Failed to parse JWKS: {0}")]
    JwksParseError(String),
    #[error("Key not found: {0}")]
    KeyNotFound(String),
    #[error("Failed to decode key: {0}")]
    KeyDecodeError(String),
    #[error("Token validation failed: {0}")]
    ValidationError(String),
    #[error("Missing required claim: {0}")]
    MissingClaim(String),
    #[error("Invalid issuer")]
    InvalidIssuer,
    #[error("Invalid audience")]
    InvalidAudience,
    #[error("Token expired")]
    TokenExpired,
}

/// OAuth2 token validator
pub struct OAuth2Validator {
    config: OAuth2Config,
    jwks_cache: Arc<JwksCache>,
}

impl OAuth2Validator {
    pub fn new(config: OAuth2Config) -> Self {
        let jwks_cache = Arc::new(JwksCache::new(config.clone()));
        Self { config, jwks_cache }
    }

    /// Validate a JWT token and extract claims
    pub async fn validate_token(&self, token: &str) -> Result<JwtClaims, OAuth2Error> {
        // Decode header to get key ID
        let header = decode_header(token).map_err(|_e| OAuth2Error::InvalidTokenFormat)?;

        let kid = header.kid.ok_or(OAuth2Error::MissingKid)?;

        // Get decoding key from JWKS
        let decoding_key = self.jwks_cache.get_decoding_key(&kid).await?;

        // Set up validation
        let mut validation = Validation::new(header.alg);
        validation.set_issuer(&[&self.config.issuer]);
        validation.set_audience(&[&self.config.audience]);
        validation.validate_exp = true;
        validation.validate_nbf = true;

        // Decode and validate token
        let token_data: TokenData<JwtClaims> = decode(token, &decoding_key, &validation)
            .map_err(|e| OAuth2Error::ValidationError(e.to_string()))?;

        Ok(token_data.claims)
    }

    /// Extract tenant ID from claims
    pub fn extract_tenant(&self, claims: &JwtClaims) -> Result<String, OAuth2Error> {
        claims
            .extra
            .get(&self.config.tenant_claim)
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| OAuth2Error::MissingClaim(self.config.tenant_claim.clone()))
    }

    /// Extract scopes from claims
    pub fn extract_scopes(&self, claims: &JwtClaims) -> Vec<String> {
        claims
            .extra
            .get(&self.config.scope_claim)
            .map(|v| {
                match v {
                    // Space-separated string (common in OAuth2)
                    serde_json::Value::String(s) => {
                        s.split_whitespace().map(|s| s.to_string()).collect()
                    }
                    // Array of strings
                    serde_json::Value::Array(arr) => arr
                        .iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect(),
                    _ => vec![],
                }
            })
            .unwrap_or_default()
    }
}

/// Create OAuth2 validator from environment
pub fn create_oauth2_validator() -> Option<Arc<OAuth2Validator>> {
    let config = OAuth2Config::from_env();

    if !config.enabled {
        info!("OAuth2 authentication is disabled");
        return None;
    }

    if let Err(e) = config.validate() {
        error!(error = %e, "Invalid OAuth2 configuration");
        return None;
    }

    info!(
        issuer = %config.issuer,
        audience = %config.audience,
        "OAuth2 authentication enabled"
    );

    Some(Arc::new(OAuth2Validator::new(config)))
}

/// Combined authentication middleware (API key or OAuth2)
///
/// Tries OAuth2 JWT first (if enabled), falls back to API key
pub async fn oauth2_auth_middleware(
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

    // Check if it's a Bearer token that looks like a JWT
    if let Some(token) = auth_header.strip_prefix("Bearer ") {
        // JWT tokens have 3 parts separated by dots
        if token.matches('.').count() == 2 {
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
        }
    }

    // Fall back to API key authentication
    // This is handled by the regular auth middleware
    // For now, return unauthorized if OAuth2 was expected
    unauthorized("Invalid or unsupported authentication method")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_oauth2_config_from_env() {
        // Clear env vars
        std::env::remove_var("OAUTH2_ENABLED");
        std::env::remove_var("OAUTH2_JWKS_URI");

        let config = OAuth2Config::from_env();
        assert!(!config.enabled);
    }

    #[test]
    fn test_oauth2_config_validation() {
        let mut config = OAuth2Config::default();
        assert!(config.validate().is_ok()); // Not enabled, so OK

        config.enabled = true;
        assert!(config.validate().is_err()); // Missing required fields

        config.jwks_uri = "https://example.com/.well-known/jwks.json".to_string();
        config.issuer = "https://example.com".to_string();
        config.audience = "my-api".to_string();
        assert!(config.validate().is_ok());
    }

    #[test]
    fn test_audience_contains() {
        let none = Audience::None;
        assert!(!none.contains("test"));

        let single = Audience::Single("my-api".to_string());
        assert!(single.contains("my-api"));
        assert!(!single.contains("other"));

        let multiple = Audience::Multiple(vec!["api1".to_string(), "api2".to_string()]);
        assert!(multiple.contains("api1"));
        assert!(multiple.contains("api2"));
        assert!(!multiple.contains("api3"));
    }

    #[test]
    fn test_scope_extraction() {
        let config = OAuth2Config {
            scope_claim: "scope".to_string(),
            ..Default::default()
        };
        let validator = OAuth2Validator::new(config);

        // Test space-separated scopes
        let mut claims = JwtClaims {
            sub: "user1".to_string(),
            iss: "issuer".to_string(),
            aud: Audience::None,
            exp: 0,
            iat: 0,
            nbf: 0,
            extra: HashMap::new(),
        };
        claims.extra.insert(
            "scope".to_string(),
            serde_json::Value::String("read write admin".to_string()),
        );

        let scopes = validator.extract_scopes(&claims);
        assert_eq!(scopes, vec!["read", "write", "admin"]);

        // Test array scopes
        claims
            .extra
            .insert("scope".to_string(), serde_json::json!(["read", "write"]));

        let scopes = validator.extract_scopes(&claims);
        assert_eq!(scopes, vec!["read", "write"]);
    }
}
