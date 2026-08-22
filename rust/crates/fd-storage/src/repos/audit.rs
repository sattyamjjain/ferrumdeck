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

/// Sentinel used by `idx_audit_events_chain` for the NULL-tenant (system) chain,
/// so global events form one chain rather than N distinct NULL "tenants".
/// Mirrors `COALESCE(tenant_id, '__ferrumdeck_global__')` in migration
/// 20260801000001. Used only for logging attribution.
pub const GLOBAL_CHAIN_TENANT: &str = "__ferrumdeck_global__";

/// Is this the per-tenant chain-sequence collision (SQLSTATE 23505 on
/// `idx_audit_events_chain`) rather than some other insert failure?
///
/// Checked two ways because `idx_audit_events_chain` is a unique *index*, not a
/// named table constraint: depending on driver and server version the index name
/// may arrive via `constraint()` or only inside the message. Matching either
/// keeps the ERROR specific -- a foreign-key or not-null failure is a different
/// bug and must not be reported as an evidence drop.
fn is_chain_collision(e: &sqlx::Error) -> bool {
    let Some(db) = e.as_database_error() else {
        return false;
    };
    if db.code().as_deref() != Some("23505") {
        return false;
    }
    db.constraint() == Some("idx_audit_events_chain")
        || db.message().contains("idx_audit_events_chain")
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
    /// lock serializes writes against an *existing* tip so the chain has one
    /// well-defined order. Writes for different tenants still run concurrently.
    ///
    /// # A verifying chain is not a complete chain
    ///
    /// `FOR UPDATE` locks the row it finds; it does not prevent a concurrent
    /// transaction *inserting a new maximum*. Two writers can therefore read the
    /// same tip, both compute `chain_seq = tip + 1`, and collide on
    /// `idx_audit_events_chain` — and at genesis there is no row to lock at all,
    /// so the first two writes for a tenant race unconditionally.
    ///
    /// **The loser is not retried.** An earlier version of this comment said it
    /// was; nothing in this repository retries it. `create` returns the unique
    /// violation to its caller, and the caller on the hot path
    /// (`Repos::spawn_audit`) is fire-and-forget: it logs and moves on. The
    /// event is **lost**.
    ///
    /// What survives is a chain that still verifies — every remaining row links
    /// correctly to its predecessor, `verify_chain` reports no break, and the
    /// missing record leaves no gap because `chain_seq` was never allocated to
    /// it. So a passing [`Self::verify_chain`] proves the log was **not
    /// tampered with**; it does not prove the log is **complete**. Those are
    /// different claims and only the first one is made anywhere in this
    /// codebase. The loss is loudest exactly when the system is busiest, which
    /// is when an incident is most likely to be under way.
    ///
    /// The collision is logged at ERROR with the tenant and the `chain_seq` that
    /// could not be claimed, so drops are countable in whatever aggregates the
    /// deployment's logs rather than only observable by tailing them. Closing
    /// the gap for real — a retry loop on unique violation, or a per-tenant
    /// advisory lock — is a design change with its own trade-offs and is
    /// deliberately not attempted here. See README "Audit trail" and
    /// `docs/compliance/safe-evidence-coverage.md`.
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
        .await;

        let row = match row {
            Ok(row) => row,
            Err(e) => {
                // A unique violation here is the chain race described above: a
                // concurrent writer claimed this chain_seq first and this event
                // is about to be dropped by the fire-and-forget caller. ERROR,
                // not WARN -- a lost audit record is an evidence loss, and the
                // tenant + index make it countable and attributable rather than
                // merely visible.
                if is_chain_collision(&e) {
                    tracing::error!(
                        tenant_id = event.tenant_id.as_deref().unwrap_or(GLOBAL_CHAIN_TENANT),
                        chain_seq,
                        event_id = %event.id,
                        action = %event.action,
                        error = %e,
                        "audit chain collision: chain_seq already claimed by a concurrent \
                         write for this tenant; this audit event is LOST. The chain still \
                         verifies -- a verifying chain is not a complete one."
                    );
                }
                return Err(e);
            }
        };

        tx.commit().await?;
        Ok(row)
    }

    /// Verify the per-tenant audit hash-chain, oldest-first, returning the first
    /// break. Reads the tenant's chained rows (`chain_seq IS NOT NULL`; NULL
    /// tenant = the global chain) and delegates to [`fd_audit::verify_chain`].
    ///
    /// Detects any insertion, deletion, or in-place edit *within* the chain. It
    /// does **not**, on its own, catch a wholesale rewrite of the entire tail by
    /// an actor who holds every input — that self-consistent forgery is caught by
    /// [`AuditRepo::verify_against_checkpoints`], which cross-checks the chain
    /// head against a signed out-of-band checkpoint (up to the most recent one).
    /// Round-trip note: the hash binds `details` (canonicalized with sorted keys,
    /// so JSONB reordering is harmless) and the IP in parsed form; callers
    /// persisting exotic JSON number formats should be aware JSONB may normalize
    /// them.
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

    /// Read a tenant's current chain **head** as a [`fd_audit::CheckpointBody`],
    /// ready to sign into an out-of-band checkpoint (#14).
    ///
    /// Returns `None` when the tenant has no chained rows yet (nothing to
    /// anchor). `checkpointed_at` is stamped now (microsecond-truncated). This is
    /// the read half of the on-demand checkpoint path: read head → sign with an
    /// off-DB key → append to a [`fd_audit::CheckpointSink`]. It is a plain read
    /// (no `FOR UPDATE`): a concurrently-inserted newer head simply means the
    /// next checkpoint anchors further along, which is fine.
    #[instrument(skip(self))]
    pub async fn head_checkpoint_body(
        &self,
        tenant_id: Option<&str>,
    ) -> Result<Option<fd_audit::CheckpointBody>, sqlx::Error> {
        use chrono::SubsecRound;
        let tip: Option<(Option<String>, i64)> = sqlx::query_as(
            r#"
            SELECT record_hash, chain_seq FROM audit_events
            WHERE tenant_id IS NOT DISTINCT FROM $1 AND chain_seq IS NOT NULL
            ORDER BY chain_seq DESC
            LIMIT 1
            "#,
        )
        .bind(tenant_id)
        .fetch_optional(&self.pool)
        .await?;

        Ok(tip.and_then(|(record_hash, chain_seq)| {
            // record_hash is NULL only on a pre-migration row, which never has a
            // chain_seq — so a chained tip always has a hash. Guard anyway.
            record_hash.map(|record_hash| fd_audit::CheckpointBody {
                tenant_id: tenant_id.map(str::to_string),
                chain_seq,
                record_hash,
                checkpointed_at: chrono::Utc::now().trunc_subsecs(6),
            })
        }))
    }

    /// List the distinct tenants that have a hash-chain (including the NULL/global
    /// chain, returned as `None`) — the set to iterate when checkpointing every
    /// tenant's head on demand.
    #[instrument(skip(self))]
    pub async fn list_chain_tenants(&self) -> Result<Vec<Option<String>>, sqlx::Error> {
        let rows: Vec<(Option<String>,)> = sqlx::query_as(
            r#"
            SELECT DISTINCT tenant_id FROM audit_events
            WHERE chain_seq IS NOT NULL
            "#,
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(t,)| t).collect())
    }

    /// Verify a tenant's chain **against** its out-of-band checkpoints — the
    /// anchored verification that catches a rewritten-but-self-consistent tail,
    /// up to the most recent checkpoint (#14).
    ///
    /// Reads the tenant's chained rows (same source as [`AuditRepo::verify_chain`])
    /// and delegates to [`fd_audit::verify_against_checkpoints`], which requires
    /// internal consistency first, then cross-checks the head against the newest
    /// trusted checkpoint. A read failure is a `Query` error, not a tampering
    /// signal; a `Degraded` outcome (no trusted checkpoint) is returned as data,
    /// so the caller can see the guarantee degraded rather than assume it held.
    #[instrument(skip(self, checkpoints, verifier))]
    pub async fn verify_against_checkpoints(
        &self,
        tenant_id: Option<&str>,
        checkpoints: &[fd_audit::Checkpoint],
        verifier: &fd_audit::CheckpointVerifier,
    ) -> Result<fd_audit::CheckpointOutcome, AuditChainError> {
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
        Ok(fd_audit::verify_against_checkpoints(
            &records,
            checkpoints,
            verifier,
        ))
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
