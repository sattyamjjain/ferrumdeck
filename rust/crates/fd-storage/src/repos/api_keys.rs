//! API Keys repository

use crate::models::{ApiKey, CreateApiKey};
use crate::DbPool;
use chrono::Utc;
use tracing::instrument;

/// Repository for API key operations
#[derive(Clone)]
pub struct ApiKeysRepo {
    pool: DbPool,
}

impl ApiKeysRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create a new API key
    #[instrument(skip(self, key), fields(key_id = %key.id))]
    pub async fn create(&self, key: CreateApiKey) -> Result<ApiKey, sqlx::Error> {
        sqlx::query_as::<_, ApiKey>(
            r#"
            INSERT INTO api_keys (id, tenant_id, name, key_hash, key_prefix, scopes, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&key.id)
        .bind(&key.tenant_id)
        .bind(&key.name)
        .bind(&key.key_hash)
        .bind(&key.key_prefix)
        .bind(&key.scopes)
        .bind(&key.expires_at)
        .fetch_one(&self.pool)
        .await
    }

    /// Get an API key by its hash (for authentication)
    #[instrument(skip(self, key_hash))]
    pub async fn get_by_hash(&self, key_hash: &str) -> Result<Option<ApiKey>, sqlx::Error> {
        sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys WHERE key_hash = $1")
            .bind(key_hash)
            .fetch_optional(&self.pool)
            .await
    }

    /// Get an API key by ID
    #[instrument(skip(self))]
    pub async fn get(&self, id: &str) -> Result<Option<ApiKey>, sqlx::Error> {
        sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Update last used timestamp
    #[instrument(skip(self))]
    pub async fn touch(&self, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE api_keys SET last_used_at = $2 WHERE id = $1")
            .bind(id)
            .bind(Utc::now())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Revoke an API key
    #[instrument(skip(self))]
    pub async fn revoke(&self, id: &str) -> Result<Option<ApiKey>, sqlx::Error> {
        sqlx::query_as::<_, ApiKey>(
            r#"
            UPDATE api_keys SET revoked_at = $2 WHERE id = $1 RETURNING *
            "#,
        )
        .bind(id)
        .bind(Utc::now())
        .fetch_optional(&self.pool)
        .await
    }

    /// List API keys for a tenant
    #[instrument(skip(self))]
    pub async fn list_by_tenant(
        &self,
        tenant_id: &str,
        include_revoked: bool,
    ) -> Result<Vec<ApiKey>, sqlx::Error> {
        if include_revoked {
            sqlx::query_as::<_, ApiKey>(
                r#"
                SELECT * FROM api_keys
                WHERE tenant_id = $1
                ORDER BY created_at DESC
                "#,
            )
            .bind(tenant_id)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, ApiKey>(
                r#"
                SELECT * FROM api_keys
                WHERE tenant_id = $1 AND revoked_at IS NULL
                ORDER BY created_at DESC
                "#,
            )
            .bind(tenant_id)
            .fetch_all(&self.pool)
            .await
        }
    }
}
