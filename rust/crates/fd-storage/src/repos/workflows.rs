//! Workflow repository

use chrono::Utc;
use sqlx::PgPool;

use crate::models::{
    CreateWorkflow, CreateWorkflowRun, CreateWorkflowStepExecution, UpdateWorkflow,
    UpdateWorkflowRun, UpdateWorkflowStepExecution, Workflow, WorkflowRun, WorkflowRunStatus,
    WorkflowStatus, WorkflowStepExecution, WorkflowStepExecutionStatus,
};

/// Repository for workflow operations
#[derive(Clone)]
pub struct WorkflowsRepo {
    pool: PgPool,
}

impl WorkflowsRepo {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    // =========================================================================
    // Workflow CRUD
    // =========================================================================

    pub async fn create(&self, workflow: CreateWorkflow) -> Result<Workflow, sqlx::Error> {
        let now = Utc::now();
        sqlx::query_as::<_, Workflow>(
            r#"
            INSERT INTO workflows (id, project_id, name, description, version, status, definition, max_iterations, on_error, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING *
            "#,
        )
        .bind(&workflow.id)
        .bind(&workflow.project_id)
        .bind(&workflow.name)
        .bind(&workflow.description)
        .bind(&workflow.version)
        .bind(WorkflowStatus::Active)
        .bind(&workflow.definition)
        .bind(workflow.max_iterations)
        .bind(&workflow.on_error)
        .bind(now)
        .bind(now)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get(&self, id: &str) -> Result<Option<Workflow>, sqlx::Error> {
        sqlx::query_as::<_, Workflow>("SELECT * FROM workflows WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn get_by_name_and_project(
        &self,
        name: &str,
        project_id: &str,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        sqlx::query_as::<_, Workflow>(
            "SELECT * FROM workflows WHERE name = $1 AND project_id = $2 AND status = 'active'",
        )
        .bind(name)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn list_by_project(
        &self,
        project_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Workflow>, sqlx::Error> {
        sqlx::query_as::<_, Workflow>(
            r#"
            SELECT * FROM workflows
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

    pub async fn update(
        &self,
        id: &str,
        update: UpdateWorkflow,
    ) -> Result<Option<Workflow>, sqlx::Error> {
        let now = Utc::now();
        sqlx::query_as::<_, Workflow>(
            r#"
            UPDATE workflows
            SET
                name = COALESCE($1, name),
                description = COALESCE($2, description),
                status = COALESCE($3, status),
                definition = COALESCE($4, definition),
                max_iterations = COALESCE($5, max_iterations),
                on_error = COALESCE($6, on_error),
                updated_at = $7
            WHERE id = $8
            RETURNING *
            "#,
        )
        .bind(&update.name)
        .bind(&update.description)
        .bind(&update.status)
        .bind(&update.definition)
        .bind(&update.max_iterations)
        .bind(&update.on_error)
        .bind(now)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    // =========================================================================
    // Workflow Run CRUD
    // =========================================================================

    pub async fn create_run(&self, run: CreateWorkflowRun) -> Result<WorkflowRun, sqlx::Error> {
        let now = Utc::now();
        sqlx::query_as::<_, WorkflowRun>(
            r#"
            INSERT INTO workflow_runs (id, workflow_id, project_id, status, input, context, step_results, input_tokens, output_tokens, tool_calls, cost_cents, created_at, trace_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, 0, 0, $8, $9)
            RETURNING *
            "#,
        )
        .bind(&run.id)
        .bind(&run.workflow_id)
        .bind(&run.project_id)
        .bind(WorkflowRunStatus::Created)
        .bind(&run.input)
        .bind(serde_json::json!({}))
        .bind(serde_json::json!({}))
        .bind(now)
        .bind(&run.trace_id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_run(&self, id: &str) -> Result<Option<WorkflowRun>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowRun>("SELECT * FROM workflow_runs WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    pub async fn list_runs_by_workflow(
        &self,
        workflow_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowRun>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowRun>(
            r#"
            SELECT * FROM workflow_runs
            WHERE workflow_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(workflow_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn list_runs_by_project(
        &self,
        project_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<WorkflowRun>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowRun>(
            r#"
            SELECT * FROM workflow_runs
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

    pub async fn update_run(
        &self,
        id: &str,
        update: UpdateWorkflowRun,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowRun>(
            r#"
            UPDATE workflow_runs
            SET
                status = COALESCE($1, status),
                current_step_id = COALESCE($2, current_step_id),
                step_results = COALESCE($3, step_results),
                output = COALESCE($4, output),
                error = COALESCE($5, error),
                input_tokens = COALESCE($6, input_tokens),
                output_tokens = COALESCE($7, output_tokens),
                tool_calls = COALESCE($8, tool_calls),
                cost_cents = COALESCE($9, cost_cents),
                started_at = COALESCE($10, started_at),
                completed_at = COALESCE($11, completed_at)
            WHERE id = $12
            RETURNING *
            "#,
        )
        .bind(&update.status)
        .bind(&update.current_step_id)
        .bind(&update.step_results)
        .bind(&update.output)
        .bind(&update.error)
        .bind(&update.input_tokens)
        .bind(&update.output_tokens)
        .bind(&update.tool_calls)
        .bind(&update.cost_cents)
        .bind(&update.started_at)
        .bind(&update.completed_at)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn update_run_status(
        &self,
        id: &str,
        status: WorkflowRunStatus,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowRun>(
            "UPDATE workflow_runs SET status = $1 WHERE id = $2 RETURNING *",
        )
        .bind(status)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn update_run_step_results(
        &self,
        id: &str,
        step_id: &str,
        result: serde_json::Value,
    ) -> Result<Option<WorkflowRun>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowRun>(
            r#"
            UPDATE workflow_runs
            SET step_results = jsonb_set(step_results, $1, $2)
            WHERE id = $3
            RETURNING *
            "#,
        )
        .bind(format!("{{{}}}", step_id))
        .bind(&result)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn increment_run_usage(
        &self,
        id: &str,
        input_tokens: i32,
        output_tokens: i32,
        tool_calls: i32,
        cost_cents: i32,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE workflow_runs
            SET
                input_tokens = input_tokens + $1,
                output_tokens = output_tokens + $2,
                tool_calls = tool_calls + $3,
                cost_cents = cost_cents + $4
            WHERE id = $5
            "#,
        )
        .bind(input_tokens)
        .bind(output_tokens)
        .bind(tool_calls)
        .bind(cost_cents)
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // =========================================================================
    // Workflow Step Execution CRUD
    // =========================================================================

    pub async fn create_step_execution(
        &self,
        exec: CreateWorkflowStepExecution,
    ) -> Result<WorkflowStepExecution, sqlx::Error> {
        sqlx::query_as::<_, WorkflowStepExecution>(
            r#"
            INSERT INTO workflow_step_executions (id, workflow_run_id, step_id, step_type, status, input, attempt, span_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&exec.id)
        .bind(&exec.workflow_run_id)
        .bind(&exec.step_id)
        .bind(&exec.step_type)
        .bind(WorkflowStepExecutionStatus::Pending)
        .bind(&exec.input)
        .bind(exec.attempt)
        .bind(&exec.span_id)
        .fetch_one(&self.pool)
        .await
    }

    pub async fn get_step_execution(
        &self,
        id: &str,
    ) -> Result<Option<WorkflowStepExecution>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowStepExecution>(
            "SELECT * FROM workflow_step_executions WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn list_step_executions_by_run(
        &self,
        workflow_run_id: &str,
    ) -> Result<Vec<WorkflowStepExecution>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowStepExecution>(
            r#"
            SELECT * FROM workflow_step_executions
            WHERE workflow_run_id = $1
            ORDER BY started_at ASC NULLS LAST
            "#,
        )
        .bind(workflow_run_id)
        .fetch_all(&self.pool)
        .await
    }

    pub async fn get_latest_step_execution(
        &self,
        workflow_run_id: &str,
        step_id: &str,
    ) -> Result<Option<WorkflowStepExecution>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowStepExecution>(
            r#"
            SELECT * FROM workflow_step_executions
            WHERE workflow_run_id = $1 AND step_id = $2
            ORDER BY attempt DESC
            LIMIT 1
            "#,
        )
        .bind(workflow_run_id)
        .bind(step_id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn update_step_execution(
        &self,
        id: &str,
        update: UpdateWorkflowStepExecution,
    ) -> Result<Option<WorkflowStepExecution>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowStepExecution>(
            r#"
            UPDATE workflow_step_executions
            SET
                status = COALESCE($1, status),
                output = COALESCE($2, output),
                error = COALESCE($3, error),
                input_tokens = COALESCE($4, input_tokens),
                output_tokens = COALESCE($5, output_tokens),
                started_at = COALESCE($6, started_at),
                completed_at = COALESCE($7, completed_at)
            WHERE id = $8
            RETURNING *
            "#,
        )
        .bind(&update.status)
        .bind(&update.output)
        .bind(&update.error)
        .bind(&update.input_tokens)
        .bind(&update.output_tokens)
        .bind(&update.started_at)
        .bind(&update.completed_at)
        .bind(id)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn get_pending_step_executions(
        &self,
        workflow_run_id: &str,
    ) -> Result<Vec<WorkflowStepExecution>, sqlx::Error> {
        sqlx::query_as::<_, WorkflowStepExecution>(
            r#"
            SELECT * FROM workflow_step_executions
            WHERE workflow_run_id = $1 AND status = 'pending'
            ORDER BY started_at ASC NULLS LAST
            "#,
        )
        .bind(workflow_run_id)
        .fetch_all(&self.pool)
        .await
    }
}
