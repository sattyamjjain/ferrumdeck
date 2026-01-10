//! Steps repository

use crate::models::{CreateArtifact, CreateStep, Step, StepArtifact, StepStatus, UpdateStep};
use crate::DbPool;
use sqlx::Row;
use tracing::instrument;

/// Repository for step operations
#[derive(Clone)]
pub struct StepsRepo {
    pool: DbPool,
}

impl StepsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create a new step
    #[instrument(skip(self, step), fields(step_id = %step.id))]
    pub async fn create(&self, step: CreateStep) -> Result<Step, sqlx::Error> {
        sqlx::query_as::<_, Step>(
            r#"
            INSERT INTO steps (id, run_id, parent_step_id, step_number, step_type, input, tool_name, tool_version, model, span_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
            "#,
        )
        .bind(&step.id)
        .bind(&step.run_id)
        .bind(&step.parent_step_id)
        .bind(step.step_number)
        .bind(step.step_type)
        .bind(&step.input)
        .bind(&step.tool_name)
        .bind(&step.tool_version)
        .bind(&step.model)
        .bind(&step.span_id)
        .fetch_one(&self.pool)
        .await
    }

    /// Get a step by ID
    #[instrument(skip(self))]
    pub async fn get(&self, id: &str) -> Result<Option<Step>, sqlx::Error> {
        sqlx::query_as::<_, Step>("SELECT * FROM steps WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Update a step
    #[instrument(skip(self, update), fields(step_id = %id))]
    pub async fn update(&self, id: &str, update: UpdateStep) -> Result<Option<Step>, sqlx::Error> {
        let mut set_clauses = Vec::new();
        let mut param_idx = 2;

        if update.status.is_some() {
            set_clauses.push(format!("status = ${}", param_idx));
            param_idx += 1;
        }
        if update.output.is_some() {
            set_clauses.push(format!("output = ${}", param_idx));
            param_idx += 1;
        }
        if update.error.is_some() {
            set_clauses.push(format!("error = ${}", param_idx));
            param_idx += 1;
        }
        if update.input_tokens.is_some() {
            set_clauses.push(format!("input_tokens = ${}", param_idx));
            param_idx += 1;
        }
        if update.output_tokens.is_some() {
            set_clauses.push(format!("output_tokens = ${}", param_idx));
            param_idx += 1;
        }
        if update.started_at.is_some() {
            set_clauses.push(format!("started_at = ${}", param_idx));
            param_idx += 1;
        }
        if update.completed_at.is_some() {
            set_clauses.push(format!("completed_at = ${}", param_idx));
        }

        if set_clauses.is_empty() {
            return self.get(id).await;
        }

        let query = format!(
            "UPDATE steps SET {} WHERE id = $1 RETURNING *",
            set_clauses.join(", ")
        );

        let mut q = sqlx::query_as::<_, Step>(&query).bind(id);

        if let Some(status) = &update.status {
            q = q.bind(status);
        }
        if let Some(output) = &update.output {
            q = q.bind(output);
        }
        if let Some(error) = &update.error {
            q = q.bind(error);
        }
        if let Some(tokens) = &update.input_tokens {
            q = q.bind(tokens);
        }
        if let Some(tokens) = &update.output_tokens {
            q = q.bind(tokens);
        }
        if let Some(started) = &update.started_at {
            q = q.bind(started);
        }
        if let Some(completed) = &update.completed_at {
            q = q.bind(completed);
        }

        q.fetch_optional(&self.pool).await
    }

    /// Update step status
    #[instrument(skip(self))]
    pub async fn update_status(
        &self,
        id: &str,
        status: StepStatus,
    ) -> Result<Option<Step>, sqlx::Error> {
        sqlx::query_as::<_, Step>(
            r#"
            UPDATE steps SET status = $2 WHERE id = $1 RETURNING *
            "#,
        )
        .bind(id)
        .bind(status)
        .fetch_optional(&self.pool)
        .await
    }

    /// List steps for a run
    #[instrument(skip(self))]
    pub async fn list_by_run(&self, run_id: &str) -> Result<Vec<Step>, sqlx::Error> {
        sqlx::query_as::<_, Step>(
            r#"
            SELECT * FROM steps
            WHERE run_id = $1
            ORDER BY step_number ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Get pending steps for a run
    #[instrument(skip(self))]
    pub async fn get_pending_steps(&self, run_id: &str) -> Result<Vec<Step>, sqlx::Error> {
        sqlx::query_as::<_, Step>(
            r#"
            SELECT * FROM steps
            WHERE run_id = $1 AND status = 'pending'
            ORDER BY step_number ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Get the next step number for a run
    #[instrument(skip(self))]
    pub async fn next_step_number(&self, run_id: &str) -> Result<i32, sqlx::Error> {
        let row = sqlx::query(
            "SELECT COALESCE(MAX(step_number), 0) + 1 as next FROM steps WHERE run_id = $1",
        )
        .bind(run_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(row.get("next"))
    }

    /// Count steps by status for a run
    #[instrument(skip(self))]
    pub async fn count_by_status(
        &self,
        run_id: &str,
    ) -> Result<std::collections::HashMap<String, i64>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT status::text, COUNT(*) as count
            FROM steps
            WHERE run_id = $1
            GROUP BY status
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;

        let mut counts = std::collections::HashMap::new();
        for row in rows {
            let status: String = row.get("status");
            let count: i64 = row.get("count");
            counts.insert(status, count);
        }
        Ok(counts)
    }

    // =========================================================================
    // Artifacts
    // =========================================================================

    /// Create an artifact
    #[instrument(skip(self, artifact), fields(artifact_id = %artifact.id))]
    pub async fn create_artifact(
        &self,
        artifact: CreateArtifact,
    ) -> Result<StepArtifact, sqlx::Error> {
        sqlx::query_as::<_, StepArtifact>(
            r#"
            INSERT INTO step_artifacts (id, step_id, name, content_type, size_bytes, storage_path, checksum)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&artifact.id)
        .bind(&artifact.step_id)
        .bind(&artifact.name)
        .bind(&artifact.content_type)
        .bind(artifact.size_bytes)
        .bind(&artifact.storage_path)
        .bind(&artifact.checksum)
        .fetch_one(&self.pool)
        .await
    }

    /// List artifacts for a step
    #[instrument(skip(self))]
    pub async fn list_artifacts(&self, step_id: &str) -> Result<Vec<StepArtifact>, sqlx::Error> {
        sqlx::query_as::<_, StepArtifact>(
            r#"
            SELECT * FROM step_artifacts
            WHERE step_id = $1
            ORDER BY created_at ASC
            "#,
        )
        .bind(step_id)
        .fetch_all(&self.pool)
        .await
    }
}
