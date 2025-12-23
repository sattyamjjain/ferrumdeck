//! Runs repository

use crate::models::{CreateRun, Run, RunStatus, UpdateRun};
use crate::DbPool;
use sqlx::Row;
use tracing::instrument;

/// Repository for run operations
#[derive(Clone)]
pub struct RunsRepo {
    pool: DbPool,
}

impl RunsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create a new run
    #[instrument(skip(self, run), fields(run_id = %run.id))]
    pub async fn create(&self, run: CreateRun) -> Result<Run, sqlx::Error> {
        sqlx::query_as::<_, Run>(
            r#"
            INSERT INTO runs (id, project_id, agent_version_id, input, config, trace_id, span_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *
            "#,
        )
        .bind(&run.id)
        .bind(&run.project_id)
        .bind(&run.agent_version_id)
        .bind(&run.input)
        .bind(&run.config)
        .bind(&run.trace_id)
        .bind(&run.span_id)
        .fetch_one(&self.pool)
        .await
    }

    /// Get a run by ID
    #[instrument(skip(self))]
    pub async fn get(&self, id: &str) -> Result<Option<Run>, sqlx::Error> {
        sqlx::query_as::<_, Run>("SELECT * FROM runs WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Update a run
    #[instrument(skip(self, update), fields(run_id = %id))]
    pub async fn update(&self, id: &str, update: UpdateRun) -> Result<Option<Run>, sqlx::Error> {
        // Build dynamic update query
        let mut set_clauses = Vec::new();
        let mut param_idx = 2; // $1 is the id

        if update.status.is_some() {
            set_clauses.push(format!("status = ${}", param_idx));
            param_idx += 1;
        }
        if update.status_reason.is_some() {
            set_clauses.push(format!("status_reason = ${}", param_idx));
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
        if update.tool_calls.is_some() {
            set_clauses.push(format!("tool_calls = ${}", param_idx));
            param_idx += 1;
        }
        if update.cost_cents.is_some() {
            set_clauses.push(format!("cost_cents = ${}", param_idx));
            param_idx += 1;
        }
        if update.started_at.is_some() {
            set_clauses.push(format!("started_at = ${}", param_idx));
            param_idx += 1;
        }
        if update.completed_at.is_some() {
            set_clauses.push(format!("completed_at = ${}", param_idx));
            param_idx += 1;
        }
        if update.output.is_some() {
            set_clauses.push(format!("output = ${}", param_idx));
            param_idx += 1;
        }
        if update.error.is_some() {
            set_clauses.push(format!("error = ${}", param_idx));
            // param_idx += 1;
        }

        if set_clauses.is_empty() {
            return self.get(id).await;
        }

        let query = format!(
            "UPDATE runs SET {} WHERE id = $1 RETURNING *",
            set_clauses.join(", ")
        );

        let mut q = sqlx::query_as::<_, Run>(&query).bind(id);

        if let Some(status) = &update.status {
            q = q.bind(status);
        }
        if let Some(reason) = &update.status_reason {
            q = q.bind(reason);
        }
        if let Some(tokens) = &update.input_tokens {
            q = q.bind(tokens);
        }
        if let Some(tokens) = &update.output_tokens {
            q = q.bind(tokens);
        }
        if let Some(calls) = &update.tool_calls {
            q = q.bind(calls);
        }
        if let Some(cost) = &update.cost_cents {
            q = q.bind(cost);
        }
        if let Some(started) = &update.started_at {
            q = q.bind(started);
        }
        if let Some(completed) = &update.completed_at {
            q = q.bind(completed);
        }
        if let Some(output) = &update.output {
            q = q.bind(output);
        }
        if let Some(error) = &update.error {
            q = q.bind(error);
        }

        q.fetch_optional(&self.pool).await
    }

    /// Update run status
    #[instrument(skip(self))]
    pub async fn update_status(
        &self,
        id: &str,
        status: RunStatus,
        reason: Option<&str>,
    ) -> Result<Option<Run>, sqlx::Error> {
        sqlx::query_as::<_, Run>(
            r#"
            UPDATE runs
            SET status = $2, status_reason = $3
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(status)
        .bind(reason)
        .fetch_optional(&self.pool)
        .await
    }

    /// List runs for a project
    #[instrument(skip(self))]
    pub async fn list_by_project(
        &self,
        project_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Run>, sqlx::Error> {
        sqlx::query_as::<_, Run>(
            r#"
            SELECT * FROM runs
            WHERE project_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(project_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    /// List runs by status
    #[instrument(skip(self))]
    pub async fn list_by_status(
        &self,
        status: RunStatus,
        limit: i64,
    ) -> Result<Vec<Run>, sqlx::Error> {
        sqlx::query_as::<_, Run>(
            r#"
            SELECT * FROM runs
            WHERE status = $1
            ORDER BY created_at ASC
            LIMIT $2
            "#,
        )
        .bind(status)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// Count runs for a project
    #[instrument(skip(self))]
    pub async fn count_by_project(&self, project_id: &str) -> Result<i64, sqlx::Error> {
        let row = sqlx::query("SELECT COUNT(*) as count FROM runs WHERE project_id = $1")
            .bind(project_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get("count"))
    }

    /// Increment usage counters atomically
    #[instrument(skip(self))]
    pub async fn increment_usage(
        &self,
        id: &str,
        input_tokens: i32,
        output_tokens: i32,
        tool_calls: i32,
        cost_cents: i32,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE runs
            SET input_tokens = input_tokens + $2,
                output_tokens = output_tokens + $3,
                tool_calls = tool_calls + $4,
                cost_cents = cost_cents + $5
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(input_tokens)
        .bind(output_tokens)
        .bind(tool_calls)
        .bind(cost_cents)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
