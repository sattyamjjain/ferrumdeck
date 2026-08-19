//! Policies repository

use crate::models::{
    ApprovalRequest, CreateApprovalRequest, CreatePolicyDecision, CreatePolicyRule, PolicyDecision,
    PolicyEffect, PolicyRule, ResolveApproval, UpdatePolicyRule,
};
use crate::DbPool;
use chrono::Utc;
use tracing::instrument;

/// Repository for policy operations
#[derive(Clone)]
pub struct PoliciesRepo {
    pool: DbPool,
}

impl PoliciesRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    // =========================================================================
    // Policy Rules
    // =========================================================================

    /// Create a new policy rule
    #[instrument(skip(self, rule), fields(rule_id = %rule.id))]
    pub async fn create_rule(&self, rule: CreatePolicyRule) -> Result<PolicyRule, sqlx::Error> {
        sqlx::query_as::<_, PolicyRule>(
            r#"
            INSERT INTO policy_rules (id, project_id, name, description, priority, conditions, effect, created_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&rule.id)
        .bind(&rule.project_id)
        .bind(&rule.name)
        .bind(&rule.description)
        .bind(rule.priority)
        .bind(&rule.conditions)
        .bind(rule.effect)
        .bind(&rule.created_by)
        .fetch_one(&self.pool)
        .await
    }

    /// Get a policy rule by ID
    #[instrument(skip(self))]
    pub async fn get_rule(&self, id: &str) -> Result<Option<PolicyRule>, sqlx::Error> {
        sqlx::query_as::<_, PolicyRule>("SELECT * FROM policy_rules WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Update a policy rule
    #[instrument(skip(self, update), fields(rule_id = %id))]
    pub async fn update_rule(
        &self,
        id: &str,
        update: UpdatePolicyRule,
    ) -> Result<Option<PolicyRule>, sqlx::Error> {
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
        if update.priority.is_some() {
            set_clauses.push(format!("priority = ${}", param_idx));
            param_idx += 1;
        }
        if update.conditions.is_some() {
            set_clauses.push(format!("conditions = ${}", param_idx));
            param_idx += 1;
        }
        if update.effect.is_some() {
            set_clauses.push(format!("effect = ${}", param_idx));
            param_idx += 1;
        }
        if update.enabled.is_some() {
            set_clauses.push(format!("enabled = ${}", param_idx));
        }

        if set_clauses.is_empty() {
            return self.get_rule(id).await;
        }

        let query = format!(
            "UPDATE policy_rules SET {} WHERE id = $1 RETURNING *",
            set_clauses.join(", ")
        );

        let mut q = sqlx::query_as::<_, PolicyRule>(&query).bind(id);

        if let Some(name) = &update.name {
            q = q.bind(name);
        }
        if let Some(desc) = &update.description {
            q = q.bind(desc);
        }
        if let Some(priority) = &update.priority {
            q = q.bind(priority);
        }
        if let Some(conditions) = &update.conditions {
            q = q.bind(conditions);
        }
        if let Some(effect) = &update.effect {
            q = q.bind(effect);
        }
        if let Some(enabled) = &update.enabled {
            q = q.bind(enabled);
        }

        q.fetch_optional(&self.pool).await
    }

    /// List policy rules for a project (including global rules)
    #[instrument(skip(self))]
    pub async fn list_rules(
        &self,
        project_id: Option<&str>,
    ) -> Result<Vec<PolicyRule>, sqlx::Error> {
        match project_id {
            Some(pid) => {
                sqlx::query_as::<_, PolicyRule>(
                    r#"
                    SELECT * FROM policy_rules
                    WHERE (project_id = $1 OR project_id IS NULL) AND enabled = true
                    ORDER BY priority ASC
                    "#,
                )
                .bind(pid)
                .fetch_all(&self.pool)
                .await
            }
            None => {
                sqlx::query_as::<_, PolicyRule>(
                    r#"
                    SELECT * FROM policy_rules
                    WHERE project_id IS NULL AND enabled = true
                    ORDER BY priority ASC
                    "#,
                )
                .fetch_all(&self.pool)
                .await
            }
        }
    }

    // =========================================================================
    // Policy Decisions
    // =========================================================================

    /// Create a policy decision record
    #[instrument(skip(self, decision), fields(decision_id = %decision.id))]
    pub async fn create_decision(
        &self,
        decision: CreatePolicyDecision,
    ) -> Result<PolicyDecision, sqlx::Error> {
        sqlx::query_as::<_, PolicyDecision>(
            r#"
            INSERT INTO policy_decisions (id, run_id, step_id, action_type, action_details, decision, matched_rule_id, reason, evaluation_time_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
            "#,
        )
        .bind(&decision.id)
        .bind(&decision.run_id)
        .bind(&decision.step_id)
        .bind(&decision.action_type)
        .bind(&decision.action_details)
        .bind(decision.decision)
        .bind(&decision.matched_rule_id)
        .bind(&decision.reason)
        .bind(decision.evaluation_time_ms)
        .fetch_one(&self.pool)
        .await
    }

    /// List decisions for a run
    #[instrument(skip(self))]
    pub async fn list_decisions_by_run(
        &self,
        run_id: &str,
    ) -> Result<Vec<PolicyDecision>, sqlx::Error> {
        sqlx::query_as::<_, PolicyDecision>(
            r#"
            SELECT * FROM policy_decisions
            WHERE run_id = $1
            ORDER BY evaluated_at DESC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
    }

    /// List decisions by effect (for monitoring)
    #[instrument(skip(self))]
    pub async fn list_decisions_by_effect(
        &self,
        effect: PolicyEffect,
        limit: i64,
    ) -> Result<Vec<PolicyDecision>, sqlx::Error> {
        sqlx::query_as::<_, PolicyDecision>(
            r#"
            SELECT * FROM policy_decisions
            WHERE decision = $1
            ORDER BY evaluated_at DESC
            LIMIT $2
            "#,
        )
        .bind(effect)
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    // =========================================================================
    // Approval Requests
    // =========================================================================

    /// Create an approval request
    #[instrument(skip(self, approval), fields(approval_id = %approval.id))]
    pub async fn create_approval(
        &self,
        approval: CreateApprovalRequest,
    ) -> Result<ApprovalRequest, sqlx::Error> {
        sqlx::query_as::<_, ApprovalRequest>(
            r#"
            INSERT INTO approval_requests (id, run_id, step_id, policy_decision_id, action_type, action_details, reason, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *
            "#,
        )
        .bind(&approval.id)
        .bind(&approval.run_id)
        .bind(&approval.step_id)
        .bind(&approval.policy_decision_id)
        .bind(&approval.action_type)
        .bind(&approval.action_details)
        .bind(&approval.reason)
        .bind(approval.expires_at)
        .fetch_one(&self.pool)
        .await
    }

    /// Get an approval request by ID
    #[instrument(skip(self))]
    pub async fn get_approval(&self, id: &str) -> Result<Option<ApprovalRequest>, sqlx::Error> {
        sqlx::query_as::<_, ApprovalRequest>("SELECT * FROM approval_requests WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    /// Resolve an approval request
    #[instrument(skip(self, resolution), fields(approval_id = %id))]
    pub async fn resolve_approval(
        &self,
        id: &str,
        resolution: ResolveApproval,
    ) -> Result<Option<ApprovalRequest>, sqlx::Error> {
        sqlx::query_as::<_, ApprovalRequest>(
            r#"
            UPDATE approval_requests
            SET status = $2, resolved_by = $3, resolved_at = $4, resolution_note = $5
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(resolution.status)
        .bind(&resolution.resolved_by)
        .bind(Utc::now())
        .bind(&resolution.resolution_note)
        .fetch_optional(&self.pool)
        .await
    }

    /// List pending approvals for a run
    #[instrument(skip(self))]
    pub async fn list_pending_approvals(
        &self,
        run_id: &str,
    ) -> Result<Vec<ApprovalRequest>, sqlx::Error> {
        sqlx::query_as::<_, ApprovalRequest>(
            r#"
            SELECT * FROM approval_requests
            WHERE run_id = $1 AND status = 'pending'
            ORDER BY created_at ASC
            "#,
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await
    }

    /// Get pending approvals globally (for admin view)
    #[instrument(skip(self))]
    pub async fn list_all_pending_approvals(
        &self,
        limit: i64,
    ) -> Result<Vec<ApprovalRequest>, sqlx::Error> {
        sqlx::query_as::<_, ApprovalRequest>(
            r#"
            SELECT * FROM approval_requests
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    /// Expire old pending approvals
    #[instrument(skip(self))]
    pub async fn expire_old_approvals(&self) -> Result<u64, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE approval_requests
            SET status = 'expired'
            WHERE status = 'pending' AND expires_at < NOW()
            "#,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    // =========================================================================
    // Policy documents — the hash -> document map behind the per-decision
    // permission record. See db/migrations/20260819000001_add_policy_documents.sql
    // and fd_policy::permissions.
    // =========================================================================

    /// Record the policy document that produced a decision, keyed by its own
    /// content hash. Idempotent: the table is content-addressed, so a repeat
    /// observation of the same configuration is a no-op rather than an update
    /// (UPDATE is rejected by trigger).
    ///
    /// Called on the decision path, so it must stay a single cheap statement.
    /// After the first observation of a given configuration this is a primary-key
    /// probe that writes nothing.
    #[instrument(skip(self, document))]
    pub async fn record_policy_document(
        &self,
        content_hash: &str,
        document: &serde_json::Value,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO policy_documents (content_hash, document)
            VALUES ($1, $2)
            ON CONFLICT (content_hash) DO NOTHING
            "#,
        )
        .bind(content_hash)
        .bind(document)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Resolve a policy hash back to the document it commits to.
    #[instrument(skip(self))]
    pub async fn get_policy_document(
        &self,
        content_hash: &str,
    ) -> Result<Option<serde_json::Value>, sqlx::Error> {
        let row: Option<(serde_json::Value,)> =
            sqlx::query_as(r#"SELECT document FROM policy_documents WHERE content_hash = $1"#)
                .bind(content_hash)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(d,)| d))
    }

    /// Answer "what was this identity permitted to do at time `at`" from the
    /// audit log alone.
    ///
    /// This is the reconstruction the whole permission record exists to make
    /// possible, and it is deliberately shipped as a repo method rather than
    /// living in a test: a capability that only a test can perform is not a
    /// capability an investigator has.
    ///
    /// Note the FROM clause. It reads `audit_events` and `policy_documents` and
    /// nothing else — no `agents`, no `agent_versions`, no `runs`. That is the
    /// invariant made executable: if answering this question needed the live
    /// registry, this query would have to name it. It does not, so the answer
    /// survives the agent being deleted, re-versioned, or re-permissioned.
    ///
    /// Returns the most recent decision at or before `at`. `None` means the
    /// log contains no decision for that identity by then — which is a real
    /// answer ("nothing was permitted, because nothing had been decided"), not
    /// a failure.
    #[instrument(skip(self))]
    pub async fn reconstruct_permissions_at(
        &self,
        agent_version_id: &str,
        at: chrono::DateTime<Utc>,
    ) -> Result<Option<ReconstructedPermissions>, sqlx::Error> {
        let row: Option<(
            String,
            chrono::DateTime<Utc>,
            String,
            serde_json::Value,
            serde_json::Value,
            serde_json::Value,
        )> = sqlx::query_as(
            r#"
            SELECT ae.id,
                   ae.occurred_at,
                   ae.details->'permissions'->>'policy_hash'        AS policy_hash,
                   ae.details->'permissions'->'identity'            AS identity,
                   ae.details->'permissions'->'budget_remaining'    AS budget_remaining,
                   pd.document
            FROM audit_events ae
            JOIN policy_documents pd
              ON pd.content_hash = ae.details->'permissions'->>'policy_hash'
            WHERE ae.details->'permissions'->'identity'->>'agent_version_id' = $1
              AND ae.occurred_at <= $2
            ORDER BY ae.occurred_at DESC, ae.chain_seq DESC
            LIMIT 1
            "#,
        )
        .bind(agent_version_id)
        .bind(at)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(
            |(audit_event_id, decided_at, policy_hash, identity, budget_remaining, document)| {
                ReconstructedPermissions {
                    audit_event_id,
                    decided_at,
                    policy_hash,
                    identity,
                    budget_remaining,
                    document,
                }
            },
        ))
    }
}

/// The answer to "what was this identity permitted to do at time T", rebuilt
/// from `audit_events` joined to `policy_documents`.
///
/// `document` is the full `fd_policy::PolicyDocument` as stored — allowlist,
/// budget caps and enforcement mode. Callers that depend on `fd-policy` can
/// deserialize it into the typed form; `fd-storage` deliberately does not, to
/// keep the persistence layer independent of the policy crate.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ReconstructedPermissions {
    /// The audit record this answer was derived from, so the claim is citable.
    pub audit_event_id: String,
    /// When that decision was made — at or before the requested instant.
    pub decided_at: chrono::DateTime<Utc>,
    pub policy_hash: String,
    pub identity: serde_json::Value,
    pub budget_remaining: serde_json::Value,
    pub document: serde_json::Value,
}
