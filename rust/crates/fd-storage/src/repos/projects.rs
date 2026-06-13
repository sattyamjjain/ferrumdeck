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
}
