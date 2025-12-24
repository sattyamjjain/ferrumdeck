//! Tools repository

use crate::models::{CreateTool, CreateToolVersion, Tool, ToolStatus, ToolVersion, UpdateTool};
use crate::DbPool;
use tracing::instrument;

/// Repository for tool operations
#[derive(Clone)]
pub struct ToolsRepo {
    pool: DbPool,
}

impl ToolsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create a new tool
    #[instrument(skip(self, tool), fields(tool_id = %tool.id))]
    pub async fn create(&self, tool: CreateTool) -> Result<Tool, sqlx::Error> {
        sqlx::query_as::<_, Tool>(
            r#"
            INSERT INTO tools (id, project_id, name, slug, description, mcp_server, risk_level)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&tool.id)
        .bind(&tool.project_id)
        .bind(&tool.name)
        .bind(&tool.slug)
        .bind(&tool.description)
        .bind(&tool.mcp_server)
        .bind(tool.risk_level)
        .fetch_one(&self.pool)
        .await
    }

    /// Get a tool by ID
    #[instrument(skip(self))]
    pub async fn get(&self, id: &str) -> Result<Option<Tool>, sqlx::Error> {
        sqlx::query_as::<_, Tool>("SELECT * FROM tools WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Get a tool by slug
    #[instrument(skip(self))]
    pub async fn get_by_slug(&self, slug: &str) -> Result<Option<Tool>, sqlx::Error> {
        sqlx::query_as::<_, Tool>("SELECT * FROM tools WHERE slug = $1")
            .bind(slug)
            .fetch_optional(&self.pool)
            .await
    }

    /// Update a tool
    #[instrument(skip(self, update), fields(tool_id = %id))]
    pub async fn update(&self, id: &str, update: UpdateTool) -> Result<Option<Tool>, sqlx::Error> {
        let mut set_clauses = Vec::new();
        let mut param_idx = 2;

        if update.name.is_some() {
            set_clauses.push(format!("name = ${}", param_idx));
            param_idx += 1;
        }
        if update.description.is_some() {
            set_clauses.push(format!("description = ${}", param_idx));
            param_idx += 1;
        }
        if update.status.is_some() {
            set_clauses.push(format!("status = ${}", param_idx));
            param_idx += 1;
        }
        if update.risk_level.is_some() {
            set_clauses.push(format!("risk_level = ${}", param_idx));
            // param_idx += 1;
        }

        if set_clauses.is_empty() {
            return self.get(id).await;
        }

        let query = format!(
            "UPDATE tools SET {} WHERE id = $1 RETURNING *",
            set_clauses.join(", ")
        );

        let mut q = sqlx::query_as::<_, Tool>(&query).bind(id);

        if let Some(name) = &update.name {
            q = q.bind(name);
        }
        if let Some(desc) = &update.description {
            q = q.bind(desc);
        }
        if let Some(status) = &update.status {
            q = q.bind(status);
        }
        if let Some(risk) = &update.risk_level {
            q = q.bind(risk);
        }

        q.fetch_optional(&self.pool).await
    }

    /// List tools (global + project-specific)
    #[instrument(skip(self))]
    pub async fn list(
        &self,
        project_id: Option<&str>,
        status: Option<ToolStatus>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Tool>, sqlx::Error> {
        match (project_id, status) {
            (Some(pid), Some(s)) => {
                sqlx::query_as::<_, Tool>(
                    r#"
                    SELECT * FROM tools
                    WHERE (project_id = $1 OR project_id IS NULL) AND status = $2
                    ORDER BY name ASC
                    LIMIT $3 OFFSET $4
                    "#,
                )
                .bind(pid)
                .bind(s)
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
            }
            (Some(pid), None) => {
                sqlx::query_as::<_, Tool>(
                    r#"
                    SELECT * FROM tools
                    WHERE project_id = $1 OR project_id IS NULL
                    ORDER BY name ASC
                    LIMIT $2 OFFSET $3
                    "#,
                )
                .bind(pid)
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
            }
            (None, Some(s)) => {
                sqlx::query_as::<_, Tool>(
                    r#"
                    SELECT * FROM tools
                    WHERE status = $1
                    ORDER BY name ASC
                    LIMIT $2 OFFSET $3
                    "#,
                )
                .bind(s)
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
            }
            (None, None) => {
                sqlx::query_as::<_, Tool>(
                    r#"
                    SELECT * FROM tools
                    ORDER BY name ASC
                    LIMIT $1 OFFSET $2
                    "#,
                )
                .bind(limit)
                .bind(offset)
                .fetch_all(&self.pool)
                .await
            }
        }
    }

    // =========================================================================
    // Tool Versions
    // =========================================================================

    /// Create a new tool version
    #[instrument(skip(self, version), fields(version_id = %version.id))]
    pub async fn create_version(
        &self,
        version: CreateToolVersion,
    ) -> Result<ToolVersion, sqlx::Error> {
        sqlx::query_as::<_, ToolVersion>(
            r#"
            INSERT INTO tool_versions (id, tool_id, version, input_schema, output_schema, changelog)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *
            "#,
        )
        .bind(&version.id)
        .bind(&version.tool_id)
        .bind(&version.version)
        .bind(&version.input_schema)
        .bind(&version.output_schema)
        .bind(&version.changelog)
        .fetch_one(&self.pool)
        .await
    }

    /// Get a tool version by ID
    #[instrument(skip(self))]
    pub async fn get_version(&self, id: &str) -> Result<Option<ToolVersion>, sqlx::Error> {
        sqlx::query_as::<_, ToolVersion>("SELECT * FROM tool_versions WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Get the latest version of a tool
    #[instrument(skip(self))]
    pub async fn get_latest_version(
        &self,
        tool_id: &str,
    ) -> Result<Option<ToolVersion>, sqlx::Error> {
        sqlx::query_as::<_, ToolVersion>(
            r#"
            SELECT * FROM tool_versions
            WHERE tool_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(tool_id)
        .fetch_optional(&self.pool)
        .await
    }
}
