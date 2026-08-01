//! Audit events repository

use crate::models::{AuditEvent, CreateAuditEvent};
use crate::DbPool;
use tracing::instrument;

/// Error from [`AuditRepo::verify_chain`]: a database read can fail, or the
/// chain can be broken. A broken chain is a `Broken(ChainBreak)`; a failed read
/// is a `Query` — a read failure is *not* evidence of tampering.
#[derive(Debug, thiserror::Error)]
pub enum AuditChainError {
    #[error("audit-chain read failed: {0}")]
    Query(#[from] sqlx::Error),
    #[error(transparent)]
    Broken(fd_audit::ChainBreak),
}

/// Project a persisted [`AuditEvent`] row into the pure [`fd_audit::ChainRecord`]
/// the verifier consumes. The IP is rendered from its parsed form to match how
/// the hash was computed at insert.
fn row_to_chain_record(row: &AuditEvent) -> fd_audit::ChainRecord {
    let input = fd_audit::ChainInput {
        id: row.id.clone(),
        occurred_at: row.occurred_at,
        actor_type: row.actor_type.clone(),
        actor_id: row.actor_id.clone(),
        action: row.action.clone(),
        resource_type: row.resource_type.clone(),
        resource_id: row.resource_id.clone(),
        details: row.details.clone(),
        tenant_id: row.tenant_id.clone(),
        workspace_id: row.workspace_id.clone(),
        project_id: row.project_id.clone(),
        run_id: row.run_id.clone(),
        request_id: row.request_id.clone(),
        ip_address: row.ip_address().map(|ip| ip.to_string()),
        user_agent: row.user_agent.clone(),
        trace_id: row.trace_id.clone(),
        span_id: row.span_id.clone(),
        chain_seq: row.chain_seq.unwrap_or_default(),
    };
    fd_audit::ChainRecord {
        input,
        prev_hash: row.prev_hash.clone(),
        record_hash: row.record_hash.clone().unwrap_or_default(),
    }
}

/// Repository for audit event operations
#[derive(Clone)]
pub struct AuditRepo {
    pool: DbPool,
}

impl AuditRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Create an audit event, linking it into the per-tenant hash-chain.
    ///
    /// The whole operation runs in **one transaction**: it locks and reads the
    /// tenant's current chain tip (`FOR UPDATE`), then inserts with
    /// `prev_hash` = the tip's `record_hash`, `chain_seq` = tip + 1, and a freshly
    /// computed `record_hash`. The repo derives all three — callers never supply
    /// a hash ([`CreateAuditEvent`] has no hash fields).
    ///
    /// **Throughput trade-off (documented, not hidden):** the `FOR UPDATE` row
    /// lock **serializes audit writes per tenant** so the chain has one
    /// well-defined order. Writes for *different* tenants still run concurrently;
    /// a single tenant's audit inserts are linearized. At genesis there is no tip
    /// row to lock — two racing genesis inserts are instead resolved by the
    /// `UNIQUE(tenant, chain_seq)` index (the loser gets a unique violation and
    /// retries).
    #[instrument(skip(self, event), fields(event_id = %event.id))]
    pub async fn create(&self, event: CreateAuditEvent) -> Result<AuditEvent, sqlx::Error> {
        use chrono::SubsecRound;

        let mut tx = self.pool.begin().await?;

        // Lock + read this tenant's chain tip. IS NOT DISTINCT FROM makes NULL
        // (global/system) events share one chain rather than N distinct NULLs.
        let tip: Option<(Option<String>, i64)> = sqlx::query_as(
            r#"
            SELECT record_hash, chain_seq FROM audit_events
            WHERE tenant_id IS NOT DISTINCT FROM $1 AND chain_seq IS NOT NULL
            ORDER BY chain_seq DESC
            LIMIT 1
            FOR UPDATE
            "#,
        )
        .bind(&event.tenant_id)
        .fetch_optional(&mut *tx)
        .await?;

        let (prev_hash, chain_seq) = match tip {
            Some((record_hash, seq)) => (record_hash, seq + 1),
            None => (None, 1), // genesis
        };

        // Truncate to microseconds (Postgres TIMESTAMPTZ resolution) so the
        // value we hash is bit-identical to what round-trips back on verify.
        let occurred_at = chrono::Utc::now().trunc_subsecs(6);
        // Canonicalize the IP to its parsed form so the hashed value matches the
        // INET column's normalized read-back.
        let ip_canonical = event
            .ip_address
            .as_ref()
            .and_then(|s| s.parse::<std::net::IpAddr>().ok())
            .map(|ip| ip.to_string());

        let chain_input = fd_audit::ChainInput {
            id: event.id.clone(),
            occurred_at,
            actor_type: event.actor_type.clone(),
            actor_id: event.actor_id.clone(),
            action: event.action.clone(),
            resource_type: event.resource_type.clone(),
            resource_id: event.resource_id.clone(),
            details: event.details.clone(),
            tenant_id: event.tenant_id.clone(),
            workspace_id: event.workspace_id.clone(),
            project_id: event.project_id.clone(),
            run_id: event.run_id.clone(),
            request_id: event.request_id.clone(),
            ip_address: ip_canonical,
            user_agent: event.user_agent.clone(),
            trace_id: event.trace_id.clone(),
            span_id: event.span_id.clone(),
            chain_seq,
        };
        let record_hash = fd_audit::record_hash(prev_hash.as_deref(), &chain_input);

        let row = sqlx::query_as::<_, AuditEvent>(
            r#"
            INSERT INTO audit_events (
                id, actor_type, actor_id, action, resource_type, resource_id,
                details, tenant_id, workspace_id, project_id, run_id,
                request_id, ip_address, user_agent, trace_id, span_id,
                occurred_at, prev_hash, record_hash, chain_seq
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::inet, $14, $15, $16, $17, $18, $19, $20)
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
        .bind(occurred_at)
        .bind(&prev_hash)
        .bind(&record_hash)
        .bind(chain_seq)
        .fetch_one(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(row)
    }

    /// Verify the per-tenant audit hash-chain, oldest-first, returning the first
    /// break. Reads the tenant's chained rows (`chain_seq IS NOT NULL`; NULL
    /// tenant = the global chain) and delegates to [`fd_audit::verify_chain`].
    ///
    /// Detects any insertion, deletion, or in-place edit *within* the chain. It
    /// does **not** catch a wholesale rewrite of the entire tail by an actor who
    /// holds every input — that requires an external anchor on the chain head
    /// (issue #14). Round-trip note: the hash binds `details` (canonicalized with
    /// sorted keys, so JSONB reordering is harmless) and the IP in parsed form;
    /// callers persisting exotic JSON number formats should be aware JSONB may
    /// normalize them.
    #[instrument(skip(self))]
    pub async fn verify_chain(&self, tenant_id: Option<&str>) -> Result<(), AuditChainError> {
        let rows: Vec<AuditEvent> = sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE tenant_id IS NOT DISTINCT FROM $1 AND chain_seq IS NOT NULL
            ORDER BY chain_seq ASC
            "#,
        )
        .bind(tenant_id)
        .fetch_all(&self.pool)
        .await
        .map_err(AuditChainError::Query)?;

        let records: Vec<fd_audit::ChainRecord> = rows.iter().map(row_to_chain_record).collect();
        fd_audit::verify_chain(&records).map_err(AuditChainError::Broken)
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

    /// List the champion-challenger promotion-decision audit records for one
    /// agent, newest-first.
    ///
    /// Filters to events whose `action` is
    /// [`crate::models::audit::action::PROMOTION_DECIDED`] and whose
    /// `resource_id` is the agent id — the standard `audit_events` table is
    /// the source of truth, no parallel store. The JSON in each event's
    /// `details` column round-trips through
    /// `fd_policy::promotion::PromotionDecision::from_audit_details` on the
    /// gateway read path.
    #[instrument(skip(self))]
    pub async fn list_promotion_decisions(
        &self,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE resource_id = $1 AND action = $2
            ORDER BY occurred_at DESC
            LIMIT $3
            "#,
        )
        .bind(agent_id)
        .bind(crate::models::audit::action::PROMOTION_DECIDED)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// List every harness-suggestion audit event for one agent, newest-first.
    ///
    /// Matches all three lifecycle actions via the `harness.suggestion.%`
    /// prefix (`created`, `approved`, `rejected`) and `resource_id = agent_id`.
    /// The gateway read path groups by the suggestion id carried in `details`
    /// and folds the `approved`/`rejected` chain into a status via
    /// `fd_policy::harness::fold_status`. Standard `audit_events` table — no
    /// parallel store; a suggestion is a proposal only, never auto-applied.
    #[instrument(skip(self))]
    pub async fn list_harness_suggestions(
        &self,
        agent_id: &str,
        limit: i64,
    ) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE resource_id = $1 AND action LIKE 'harness.suggestion.%'
            ORDER BY occurred_at DESC
            LIMIT $2
            "#,
        )
        .bind(agent_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// Fetch the single `harness.suggestion.created` event for a suggestion id
    /// (the suggestion id lives in `details->>'id'`). Used by the resolve
    /// endpoint to recover the target agent + project for the access check.
    #[instrument(skip(self))]
    pub async fn get_harness_suggestion_created(
        &self,
        suggestion_id: &str,
    ) -> Result<Option<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE action = $1 AND details->>'id' = $2
            ORDER BY occurred_at DESC
            LIMIT 1
            "#,
        )
        .bind(crate::models::audit::action::HARNESS_SUGGESTION_CREATED)
        .bind(suggestion_id)
        .fetch_optional(&self.pool)
        .await
    }

    /// List the Colorado SB 26-189 ADMT consequential-decision records for one
    /// run, oldest-first.
    ///
    /// Filters [`AuditRepo::list_by_run`] down to events whose `action` is
    /// [`crate::models::audit::action::COLORADO_ADMT_DECIDED`] — the standard
    /// append-only `audit_events` table is the source of truth, no parallel
    /// store. Each event's `details` column round-trips through
    /// `fd_policy::colorado_sb26_189::ColoradoAdmtRecord::from_audit_details` on
    /// the read path ("what decided this, when, on what inputs"). These records
    /// are protected by the 3-year retention floor (see [`crate::retention`]).
    #[instrument(skip(self))]
    pub async fn list_admt_decisions(&self, run_id: &str) -> Result<Vec<AuditEvent>, sqlx::Error> {
        sqlx::query_as::<_, AuditEvent>(
            r#"
            SELECT * FROM audit_events
            WHERE run_id = $1 AND action = $2
            ORDER BY occurred_at ASC
            "#,
        )
        .bind(run_id)
        .bind(crate::models::audit::action::COLORADO_ADMT_DECIDED)
        .fetch_all(&self.pool)
        .await
    }

    /// Prune ADMT audit records older than `retention_years`, refusing any
    /// request below the Colorado SB 26-189 statutory floor.
    ///
    /// This is the **only** prune entry point for `audit_events`, and it is
    /// gated twice: [`crate::retention::check_retention_floor`] rejects a
    /// sub-floor request *before* any SQL runs, and the database trigger from
    /// `20260719000001_add_audit_retention_floor` independently rejects a delete
    /// of any row younger than the floor. A retention floor that lived only in a
    /// policy struct would not be a retention floor — this makes it real.
    ///
    /// Returns the number of rows deleted.
    #[instrument(skip(self))]
    pub async fn prune_admt_expired(
        &self,
        retention_years: i64,
    ) -> Result<u64, crate::retention::PruneError> {
        // Gate 1 (application): refuse an early prune before touching the DB.
        let years = crate::retention::check_retention_floor(retention_years)?;
        // Gate 2 (database): the trigger also rejects deletes within the floor,
        // so even a row that slipped past `years` (clock skew) is protected.
        let result = sqlx::query(
            r#"
            DELETE FROM audit_events
            WHERE action = $1
              AND occurred_at < NOW() - ($2 || ' years')::INTERVAL
            "#,
        )
        .bind(crate::models::audit::action::COLORADO_ADMT_DECIDED)
        .bind(years.to_string())
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
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
