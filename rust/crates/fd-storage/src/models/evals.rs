//! Eval-run entities (issue #46).
//!
//! One row per eval run, whether ingested from a committed
//! `evals/reports/*.json` or dispatched at request time. See migration
//! `20260825000001_add_eval_runs.sql` for why there is one store rather than
//! two.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Lifecycle of an eval run.
///
/// `Pending` is load-bearing: a dispatched run sits here until an executor
/// claims it, and the gateway ships no executor. A store whose only value was
/// `Completed` — which is what the file-backed store had — cannot express an
/// in-flight run at all, which is why `mapGatewayRun` used to hardcode it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "eval_run_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum EvalRunStatus {
    Pending,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl EvalRunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Running => "running",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }

    /// Whether the run has stopped moving. Not the same as "succeeded".
    pub fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

/// Where a run came from.
///
/// `status` says whether a run finished; this says whether anyone vouched for
/// it. A committed report passed CI and lives in git; a dispatched run is
/// whatever someone clicked. `docs/eval-health.md` is generated from the former,
/// so conflating them would let an unreviewed run enter a published figure.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "eval_run_source", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum EvalRunSource {
    CommittedReport,
    Dispatched,
}

impl EvalRunSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::CommittedReport => "committed_report",
            Self::Dispatched => "dispatched",
        }
    }
}

/// One eval run as stored.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct EvalRun {
    pub id: String,
    pub suite: String,
    pub source: EvalRunSource,
    pub status: EvalRunStatus,

    pub dataset_name: Option<String>,
    pub harness_run_id: Option<String>,

    pub measured_at: Option<DateTime<Utc>>,
    pub measured_at_precision: Option<String>,
    pub measured_at_source: Option<String>,

    pub primary_metric_name: Option<String>,
    pub primary_metric_rate: Option<f64>,
    pub assertion_coverage: Option<f64>,

    pub total_cases: Option<i64>,
    pub total_tasks: Option<i64>,
    pub passed_tasks: Option<i64>,
    pub failed_tasks: Option<i64>,
    pub error_tasks: Option<i64>,
    pub total_cost_cents: Option<f64>,
    pub total_tokens: Option<i64>,
    pub total_duration_ms: Option<i64>,

    pub anchor: Option<String>,
    pub report: Option<serde_json::Value>,

    pub requested_by: Option<String>,
    pub queued_at: Option<DateTime<Utc>>,
    pub started_at: Option<DateTime<Utc>>,
    pub completed_at: Option<DateTime<Utc>>,
    pub error: Option<String>,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// An eval run to upsert (ingest) or insert (dispatch).
#[derive(Debug, Clone, Default)]
pub struct UpsertEvalRun {
    pub id: String,
    pub suite: String,
    pub source: Option<EvalRunSource>,
    pub status: Option<EvalRunStatus>,
    pub dataset_name: Option<String>,
    pub harness_run_id: Option<String>,
    pub measured_at: Option<DateTime<Utc>>,
    pub measured_at_precision: Option<String>,
    pub measured_at_source: Option<String>,
    pub primary_metric_name: Option<String>,
    pub primary_metric_rate: Option<f64>,
    pub assertion_coverage: Option<f64>,
    pub total_cases: Option<i64>,
    pub total_tasks: Option<i64>,
    pub passed_tasks: Option<i64>,
    pub failed_tasks: Option<i64>,
    pub error_tasks: Option<i64>,
    pub total_cost_cents: Option<f64>,
    pub total_tokens: Option<i64>,
    pub total_duration_ms: Option<i64>,
    pub anchor: Option<String>,
    pub report: Option<serde_json::Value>,
    pub requested_by: Option<String>,
    pub queued_at: Option<DateTime<Utc>>,
}

/// A recorded ingest of `evals/reports`.
///
/// Its existence is what lets an empty `eval_runs` mean "we looked and found
/// none" rather than "we never looked".
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct EvalIngest {
    pub id: i64,
    pub source_dir: String,
    pub files_seen: i32,
    pub runs_upserted: i32,
    pub files_skipped: i32,
    pub ingested_at: DateTime<Utc>,
}
