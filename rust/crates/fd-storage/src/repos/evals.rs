//! Eval-run repository (issue #46).
//!
//! The single queryable eval store. `evals/reports/*.json` is its import
//! source, not a parallel surface — see migration `20260825000001` for why.

use sqlx::Row;
use tracing::instrument;

use crate::models::{EvalIngest, EvalRun, EvalRunSource, EvalRunStatus, UpsertEvalRun};
use crate::pool::DbPool;

#[derive(Clone)]
pub struct EvalsRepo {
    pool: DbPool,
}

impl EvalsRepo {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Insert a run, or update it if the id already exists.
    ///
    /// Idempotent by construction: the id of an ingested run is its report file
    /// stem, so re-ingesting the same directory updates rather than duplicating.
    /// That is why the key was not invented — these records already had a stable
    /// one that the API and the dashboard both already used.
    ///
    /// A dispatched run that has since been executed keeps its dispatch
    /// bookkeeping: `COALESCE` on `queued_at`/`requested_by` means an ingest
    /// carrying a completed report cannot erase who asked for it or when.
    #[instrument(skip(self, run), fields(eval_run_id = %run.id))]
    pub async fn upsert(&self, run: UpsertEvalRun) -> Result<EvalRun, sqlx::Error> {
        sqlx::query_as::<_, EvalRun>(
            r#"
            INSERT INTO eval_runs (
                id, suite, source, status, dataset_name, harness_run_id,
                measured_at, measured_at_precision, measured_at_source,
                primary_metric_name, primary_metric_rate, assertion_coverage,
                total_cases, total_tasks, passed_tasks, failed_tasks, error_tasks,
                total_cost_cents, total_tokens, total_duration_ms,
                anchor, report, requested_by, queued_at
            )
            VALUES (
                $1, $2, COALESCE($3, 'committed_report'::eval_run_source),
                COALESCE($4, 'pending'::eval_run_status), $5, $6,
                $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                $18, $19, $20, $21, $22, $23, $24
            )
            ON CONFLICT (id) DO UPDATE SET
                suite = EXCLUDED.suite,
                source = EXCLUDED.source,
                status = EXCLUDED.status,
                dataset_name = EXCLUDED.dataset_name,
                harness_run_id = EXCLUDED.harness_run_id,
                measured_at = EXCLUDED.measured_at,
                measured_at_precision = EXCLUDED.measured_at_precision,
                measured_at_source = EXCLUDED.measured_at_source,
                primary_metric_name = EXCLUDED.primary_metric_name,
                primary_metric_rate = EXCLUDED.primary_metric_rate,
                assertion_coverage = EXCLUDED.assertion_coverage,
                total_cases = EXCLUDED.total_cases,
                total_tasks = EXCLUDED.total_tasks,
                passed_tasks = EXCLUDED.passed_tasks,
                failed_tasks = EXCLUDED.failed_tasks,
                error_tasks = EXCLUDED.error_tasks,
                total_cost_cents = EXCLUDED.total_cost_cents,
                total_tokens = EXCLUDED.total_tokens,
                total_duration_ms = EXCLUDED.total_duration_ms,
                anchor = EXCLUDED.anchor,
                report = EXCLUDED.report,
                -- Dispatch bookkeeping survives an ingest: an imported report
                -- must not erase who asked for the run or when it was queued.
                requested_by = COALESCE(eval_runs.requested_by, EXCLUDED.requested_by),
                queued_at = COALESCE(eval_runs.queued_at, EXCLUDED.queued_at),
                updated_at = NOW()
            RETURNING *
            "#,
        )
        .bind(&run.id)
        .bind(&run.suite)
        .bind(run.source)
        .bind(run.status)
        .bind(&run.dataset_name)
        .bind(&run.harness_run_id)
        .bind(run.measured_at)
        .bind(&run.measured_at_precision)
        .bind(&run.measured_at_source)
        .bind(&run.primary_metric_name)
        .bind(run.primary_metric_rate)
        .bind(run.assertion_coverage)
        .bind(run.total_cases)
        .bind(run.total_tasks)
        .bind(run.passed_tasks)
        .bind(run.failed_tasks)
        .bind(run.error_tasks)
        .bind(run.total_cost_cents)
        .bind(run.total_tokens)
        .bind(run.total_duration_ms)
        .bind(&run.anchor)
        .bind(&run.report)
        .bind(&run.requested_by)
        .bind(run.queued_at)
        .fetch_one(&self.pool)
        .await
    }

    /// Every run, newest measurement first.
    ///
    /// `NULLS LAST` puts a dispatched-but-unexecuted run — which has no
    /// measurement, because it has not measured anything — at the end rather
    /// than at the top under a NULL that sorts high.
    #[instrument(skip(self))]
    pub async fn list(&self, limit: i64) -> Result<Vec<EvalRun>, sqlx::Error> {
        sqlx::query_as::<_, EvalRun>(
            r#"
            SELECT * FROM eval_runs
            ORDER BY measured_at DESC NULLS LAST, created_at DESC, id DESC
            LIMIT $1
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await
    }

    #[instrument(skip(self))]
    pub async fn get(&self, id: &str) -> Result<Option<EvalRun>, sqlx::Error> {
        sqlx::query_as::<_, EvalRun>("SELECT * FROM eval_runs WHERE id = $1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
    }

    #[instrument(skip(self))]
    pub async fn list_by_suite(&self, suite: &str) -> Result<Vec<EvalRun>, sqlx::Error> {
        sqlx::query_as::<_, EvalRun>(
            r#"
            SELECT * FROM eval_runs WHERE suite = $1
            ORDER BY measured_at DESC NULLS LAST, created_at DESC, id DESC
            "#,
        )
        .bind(suite)
        .fetch_all(&self.pool)
        .await
    }

    /// Move a run's lifecycle forward. Used by an executor claiming or
    /// finishing a run.
    #[instrument(skip(self))]
    pub async fn set_status(
        &self,
        id: &str,
        status: EvalRunStatus,
        error: Option<&str>,
    ) -> Result<Option<EvalRun>, sqlx::Error> {
        sqlx::query_as::<_, EvalRun>(
            r#"
            UPDATE eval_runs SET
                status = $2,
                error = COALESCE($3, error),
                started_at = CASE
                    WHEN $2 = 'running'::eval_run_status THEN COALESCE(started_at, NOW())
                    ELSE started_at END,
                completed_at = CASE
                    WHEN $2 IN ('completed'::eval_run_status,
                                'failed'::eval_run_status,
                                'cancelled'::eval_run_status)
                    THEN COALESCE(completed_at, NOW())
                    ELSE completed_at END,
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
            "#,
        )
        .bind(id)
        .bind(status)
        .bind(error)
        .fetch_optional(&self.pool)
        .await
    }

    /// Record that an ingest happened.
    ///
    /// The read endpoints consult this before reporting an empty store: without
    /// it, "we looked and found none" and "we never looked" are the same 200.
    #[instrument(skip(self))]
    pub async fn record_ingest(
        &self,
        source_dir: &str,
        files_seen: i32,
        runs_upserted: i32,
        files_skipped: i32,
    ) -> Result<EvalIngest, sqlx::Error> {
        sqlx::query_as::<_, EvalIngest>(
            r#"
            INSERT INTO eval_ingests (source_dir, files_seen, runs_upserted, files_skipped)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            "#,
        )
        .bind(source_dir)
        .bind(files_seen)
        .bind(runs_upserted)
        .bind(files_skipped)
        .fetch_all(&self.pool)
        .await
        .map(|mut v| v.remove(0))
    }

    /// The most recent ingest, or `None` if the store has never been populated.
    #[instrument(skip(self))]
    pub async fn latest_ingest(&self) -> Result<Option<EvalIngest>, sqlx::Error> {
        sqlx::query_as::<_, EvalIngest>(
            "SELECT * FROM eval_ingests ORDER BY ingested_at DESC, id DESC LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await
    }

    /// How many runs are stored. Cheaper than listing when a caller only needs
    /// to know whether the store is empty.
    #[instrument(skip(self))]
    pub async fn count(&self) -> Result<i64, sqlx::Error> {
        let row = sqlx::query("SELECT COUNT(*)::BIGINT AS n FROM eval_runs")
            .fetch_one(&self.pool)
            .await?;
        Ok(row.get::<i64, _>("n"))
    }

    /// Runs that are dispatched and not yet claimed by an executor.
    ///
    /// Exposed so the honest state is queryable rather than inferred: with no
    /// executor shipping, this is every dispatched run.
    #[instrument(skip(self))]
    pub async fn list_unclaimed(&self) -> Result<Vec<EvalRun>, sqlx::Error> {
        sqlx::query_as::<_, EvalRun>(
            r#"
            SELECT * FROM eval_runs
            WHERE status = 'pending'::eval_run_status
              AND source = 'dispatched'::eval_run_source
            ORDER BY queued_at ASC NULLS LAST
            "#,
        )
        .fetch_all(&self.pool)
        .await
    }
}

/// Convenience: is this run one an executor has never touched?
pub fn is_unclaimed(run: &EvalRun) -> bool {
    run.status == EvalRunStatus::Pending
        && run.source == EvalRunSource::Dispatched
        && run.started_at.is_none()
}
