//! The eval store's invariants, against a real database (issue #46).
//!
//! Three things this store exists to make true, each asserted here rather than
//! assumed:
//!
//!   1. **Ingest is idempotent.** The row id is the report's file stem, so
//!      re-importing the same directory updates instead of duplicating. Get this
//!      wrong and every gateway restart doubles the run history.
//!   2. **A dispatched run is distinguishable from a finished one.** The
//!      file-backed store only ever held completed runs, which is why
//!      `mapGatewayRun` hardcoded `status: "completed"`.
//!   3. **"We looked and found none" is distinguishable from "we never
//!      looked."** Once the store is a database the gateway cannot start
//!      without, the old `501 NO_EVAL_STORE` would vanish along with the
//!      distinction it protected — so ingest records itself, and these assert
//!      that the marker is what the difference rests on.
//!
//! Run with a database:
//!     DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck \
//!         cargo test -p fd-storage --test eval_store -- --ignored

use fd_storage::models::{EvalRunSource, EvalRunStatus, UpsertEvalRun};
use fd_storage::{is_unclaimed, EvalsRepo};

fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck".into())
}

async fn repo() -> EvalsRepo {
    let pool = fd_storage::pool::create_pool(&database_url(), 8, 2)
        .await
        .expect("connect to the dev database (make dev-up)");
    EvalsRepo::new(pool)
}

/// Unique per invocation so parallel tests cannot collide on the primary key.
fn unique_id(prefix: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    format!(
        "{prefix}_{}_{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    )
}

fn ingested(id: &str, suite: &str, rate: f64) -> UpsertEvalRun {
    UpsertEvalRun {
        id: id.to_string(),
        suite: suite.to_string(),
        source: Some(EvalRunSource::CommittedReport),
        status: Some(EvalRunStatus::Completed),
        measured_at: Some(chrono::Utc::now()),
        measured_at_precision: Some("second".into()),
        measured_at_source: Some("report.started_at".into()),
        primary_metric_name: Some("average_score".into()),
        primary_metric_rate: Some(rate),
        failed_tasks: Some(0),
        ..Default::default()
    }
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn ingesting_the_same_report_twice_updates_rather_than_duplicating() {
    let repo = repo().await;
    let id = unique_id("eval_idem");
    // A suite name unique to this test. The global `count()` cannot be used as
    // the yardstick: these tests run in parallel and their inserts move it
    // between reads, which would make this assert on the scheduler rather than
    // on the upsert.
    let suite = unique_id("idem_suite");

    repo.upsert(ingested(&id, &suite, 0.8))
        .await
        .expect("first");
    assert_eq!(repo.list_by_suite(&suite).await.expect("list").len(), 1);

    // Same id, different figure — what a re-run of the same suite on the same
    // day looks like after the report file is overwritten.
    let updated = repo
        .upsert(ingested(&id, &suite, 0.9))
        .await
        .expect("second");
    let rows = repo.list_by_suite(&suite).await.expect("list");
    assert_eq!(
        rows.len(),
        1,
        "re-ingesting the same report must not add a row; every gateway restart \
         runs ingest, so a non-idempotent upsert doubles the history each boot"
    );
    assert_eq!(updated.primary_metric_rate, Some(0.9));
    assert_eq!(
        rows[0].primary_metric_rate,
        Some(0.9),
        "and the row is updated"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_dispatched_run_is_distinguishable_from_a_finished_one() {
    let repo = repo().await;
    let queued_id = unique_id("evr_queued");
    let done_id = unique_id("eval_done");

    let queued = repo
        .upsert(UpsertEvalRun {
            id: queued_id.clone(),
            suite: "smoke".into(),
            source: Some(EvalRunSource::Dispatched),
            status: Some(EvalRunStatus::Pending),
            requested_by: Some("key_test".into()),
            queued_at: Some(chrono::Utc::now()),
            // No measurement, and none invented: this run has measured nothing.
            ..Default::default()
        })
        .await
        .expect("dispatch");

    let done = repo
        .upsert(ingested(&done_id, "smoke", 1.0))
        .await
        .expect("ingest");

    assert_eq!(queued.status, EvalRunStatus::Pending);
    assert!(queued.queued_at.is_some());
    assert!(
        queued.started_at.is_none(),
        "a queued run has not started; a start time here would be fabricated"
    );
    assert!(
        queued.measured_at.is_none(),
        "a queued run has measured nothing, and 'now' would be a lie"
    );
    assert!(is_unclaimed(&queued), "no executor has touched it");

    assert_eq!(done.status, EvalRunStatus::Completed);
    assert!(!is_unclaimed(&done));

    // The distinction the old store could not express at all.
    assert_ne!(queued.status, done.status);
    assert_ne!(queued.source, done.source);
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn claiming_a_run_stamps_started_at_exactly_once() {
    let repo = repo().await;
    let id = unique_id("evr_claim");
    repo.upsert(UpsertEvalRun {
        id: id.clone(),
        suite: "smoke".into(),
        source: Some(EvalRunSource::Dispatched),
        status: Some(EvalRunStatus::Pending),
        queued_at: Some(chrono::Utc::now()),
        ..Default::default()
    })
    .await
    .expect("dispatch");

    let running = repo
        .set_status(&id, EvalRunStatus::Running, None)
        .await
        .expect("claim")
        .expect("row");
    let first_start = running.started_at.expect("claiming stamps started_at");

    // A second claim must not move the clock: the run started when it started.
    let again = repo
        .set_status(&id, EvalRunStatus::Running, None)
        .await
        .expect("re-claim")
        .expect("row");
    assert_eq!(again.started_at, Some(first_start));

    let finished = repo
        .set_status(&id, EvalRunStatus::Completed, None)
        .await
        .expect("finish")
        .expect("row");
    assert!(finished.completed_at.is_some());
    assert_eq!(
        finished.started_at,
        Some(first_start),
        "finishing must not rewrite when the run began"
    );
    assert!(!is_unclaimed(&finished));
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn an_ingest_that_carries_a_report_does_not_erase_who_dispatched_the_run() {
    // A dispatched run that later completes gets its result upserted over the
    // top. The dispatch bookkeeping must survive, or the store forgets who asked
    // for the run the moment it produces an answer.
    let repo = repo().await;
    let id = unique_id("evr_keep");
    let queued_at = chrono::Utc::now();

    repo.upsert(UpsertEvalRun {
        id: id.clone(),
        suite: "smoke".into(),
        source: Some(EvalRunSource::Dispatched),
        status: Some(EvalRunStatus::Pending),
        requested_by: Some("key_original".into()),
        queued_at: Some(queued_at),
        ..Default::default()
    })
    .await
    .expect("dispatch");

    let completed = repo
        .upsert(UpsertEvalRun {
            id: id.clone(),
            suite: "smoke".into(),
            source: Some(EvalRunSource::Dispatched),
            status: Some(EvalRunStatus::Completed),
            primary_metric_name: Some("average_score".into()),
            primary_metric_rate: Some(1.0),
            measured_at: Some(chrono::Utc::now()),
            measured_at_precision: Some("second".into()),
            // The result carries no requester or queue time.
            ..Default::default()
        })
        .await
        .expect("result upsert");

    assert_eq!(completed.requested_by.as_deref(), Some("key_original"));
    assert!(completed.queued_at.is_some());
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn the_ingest_marker_is_what_separates_found_none_from_never_looked() {
    // The load-bearing consequence of moving the store into Postgres. Without a
    // recorded ingest, an empty table and an unpopulated one are the same HTTP
    // response — the exact defect this whole surface was hardened against.
    let repo = repo().await;
    let marker = repo
        .record_ingest("evals/reports", 37, 37, 0)
        .await
        .expect("record an ingest");
    assert_eq!(marker.files_seen, 37);
    assert_eq!(marker.runs_upserted, 37);

    let latest = repo
        .latest_ingest()
        .await
        .expect("query")
        .expect("an ingest is recorded");
    assert_eq!(latest.id, marker.id, "latest_ingest returns the newest row");
    assert_eq!(
        latest.source_dir, "evals/reports",
        "which directory was read is part of the evidence, not decoration"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn skipped_files_are_recorded_rather_than_silently_dropped() {
    // A report that stopped being ingested — renamed, malformed — is otherwise
    // indistinguishable from one that was never written, and the previous
    // on-disk reader skipped both without a word.
    let repo = repo().await;
    let marker = repo
        .record_ingest("evals/reports", 40, 37, 3)
        .await
        .expect("record");
    assert_eq!(marker.files_skipped, 3);
    assert_ne!(
        marker.files_seen, marker.runs_upserted,
        "seen and upserted are separate numbers precisely so a gap is visible"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn unmeasured_runs_sort_last_rather_than_first() {
    // `measured_at DESC NULLS LAST`. A queued run has no measurement; under a
    // plain DESC its NULL sorts high and it would head the list, pushing real
    // results down and looking like the newest result.
    let repo = repo().await;
    let measured = unique_id("eval_sorted");
    let queued = unique_id("evr_sorted");
    let suite = unique_id("sort_suite");

    repo.upsert(ingested(&measured, &suite, 1.0))
        .await
        .expect("ingest");
    repo.upsert(UpsertEvalRun {
        id: queued.clone(),
        suite: suite.clone(),
        source: Some(EvalRunSource::Dispatched),
        status: Some(EvalRunStatus::Pending),
        queued_at: Some(chrono::Utc::now()),
        ..Default::default()
    })
    .await
    .expect("dispatch");

    let rows = repo.list_by_suite(&suite).await.expect("list");
    let pos = |id: &str| rows.iter().position(|r| r.id == id).expect("present");
    assert!(
        pos(&measured) < pos(&queued),
        "a run that has measured something must precede one that has not"
    );
}

#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn the_store_rejects_a_metric_that_was_never_normalized() {
    // `governed_block_pct` is 0-100 and has to be divided by 100 on the way in.
    // The CHECK constraint is what stops a percentage reaching the dashboard as
    // a fraction and rendering 100.0 as "10000%".
    let repo = repo().await;
    let err = repo
        .upsert(UpsertEvalRun {
            id: unique_id("eval_badrate"),
            suite: "badrate".into(),
            primary_metric_name: Some("governed_block_pct".into()),
            primary_metric_rate: Some(100.0),
            ..Default::default()
        })
        .await
        .expect_err("a rate outside [0,1] must be refused");
    assert!(
        err.to_string().contains("eval_runs_metric_range"),
        "expected the range constraint, got: {err}"
    );
}
