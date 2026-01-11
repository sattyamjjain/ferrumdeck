//! Threats repository for Airlock security events

use crate::models::threats::{CreateThreat, CreateVelocityEvent, Threat, VelocityEvent};
use crate::DbPool;
use tracing::instrument;

/// Repository for threat operations
#[derive(Clone)]
pub struct ThreatsRepo {
    pool: DbPool,
}

impl ThreatsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create a new threat record
    #[instrument(skip(self, threat), fields(threat_id = %threat.id))]
    pub async fn create(&self, threat: CreateThreat) -> Result<Threat, sqlx::Error> {
        sqlx::query_as::<_, Threat>(
            r#"
            INSERT INTO threats (
                id, run_id, step_id, tool_name, risk_score, risk_level,
                violation_type, violation_details, blocked_payload, trigger_pattern,
                action, shadow_mode, project_id, tenant_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING *
            "#,
        )
        .bind(&threat.id)
        .bind(&threat.run_id)
        .bind(&threat.step_id)
        .bind(&threat.tool_name)
        .bind(threat.risk_score)
        .bind(&threat.risk_level)
        .bind(&threat.violation_type)
        .bind(&threat.violation_details)
        .bind(&threat.blocked_payload)
        .bind(&threat.trigger_pattern)
        .bind(&threat.action)
        .bind(threat.shadow_mode)
        .bind(&threat.project_id)
        .bind(&threat.tenant_id)
        .fetch_one(&self.pool)
        .await
    }

    /// Get a threat by ID
    #[instrument(skip(self))]
    pub async fn get(&self, id: &str) -> Result<Option<Threat>, sqlx::Error> {
        sqlx::query_as::<_, Threat>("SELECT * FROM threats WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// List threats for a run
    #[instrument(skip(self))]
    pub async fn list_by_run(&self, run_id: &str) -> Result<Vec<Threat>, sqlx::Error> {
        sqlx::query_as::<_, Threat>(
            r#"
            SELECT * FROM threats
            WHERE run_id = $1
            ORDER BY created_at DESC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
    }

    /// List threats for a project
    #[instrument(skip(self))]
    pub async fn list_by_project(
        &self,
        project_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Threat>, sqlx::Error> {
        sqlx::query_as::<_, Threat>(
            r#"
            SELECT * FROM threats
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

    /// List recent threats for a tenant
    #[instrument(skip(self))]
    pub async fn list_by_tenant(
        &self,
        tenant_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Threat>, sqlx::Error> {
        sqlx::query_as::<_, Threat>(
            r#"
            SELECT * FROM threats
            WHERE tenant_id = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(tenant_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }

    /// Count threats by project
    #[instrument(skip(self))]
    pub async fn count_by_project(&self, project_id: &str) -> Result<i64, sqlx::Error> {
        let result: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM threats WHERE project_id = $1")
            .bind(project_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(result.0)
    }

    /// Count threats by tenant
    #[instrument(skip(self))]
    pub async fn count_by_tenant(&self, tenant_id: &str) -> Result<i64, sqlx::Error> {
        let result: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM threats WHERE tenant_id = $1")
            .bind(tenant_id)
            .fetch_one(&self.pool)
            .await?;
        Ok(result.0)
    }

    /// List threats by risk level
    #[instrument(skip(self))]
    pub async fn list_by_risk_level(
        &self,
        risk_level: &str,
        limit: i64,
    ) -> Result<Vec<Threat>, sqlx::Error> {
        sqlx::query_as::<_, Threat>(
            r#"
            SELECT * FROM threats
            WHERE risk_level = $1
            ORDER BY created_at DESC
            LIMIT $2
            "#,
        )
        .bind(risk_level)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// List all threats with optional filtering
    #[instrument(skip(self))]
    pub async fn list_all(
        &self,
        run_id: Option<&str>,
        risk_level: Option<&str>,
        violation_type: Option<&str>,
        action: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<Threat>, sqlx::Error> {
        // Build dynamic query with optional filters
        let mut query = String::from("SELECT * FROM threats WHERE 1=1");
        let mut param_count = 0;

        if run_id.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND run_id = ${}", param_count));
        }
        if risk_level.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND risk_level = ${}", param_count));
        }
        if violation_type.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND violation_type = ${}", param_count));
        }
        if action.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND action = ${}", param_count));
        }

        query.push_str(&format!(
            " ORDER BY created_at DESC LIMIT ${} OFFSET ${}",
            param_count + 1,
            param_count + 2
        ));

        let mut sqlx_query = sqlx::query_as::<_, Threat>(&query);

        if let Some(v) = run_id {
            sqlx_query = sqlx_query.bind(v);
        }
        if let Some(v) = risk_level {
            sqlx_query = sqlx_query.bind(v);
        }
        if let Some(v) = violation_type {
            sqlx_query = sqlx_query.bind(v);
        }
        if let Some(v) = action {
            sqlx_query = sqlx_query.bind(v);
        }

        sqlx_query
            .bind(limit)
            .bind(offset)
            .fetch_all(&self.pool)
            .await
    }

    /// Count all threats with optional filtering
    #[instrument(skip(self))]
    pub async fn count_all(
        &self,
        run_id: Option<&str>,
        risk_level: Option<&str>,
        violation_type: Option<&str>,
        action: Option<&str>,
    ) -> Result<i64, sqlx::Error> {
        let mut query = String::from("SELECT COUNT(*) FROM threats WHERE 1=1");
        let mut param_count = 0;

        if run_id.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND run_id = ${}", param_count));
        }
        if risk_level.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND risk_level = ${}", param_count));
        }
        if violation_type.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND violation_type = ${}", param_count));
        }
        if action.is_some() {
            param_count += 1;
            query.push_str(&format!(" AND action = ${}", param_count));
        }

        let mut sqlx_query = sqlx::query_as::<_, (i64,)>(&query);

        if let Some(v) = run_id {
            sqlx_query = sqlx_query.bind(v);
        }
        if let Some(v) = risk_level {
            sqlx_query = sqlx_query.bind(v);
        }
        if let Some(v) = violation_type {
            sqlx_query = sqlx_query.bind(v);
        }
        if let Some(v) = action {
            sqlx_query = sqlx_query.bind(v);
        }

        let result = sqlx_query.fetch_one(&self.pool).await?;
        Ok(result.0)
    }

    /// Create a velocity event
    #[instrument(skip(self, event))]
    pub async fn create_velocity_event(
        &self,
        event: CreateVelocityEvent,
    ) -> Result<VelocityEvent, sqlx::Error> {
        sqlx::query_as::<_, VelocityEvent>(
            r#"
            INSERT INTO velocity_events (run_id, tool_name, tool_input_hash, cost_cents)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            "#,
        )
        .bind(&event.run_id)
        .bind(&event.tool_name)
        .bind(&event.tool_input_hash)
        .bind(event.cost_cents)
        .fetch_one(&self.pool)
        .await
    }

    /// Get recent velocity events for a run (for circuit breaker checks)
    #[instrument(skip(self))]
    pub async fn get_recent_velocity_events(
        &self,
        run_id: &str,
        window_seconds: i64,
    ) -> Result<Vec<VelocityEvent>, sqlx::Error> {
        sqlx::query_as::<_, VelocityEvent>(
            r#"
            SELECT * FROM velocity_events
            WHERE run_id = $1
              AND created_at >= NOW() - INTERVAL '1 second' * $2
            ORDER BY created_at DESC
            "#,
        )
        .bind(run_id)
        .bind(window_seconds)
        .fetch_all(&self.pool)
        .await
    }

    /// Clean up old velocity events
    #[instrument(skip(self))]
    pub async fn cleanup_old_velocity_events(
        &self,
        older_than_hours: i64,
    ) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            DELETE FROM velocity_events
            WHERE created_at < NOW() - INTERVAL '1 hour' * $1
            "#,
        )
        .bind(older_than_hours)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected())
    }
}
