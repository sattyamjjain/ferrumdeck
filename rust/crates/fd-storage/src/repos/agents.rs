//! Agents repository

use crate::models::{
    Agent, AgentStatus, AgentVersion, CreateAgent, CreateAgentVersion, UpdateAgent,
};
use crate::DbPool;
use tracing::instrument;

/// Repository for agent operations
#[derive(Clone)]
pub struct AgentsRepo {
    pool: DbPool,
}

impl AgentsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create a new agent
    #[instrument(skip(self, agent), fields(agent_id = %agent.id))]
    pub async fn create(&self, agent: CreateAgent) -> Result<Agent, sqlx::Error> {
        sqlx::query_as::<_, Agent>(
            r#"
            INSERT INTO agents (id, project_id, name, slug, description)
            VALUES ($1, $2, $3, $4, $5)
            RETURNING *
            "#,
        )
        .bind(&agent.id)
        .bind(&agent.project_id)
        .bind(&agent.name)
        .bind(&agent.slug)
        .bind(&agent.description)
        .fetch_one(&self.pool)
        .await
    }

    /// Get an agent by ID
    #[instrument(skip(self))]
    pub async fn get(&self, id: &str) -> Result<Option<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Get an agent by slug
    #[instrument(skip(self))]
    pub async fn get_by_slug(
        &self,
        project_id: &str,
        slug: &str,
    ) -> Result<Option<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE project_id = $1 AND slug = $2")
            .bind(project_id)
            .bind(slug)
            .fetch_optional(&self.pool)
            .await
    }

    /// Find an agent by slug (global lookup without project_id)
    /// Used when caller provides a slug instead of an ID
    #[instrument(skip(self))]
    pub async fn find_by_slug(&self, slug: &str) -> Result<Option<Agent>, sqlx::Error> {
        sqlx::query_as::<_, Agent>("SELECT * FROM agents WHERE slug = $1")
            .bind(slug)
            .fetch_optional(&self.pool)
            .await
    }

    /// Update an agent
    #[instrument(skip(self, update), fields(agent_id = %id))]
    pub async fn update(
        &self,
        id: &str,
        update: UpdateAgent,
    ) -> Result<Option<Agent>, sqlx::Error> {
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
        }

        if set_clauses.is_empty() {
            return self.get(id).await;
        }

        let query = format!(
            "UPDATE agents SET {} WHERE id = $1 RETURNING *",
            set_clauses.join(", ")
        );

        let mut q = sqlx::query_as::<_, Agent>(&query).bind(id);

        if let Some(name) = &update.name {
            q = q.bind(name);
        }
        if let Some(desc) = &update.description {
            q = q.bind(desc);
        }
        if let Some(status) = &update.status {
            q = q.bind(status);
        }

        q.fetch_optional(&self.pool).await
    }

    /// List agents for a project
    #[instrument(skip(self))]
    pub async fn list_by_project(
        &self,
        project_id: &str,
        status: Option<AgentStatus>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Agent>, sqlx::Error> {
        if let Some(status) = status {
            sqlx::query_as::<_, Agent>(
                r#"
                SELECT * FROM agents
                WHERE project_id = $1 AND status = $2
                ORDER BY name ASC
                LIMIT $3 OFFSET $4
                "#,
            )
            .bind(project_id)
            .bind(status)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
        } else {
            sqlx::query_as::<_, Agent>(
                r#"
                SELECT * FROM agents
                WHERE project_id = $1
                ORDER BY name ASC
                LIMIT $2 OFFSET $3
                "#,
            )
            .bind(project_id)
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
        }
    }

    // =========================================================================
    // Agent Versions
    // =========================================================================

    /// Create a new agent version
    #[instrument(skip(self, version), fields(version_id = %version.id))]
    pub async fn create_version(
        &self,
        version: CreateAgentVersion,
    ) -> Result<AgentVersion, sqlx::Error> {
        sqlx::query_as::<_, AgentVersion>(
            r#"
            INSERT INTO agent_versions (
                id, agent_id, version, system_prompt, model, model_params,
                allowed_tools, tool_configs, max_tokens, max_tool_calls,
                max_wall_time_secs, max_cost_cents, changelog, created_by
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
            "#,
        )
        .bind(&version.id)
        .bind(&version.agent_id)
        .bind(&version.version)
        .bind(&version.system_prompt)
        .bind(&version.model)
        .bind(&version.model_params)
        .bind(&version.allowed_tools)
        .bind(&version.tool_configs)
        .bind(version.max_tokens)
        .bind(version.max_tool_calls)
        .bind(version.max_wall_time_secs)
        .bind(version.max_cost_cents)
        .bind(&version.changelog)
        .bind(&version.created_by)
        .fetch_one(&self.pool)
        .await
    }

    /// Get an agent version by ID
    #[instrument(skip(self))]
    pub async fn get_version(&self, id: &str) -> Result<Option<AgentVersion>, sqlx::Error> {
        sqlx::query_as::<_, AgentVersion>("SELECT * FROM agent_versions WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Get the latest version of an agent
    #[instrument(skip(self))]
    pub async fn get_latest_version(
        &self,
        agent_id: &str,
    ) -> Result<Option<AgentVersion>, sqlx::Error> {
        sqlx::query_as::<_, AgentVersion>(
            r#"
            SELECT * FROM agent_versions
            WHERE agent_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(agent_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// List all versions of an agent
    #[instrument(skip(self))]
    pub async fn list_versions(&self, agent_id: &str) -> Result<Vec<AgentVersion>, sqlx::Error> {
        sqlx::query_as::<_, AgentVersion>(
            r#"
            SELECT * FROM agent_versions
            WHERE agent_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await
    }
}
