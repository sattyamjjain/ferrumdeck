//! Audit events repository

use crate::models::{AuditEvent, CreateAuditEvent};
use crate::DbPool;
use tracing::instrument;

/// Repository for audit event operations
#[derive(Clone)]
pub struct AuditRepo {
    pool: DbPool,
}

impl AuditRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create an audit event
    #[instrument(skip(self, event), fields(event_id = %event.id))]
    pub async fn create(&self, event: CreateAuditEvent) -> Result<AuditEvent, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            INSERT INTO audit_events (
                id, actor_type, actor_id, action, resource_type, resource_id,
                details, tenant_id, workspace_id, project_id, run_id,
                request_id, ip_address, user_agent, trace_id, span_id
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::inet, $14, $15, $16)
            RETURNING *
            "#,
        )
        .bind(&event.id)
        .bind(&event.actor_type)
        .bind(&event.actor_id)
        .bind(&event.action)
        .bind(&event.resource_type)
        .bind(&event.resource_id)
        .bind(&event.details)
        .bind(&event.tenant_id)
        .bind(&event.workspace_id)
        .bind(&event.project_id)
        .bind(&event.run_id)
        .bind(&event.request_id)
        .bind(&event.ip_address)
        .bind(&event.user_agent)
        .bind(&event.trace_id)
        .bind(&event.span_id)
        .fetch_one(&self.pool)
        .await
    }

    /// List audit events for a run
    #[instrument(skip(self))]
    pub async fn list_by_run(&self, run_id: &str) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE run_id = $1
            ORDER BY occurred_at ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
    }

    /// List audit events by resource
    #[instrument(skip(self))]
    pub async fn list_by_resource(
        &self,
        resource_type: &str,
        resource_id: &str,
        limit: i64,
    ) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE resource_type = $1 AND resource_id = $2
            ORDER BY occurred_at DESC
            LIMIT $3
            "#,
        )
        .bind(resource_type)
        .bind(resource_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// List the routing-decision audit records for one run, oldest-first.
    ///
    /// Filters [`AuditRepo::list_by_run`] down to events whose `action` is
    /// [`crate::models::audit::action::ROUTING_DECIDED`] — the standard
    /// `audit_events` table is the source of truth, no parallel store. The
    /// JSON in each event's `details` column round-trips through
    /// `fd_policy::routing::RoutingDecision::from_audit_details` on the
    /// gateway read path.
    #[instrument(skip(self))]
    pub async fn list_routing_decisions(
        &self,
        run_id: &str,
    ) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE run_id = $1 AND action = $2
            ORDER BY occurred_at ASC
            "#,
        )
        .bind(run_id)
        .bind(crate::models::audit::action::ROUTING_DECIDED)
        .fetch_all(&self.pool)
        .await
    }

    /// List audit events by action
    #[instrument(skip(self))]
    pub async fn list_by_action(
        &self,
        action: &str,
        limit: i64,
    ) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE action = $1
            ORDER BY occurred_at DESC
            LIMIT $2
            "#,
        )
        .bind(action)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// List audit events for a tenant
    #[instrument(skip(self))]
    pub async fn list_by_tenant(
        &self,
        tenant_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE tenant_id = $1
            ORDER BY occurred_at DESC
            LIMIT $2 OFFSET $3
            "#,
        )
        .bind(tenant_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(&self.pool)
        .await
    }
}
