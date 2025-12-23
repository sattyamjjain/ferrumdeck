//! API Key entity models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// API Key entity
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    #[serde(skip_serializing)] // Never expose the hash
    pub key_hash: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub revoked_at: Option<DateTime<Utc>>,
}

impl ApiKey {
    /// Check if the key is valid (not expired or revoked)
    pub fn is_valid(&self) -> bool {
        if self.revoked_at.is_some() {
            return false;
        }
        if let Some(expires) = self.expires_at {
            if expires < Utc::now() {
                return false;
            }
        }
        true
    }

    /// Check if the key has a specific scope
    pub fn has_scope(&self, scope: &str) -> bool {
        self.scopes.contains(&scope.to_string()) || self.scopes.contains(&"admin".to_string())
    }
}

/// Create API key request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateApiKey {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub key_hash: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
}

/// API key info (safe to return to user)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyInfo {
    pub id: String,
    pub tenant_id: String,
    pub name: String,
    pub key_prefix: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub last_used_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub is_revoked: bool,
}

impl From<ApiKey> for ApiKeyInfo {
    fn from(key: ApiKey) -> Self {
        Self {
            id: key.id,
            tenant_id: key.tenant_id,
            name: key.name,
            key_prefix: key.key_prefix,
            scopes: key.scopes,
            expires_at: key.expires_at,
            last_used_at: key.last_used_at,
            created_at: key.created_at,
            is_revoked: key.revoked_at.is_some(),
        }
    }
}
