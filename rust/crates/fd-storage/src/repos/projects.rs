//! Projects repository — read-only ownership lookups for tenant isolation.

use crate::DbPool;
use tracing::instrument;

/// Repository for resolving project ownership.
#[derive(Clone)]
pub struct ProjectsRepo {
    pool: DbPool,
}

impl ProjectsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Return the tenant that owns `project_id`, resolving
    /// project -> workspace -> tenant. `None` if the project does not exist.
    ///
    /// Used to enforce tenant isolation: a caller may only touch a project whose
    /// owning tenant matches its own.
    #[instrument(skip(self))]
    pub async fn tenant_id_for(&self, project_id: &str) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar::<_, String>(
            r#"
            SELECT w.tenant_id
            FROM projects p
            JOIN workspaces w ON w.id = p.workspace_id
            WHERE p.id = $1
            "#,
        )
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// Return a project's `settings` JSON blob (the extensible per-project
    /// config column). `None` if the project does not exist. Used to read the
    /// optional `min_claim_grounding_rate` reliability threshold (off by
    /// default — absent means no flagging).
    #[instrument(skip(self))]
    pub async fn get_settings(
        &self,
        project_id: &str,
    ) -> Result<Option<serde_json::Value>, sqlx::Error> {
        sqlx::query_scalar::<_, serde_json::Value>("SELECT settings FROM projects WHERE id = $1")
            .bind(project_id)
            .fetch_optional(&self.pool)
            .await
    }
}
