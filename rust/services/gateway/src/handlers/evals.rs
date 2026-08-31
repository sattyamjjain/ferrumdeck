//! Eval read + dispatch endpoints (issues #7, #46 — both closed).
//!
//! Serves the on-disk eval **reports** the fd-evals framework writes to
//! `evals/reports/`, so the dashboard's eval-run and regression views can read
//! real results instead of a BFF stub. Two naming families live there and both
//! are served: `<suite>-<YYYYMMDD>.json` for the offline benchmarks, and
//! `eval_<suite>_<YYYYMMDD>_<HHMMSS>.json` for the LLM-backed suites. Only the
//! first was handled until 2026-08-16, so every safe-PR smoke and regression
//! report was dropped before it reached the dashboard — see [`parse_stem`].
//!
//! ## What the store is, and the one thing it still cannot do
//!
//! The store is the `eval_runs` table (0.8.14, #46). Committed reports under
//! `evals/reports/` are its **import source**, ingested at gateway startup, not a
//! second query surface — so a dispatched run and a committed report are read back
//! from one place. `eval_ingests` records that an ingest happened, which is what
//! keeps "we looked and found none" (`200` with an empty list) distinct from "we
//! never looked" (`501 { code: "NO_EVAL_STORE" }`). Neither is ever answered with a
//! fabricated empty `200` — the class of lie the SSE mock and the eval-run POST
//! fixes closed.
//!
//! The open gap is the **executor**: `dispatch_eval_run` writes to [`EVAL_QUEUE`]
//! and nothing consumes it, so a dispatched run stays `pending` with `queued_at`
//! set and `started_at` null. That is reported, not disguised — `202 Accepted`
//! rather than `201`, and `unclaimed: true` on the record. The normative statement
//! of this limitation lives in ONE place, the README's "Project Status &
//! Limitations" section, backed by `docs/feature-status.yml` which
//! `make check-claims` enforces. Do not restate it here; if it changes, it changes
//! there.

use std::path::{Path, PathBuf};

use axum::{
    extract::{Extension, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::{json, Value};

use super::ApiError;
use crate::state::AppState;

/// Env override for the eval reports directory (else resolved relative to cwd).
const REPORTS_DIR_ENV: &str = "FD_EVALS_REPORTS_DIR";

/// Candidate `evals/reports` roots, most specific first. `make run-gateway` runs
/// with cwd = repo root, so `evals/reports` resolves there; `../evals/reports`
/// covers a cwd of `rust/` or a service subdir.
fn reports_dir_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(dir) = std::env::var(REPORTS_DIR_ENV) {
        if !dir.is_empty() {
            out.push(PathBuf::from(dir));
        }
    }
    out.push(PathBuf::from("evals/reports"));
    out.push(PathBuf::from("../evals/reports"));
    out
}

fn resolve_reports_dir() -> Option<PathBuf> {
    reports_dir_candidates().into_iter().find(|p| p.is_dir())
}

/// One eval run = one report file, projected to a common summary across the
/// per-suite heterogeneous schemas. `primary_metric` is `None` (never invented)
/// when a suite carries no recognized headline rate.
#[derive(Serialize, Debug, PartialEq)]
pub struct EvalRunSummary {
    /// Stable id = the report file stem, e.g. `asb-20260808`.
    pub run_id: String,
    pub suite: String,
    /// ISO date (`YYYY-MM-DD`) parsed from the file name, or `None` if unparseable.
    ///
    /// Kept for wire compatibility with the dashboard's existing `date` read.
    /// Prefer [`Self::measured_at`], which carries the precision and the source
    /// alongside the value; this field silently reports day precision for the
    /// LLM suites, whose reports know the second.
    pub date: Option<String>,
    /// When the run that produced these numbers actually happened, with the
    /// precision and provenance attached. `None` only when neither the report
    /// body nor the file name records a time — never filled in from mtime.
    ///
    /// Every number on this struct was measured at this instant. A governance
    /// dashboard showing a block rate without its measurement time is asserting
    /// that the figure is current, which is a claim nothing here can support.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub measured_at: Option<MeasuredAt>,
    /// The `run_id` the eval harness itself assigned (`eval_ad440ecd64fd`), as
    /// recorded in the report body. Distinct from [`Self::run_id`], which is the
    /// file stem this endpoint addresses runs by. It was being discarded, so a
    /// dashboard row could not be traced back to the harness's own record.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub report_run_id: Option<String>,
    /// The dataset the run executed against (`safe-pr-agent`). Also previously
    /// discarded; two suites over different datasets are not comparable and the
    /// reader could not see which was which.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dataset_name: Option<String>,
    pub anchor: Option<String>,
    pub total_cases: Option<u64>,
    pub primary_metric: Option<PrimaryMetric>,
    /// Fraction of the run's scorer results that asserted something, when the
    /// report records it. `None` for reports predating the field and for the
    /// offline benchmarks, which have no scorer layer — never defaulted to 1.0.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assertion_coverage: Option<f64>,
    /// Run-level task/cost/duration metrics, present only for the LLM-backed
    /// suites whose reports record them. Every field is `Option` and omitted
    /// when absent: the dashboard renders "unknown" rather than a zero, because
    /// a fabricated `0 failed tasks` is the same class of error as an empty
    /// `200 { runs: [] }` reading as "no runs exist".
    #[serde(flatten)]
    pub metrics: RunMetrics,
}

/// Task, cost and timing figures read verbatim from an `EvalRunSummary` report.
/// Nothing here is derived except `total_tokens` (input + output) and
/// `gate_status`, both of which are documented at their construction site.
#[derive(Serialize, Debug, PartialEq, Default)]
pub struct RunMetrics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tasks: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub passed_tasks: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failed_tasks: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_tasks: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_cost_cents: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_tokens: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    /// `passed` when the report records zero failed tasks, `failed` otherwise.
    /// This is the same rule `scripts/gen_eval_health.py` applies, kept
    /// identical on purpose so the dashboard and the eval-health page cannot
    /// disagree about whether a given run passed. `None` when the report
    /// carries no task counts at all (the offline benchmarks).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gate_status: Option<String>,
}

fn run_metrics(v: &Value) -> RunMetrics {
    let u64_at = |k: &str| v.get(k).and_then(Value::as_u64);
    let str_at = |k: &str| v.get(k).and_then(Value::as_str).map(str::to_string);

    let failed = u64_at("failed_tasks");
    let input = u64_at("total_input_tokens");
    let output = u64_at("total_output_tokens");

    RunMetrics {
        total_tasks: u64_at("total_tasks"),
        passed_tasks: u64_at("passed_tasks"),
        failed_tasks: failed,
        error_tasks: v.get("results").and_then(Value::as_array).map(|rs| {
            rs.iter()
                .filter(|r| !matches!(r.get("error"), None | Some(Value::Null)))
                .count() as u64
        }),
        total_cost_cents: v.get("total_cost_cents").and_then(Value::as_f64),
        // Derived: the reports split the two directions, the dashboard shows
        // one figure. Absent unless at least one side is recorded.
        total_tokens: match (input, output) {
            (None, None) => None,
            (a, b) => Some(a.unwrap_or(0) + b.unwrap_or(0)),
        },
        total_duration_ms: u64_at("total_execution_time_ms"),
        started_at: str_at("started_at"),
        completed_at: str_at("completed_at"),
        gate_status: failed.map(|f| if f == 0 { "passed" } else { "failed" }.to_string()),
    }
}

/// The suite's headline rate, normalized to a fraction in `[0, 1]`.
#[derive(Serialize, Debug, PartialEq)]
pub struct PrimaryMetric {
    /// The report field this came from, e.g. `block_rate_under_attack`.
    pub name: String,
    pub rate: f64,
}

#[derive(Debug)]
enum EvalReadError {
    /// No `evals/reports` directory is reachable — see the module caveat.
    NoStore,
    Io(String),
}

fn iso_date(raw: &str) -> Option<String> {
    if raw.len() == 8 && raw.bytes().all(|b| b.is_ascii_digit()) {
        Some(format!("{}-{}-{}", &raw[0..4], &raw[4..6], &raw[6..8]))
    } else {
        None
    }
}

/// A report's measurement time, and how much of it is actually known.
///
/// The three report families carry different amounts of time evidence, and
/// flattening them to one field would assert precision two of them do not have:
///
/// * `eval_<suite>_<YYYYMMDD>_<HHMMSS>` reports record `started_at` in the body
///   to the microsecond, and repeat the second in the file name.
/// * `asb-<YYYYMMDD>` and `governed-benchmark-<YYYYMMDD>` reports carry **no
///   timestamp field at all**. The file name's date is the only evidence, and
///   it is a date, not an instant.
///
/// File mtime is deliberately not consulted. A `git clone` stamps every file
/// with checkout time, so mtime would report the moment someone cloned the repo
/// as the moment the eval ran — a fabricated measurement time, which is the
/// same class of error as an empty `200 { runs: [] }` reading as "none exist".
///
/// So the precision and the source travel with the value. A dashboard that
/// shows `1.00` without saying when it was measured is the failure mode the
/// README argues against elsewhere; one that shows a *wrong* time is worse.
#[derive(Serialize, Debug, PartialEq, Clone)]
pub struct MeasuredAt {
    /// ISO-8601. Second-precision when known to the second, `YYYY-MM-DD` when
    /// only the day is known — the string itself shows which.
    pub at: String,
    /// `second` | `day`.
    pub precision: &'static str,
    /// `report.started_at` | `filename` — which artifact this came from, so a
    /// reader can check it.
    pub source: &'static str,
}

/// Build the measurement time from the strongest evidence available, or `None`.
///
/// Order is deliberate: the report body beats the file name, because a file can
/// be renamed and the body cannot. Nothing here invents a time — when neither
/// carries one, the field is absent and the dashboard says "not recorded".
fn measured_at(v: &Value, date: Option<&str>, time: Option<&str>) -> Option<MeasuredAt> {
    if let Some(started) = v.get("started_at").and_then(Value::as_str) {
        if !started.is_empty() {
            return Some(MeasuredAt {
                at: started.to_string(),
                precision: "second",
                source: "report.started_at",
            });
        }
    }
    let date = date?;
    match time {
        // `HHMMSS` from the stem — a real second, just not in the body.
        Some(t) if t.len() == 6 && t.bytes().all(|b| b.is_ascii_digit()) => Some(MeasuredAt {
            at: format!("{}T{}:{}:{}", date, &t[0..2], &t[2..4], &t[4..6]),
            precision: "second",
            source: "filename",
        }),
        _ => Some(MeasuredAt {
            at: date.to_string(),
            precision: "day",
            source: "filename",
        }),
    }
}

/// Parse a report file stem into `(suite, date, time)`.
///
/// Two naming families live in `evals/reports/`:
///
/// * `<suite>-<YYYYMMDD>` — the offline benchmarks (`asb-20260810`,
///   `governed-benchmark-20260810`). Suite names may contain hyphens, so the
///   date is the final hyphen-delimited field. No clock time exists.
/// * `eval_<suite>_<YYYYMMDD>_<HHMMSS>` — the LLM-backed suites written by
///   `fd_evals run` (`eval_regression_20260816_034522`).
///
/// Only the first was handled. The second contains no `-`, so `rsplit_once('-')`
/// returned `None` and **every safe-PR smoke and regression report was dropped**
/// before it reached the dashboard — silently, because `load_eval_runs` skips
/// unparseable files rather than failing. The eval-run view therefore showed the
/// offline benchmarks only, and showed nothing at all for the two suites
/// `docs/eval-health.md` is actually about. That is the concrete sense in which
/// the eval-health data path was not yet trustworthy (issue #7).
///
/// The `_HHMMSS` field was then parsed and **thrown away**: two runs of the same
/// suite four minutes apart both reported `2026-08-24` and nothing downstream
/// could tell them apart. It is returned now and feeds [`measured_at`].
fn parse_stem(stem: &str) -> Option<(String, Option<String>, Option<String>)> {
    // `eval_<suite>_<YYYYMMDD>_<HHMMSS>` — suite names here have no underscores
    // (`smoke`, `regression`), and the trailing two fields are the timestamp.
    if let Some(rest) = stem.strip_prefix("eval_") {
        let parts: Vec<&str> = rest.rsplitn(3, '_').collect();
        if let [time_raw, date_raw, suite] = parts.as_slice() {
            if !suite.is_empty()
                && time_raw.len() == 6
                && time_raw.bytes().all(|b| b.is_ascii_digit())
            {
                if let Some(date) = iso_date(date_raw) {
                    return Some((suite.to_string(), Some(date), Some(time_raw.to_string())));
                }
            }
        }
    }

    let (suite, date_raw) = stem.rsplit_once('-')?;
    if suite.is_empty() {
        return None;
    }
    Some((suite.to_string(), iso_date(date_raw), None))
}

/// Extract the headline rate across the per-suite schemas, as a fraction in
/// `[0, 1]`. `asb`/`injection_defense` expose `block_rate_under_attack.rate`
/// (already a fraction); `governed-benchmark` exposes `governed_block_pct`
/// (a percentage, divided by 100 here). Unknown schemas yield `None`.
fn primary_metric(v: &Value) -> Option<PrimaryMetric> {
    if let Some(rate) = v
        .get("block_rate_under_attack")
        .and_then(|m| m.get("rate"))
        .and_then(Value::as_f64)
    {
        return Some(PrimaryMetric {
            name: "block_rate_under_attack".to_string(),
            rate,
        });
    }
    if let Some(pct) = v.get("governed_block_pct").and_then(Value::as_f64) {
        return Some(PrimaryMetric {
            name: "governed_block_pct".to_string(),
            rate: pct / 100.0,
        });
    }
    // LLM-backed suites (`EvalRunSummary` from `fd_evals run`): the headline
    // number is the average task score, already a fraction in [0, 1].
    if let Some(score) = v.get("average_score").and_then(Value::as_f64) {
        return Some(PrimaryMetric {
            name: "average_score".to_string(),
            rate: score,
        });
    }
    None
}

/// Share of the run's scorer results that actually asserted something.
///
/// Read straight from the report; never derived or defaulted. A missing field
/// stays `None` so the dashboard renders "unknown" rather than implying full
/// coverage — reports written before `assertion_coverage` existed genuinely do
/// not carry it, and inventing 1.0 for them would restate the exact error this
/// field was added to expose: a suite reporting a perfect score while half its
/// scorers asserted nothing (see `docs/eval-health.md`).
fn assertion_coverage(v: &Value) -> Option<f64> {
    v.get("assertion_coverage").and_then(Value::as_f64)
}

fn total_cases(v: &Value) -> Option<u64> {
    v.get("total_cases")
        .and_then(Value::as_u64)
        .or_else(|| v.get("unsafe_total").and_then(Value::as_u64))
        // LLM-backed suites count tasks, not cases.
        .or_else(|| v.get("total_tasks").and_then(Value::as_u64))
}

/// Read + project every `*.json` report in `dir`, newest date first. A malformed
/// or non-report `*.json` is skipped, not faked.
fn load_eval_runs(dir: &Path) -> Result<Vec<EvalRunSummary>, EvalReadError> {
    let mut runs = Vec::new();
    let entries = std::fs::read_dir(dir).map_err(|e| EvalReadError::Io(e.to_string()))?;
    for entry in entries {
        let path = entry.map_err(|e| EvalReadError::Io(e.to_string()))?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some((suite_from_name, date, time)) = parse_stem(stem) else {
            continue;
        };
        let text = std::fs::read_to_string(&path).map_err(|e| EvalReadError::Io(e.to_string()))?;
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue; // malformed report — skipped, never counted as a pass
        };
        runs.push(EvalRunSummary {
            run_id: stem.to_string(),
            suite: v
                .get("suite")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or(suite_from_name),
            measured_at: measured_at(&v, date.as_deref(), time.as_deref()),
            report_run_id: v.get("run_id").and_then(Value::as_str).map(str::to_string),
            dataset_name: v
                .get("dataset_name")
                .and_then(Value::as_str)
                .map(str::to_string),
            date,
            anchor: v.get("anchor").and_then(Value::as_str).map(str::to_string),
            total_cases: total_cases(&v),
            primary_metric: primary_metric(&v),
            assertion_coverage: assertion_coverage(&v),
            metrics: run_metrics(&v),
        });
    }
    // Newest first: `YYYY-MM-DD` sorts lexically; undated (`None`) sorts last.
    // Ties break on `run_id` **descending**, because the LLM suites can write
    // several reports in one day and carry `_HHMMSS` in the stem — ascending
    // would have put the earliest run of the day first and made
    // `build_regression_report` compare the wrong pair.
    runs.sort_by(|a, b| b.date.cmp(&a.date).then_with(|| b.run_id.cmp(&a.run_id)));
    Ok(runs)
}

fn load_from_resolved() -> Result<(PathBuf, Vec<EvalRunSummary>), EvalReadError> {
    let dir = resolve_reports_dir().ok_or(EvalReadError::NoStore)?;
    let runs = load_eval_runs(&dir)?;
    Ok((dir, runs))
}

/// One suite's regression between its two most recent runs on a shared metric.
#[derive(Serialize, Debug, PartialEq)]
pub struct Regression {
    pub suite: String,
    pub metric: String,
    pub from_run: String,
    pub to_run: String,
    pub from_rate: f64,
    pub to_rate: f64,
    /// `to_rate - from_rate` (negative — that's what makes it a regression).
    pub delta: f64,
    /// When each side of the comparison was measured. A delta is a statement
    /// about two instants; without them a reader cannot tell a regression that
    /// happened overnight from one that spans seven weeks, and the two call for
    /// very different responses.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_measured_at: Option<MeasuredAt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to_measured_at: Option<MeasuredAt>,
}

struct RegressionReport {
    regressions: Vec<Regression>,
    /// Suites where a like-for-like comparison was possible.
    compared: Vec<String>,
    /// Suites with fewer than two comparable runs — reported explicitly so a
    /// "0 regressions" headline is never confused with "we never looked".
    insufficient_history: Vec<String>,
}

/// Compare each suite's two most recent runs on its primary metric; a drop is a
/// regression. `runs` must be newest-first (as [`load_eval_runs`] returns).
fn build_regression_report(runs: Vec<EvalRunSummary>) -> RegressionReport {
    use std::collections::BTreeMap;

    let mut by_suite: BTreeMap<String, Vec<EvalRunSummary>> = BTreeMap::new();
    for r in runs {
        by_suite.entry(r.suite.clone()).or_default().push(r);
    }

    let mut regressions = Vec::new();
    let mut compared = Vec::new();
    let mut insufficient_history = Vec::new();

    for (suite, suite_runs) in by_suite {
        match (suite_runs.first(), suite_runs.get(1)) {
            (Some(newest), Some(prev)) => {
                match (&newest.primary_metric, &prev.primary_metric) {
                    (Some(nm), Some(pm)) if nm.name == pm.name => {
                        compared.push(suite.clone());
                        let delta = nm.rate - pm.rate;
                        if delta < 0.0 {
                            regressions.push(Regression {
                                suite,
                                metric: nm.name.clone(),
                                from_run: prev.run_id.clone(),
                                to_run: newest.run_id.clone(),
                                from_rate: pm.rate,
                                to_rate: nm.rate,
                                delta,
                                from_measured_at: prev.measured_at.clone(),
                                to_measured_at: newest.measured_at.clone(),
                            });
                        }
                    }
                    // Two runs, but no shared comparable metric.
                    _ => insufficient_history.push(suite),
                }
            }
            // Fewer than two runs for this suite.
            _ => insufficient_history.push(suite),
        }
    }

    RegressionReport {
        regressions,
        compared,
        insufficient_history,
    }
}

/// `GET /v1/evals/regression-report` — regressions across each suite's two most
/// recent runs. Suites with insufficient history are named, never silently
/// counted as passing.
pub async fn eval_regression_report(State(state): State<AppState>) -> Response {
    let repo = state.repos().evals();
    match repo.latest_ingest().await {
        Ok(None) => return never_ingested_response(),
        Ok(Some(_)) => {}
        Err(e) => return store_error(e),
    }
    match stored_summaries(&repo).await {
        Ok(runs) => {
            let report = build_regression_report(runs);
            Json(json!({
                "regressions": report.regressions,
                "regression_count": report.regressions.len(),
                "compared_suites": report.compared,
                "insufficient_history": report.insufficient_history,
                "source": "eval_runs",
            }))
            .into_response()
        }
        Err(e) => store_error(e),
    }
}

/// One suite's measured history, as the report store knows it.
///
/// This is deliberately NOT the suite *definition* — task list, scorer list and
/// gate threshold live in `evals/suites/*.yaml` and the BFF reads them from
/// there. Splitting it that way keeps one source of truth per fact instead of
/// two parsers that can drift: the YAML owns what the suite *is*, this endpoint
/// owns what it has actually *scored*, and every number below carries the
/// measurement time of the run it came from.
#[derive(Serialize, Debug, PartialEq)]
pub struct EvalSuiteHistory {
    /// The suite name as the reports record it — the id this endpoint addresses.
    pub suite: String,
    pub run_count: usize,
    /// Newest run's headline rate, or `None` when the suite's schema exposes
    /// none. Never defaulted to 0.0: a governance suite reading `0%` block rate
    /// and one whose metric was not recognized must not look the same.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_metric: Option<PrimaryMetric>,
    /// When `latest_metric` was measured. Absent together with it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_measured_at: Option<MeasuredAt>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_gate_status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_assertion_coverage: Option<f64>,
    /// Every run for this suite, newest first.
    pub runs: Vec<EvalRunSummary>,
}

/// Group the report store by suite, newest run first within each.
fn build_suite_histories(runs: Vec<EvalRunSummary>) -> Vec<EvalSuiteHistory> {
    use std::collections::BTreeMap;

    let mut by_suite: BTreeMap<String, Vec<EvalRunSummary>> = BTreeMap::new();
    for r in runs {
        by_suite.entry(r.suite.clone()).or_default().push(r);
    }

    by_suite
        .into_iter()
        .map(|(suite, suite_runs)| {
            let newest = suite_runs.first();
            EvalSuiteHistory {
                suite,
                run_count: suite_runs.len(),
                latest_metric: newest.and_then(|r| {
                    r.primary_metric.as_ref().map(|m| PrimaryMetric {
                        name: m.name.clone(),
                        rate: m.rate,
                    })
                }),
                latest_measured_at: newest.and_then(|r| r.measured_at.clone()),
                latest_gate_status: newest.and_then(|r| r.metrics.gate_status.clone()),
                latest_assertion_coverage: newest.and_then(|r| r.assertion_coverage),
                runs: suite_runs,
            }
        })
        .collect()
}

/// `GET /v1/evals/suites` — every suite the report store has runs for, with the
/// newest measured figure and when it was measured.
pub async fn list_eval_suites(State(state): State<AppState>) -> Response {
    let repo = state.repos().evals();
    match repo.latest_ingest().await {
        Ok(None) => return never_ingested_response(),
        Ok(Some(_)) => {}
        Err(e) => return store_error(e),
    }
    match stored_summaries(&repo).await {
        Ok(runs) => {
            let suites = build_suite_histories(runs);
            let count = suites.len();
            Json(json!({
                "suites": suites,
                "count": count,
                "source": "eval_runs",
            }))
            .into_response()
        }
        Err(e) => store_error(e),
    }
}

/// `GET /v1/evals/suites/{suite_id}` — one suite's measured history.
///
/// 404 here means what it says: the report store was read successfully and holds
/// no run for that suite. That is distinguishable from `501 NO_EVAL_STORE`,
/// which means no store was reachable at all — the distinction this whole
/// surface exists to preserve.
pub async fn get_eval_suite(
    State(state): State<AppState>,
    axum::extract::Path(suite_id): axum::extract::Path<String>,
) -> Response {
    let repo = state.repos().evals();
    match repo.latest_ingest().await {
        Ok(None) => return never_ingested_response(),
        Ok(Some(_)) => {}
        Err(e) => return store_error(e),
    }
    match stored_summaries(&repo).await {
        Ok(runs) => {
            let found = build_suite_histories(runs)
                .into_iter()
                .find(|h| h.suite == suite_id);
            match found {
                Some(history) => Json(json!({
                    "suite": history,
                    "source": "eval_runs",
                }))
                .into_response(),
                None => (
                    StatusCode::NOT_FOUND,
                    Json(json!({
                        "error": {
                            "code": "SUITE_NOT_FOUND",
                            "message": format!(
                                "The eval store was read and holds no run for suite '{suite_id}'. \
                                 This is not the same as the store never having been populated, \
                                 which returns 501 NO_EVAL_STORE."
                            ),
                        }
                    })),
                )
                    .into_response(),
            }
        }
        Err(e) => store_error(e),
    }
}

// ===========================================================================
// Ingest + dispatch (issue #46)
//
// The read path above projects `evals/reports/*.json` straight off disk. That
// served #7 and made the WRITE path impossible: a run dispatched at request
// time had nowhere to persist.
//
// The store is now a Postgres table, and the files are its IMPORT SOURCE rather
// than a parallel query surface. The projection above is reused verbatim for
// ingest, so a run means the same thing whichever way it arrived — teaching the
// database a second parser would be the "two homes for one number" this
// codebase has already paid for twice.
// ===========================================================================

use fd_storage::models::{EvalRunSource, EvalRunStatus, UpsertEvalRun};

/// Project one on-disk summary into a row to upsert.
fn summary_to_upsert(r: EvalRunSummary) -> UpsertEvalRun {
    // `measured_at` is parsed back to a timestamp for the DB. Day-precision
    // values carry no clock time, so they are anchored at midnight UTC in the
    // COLUMN while `measured_at_precision` records that the time of day is not
    // known. The precision travels with the value precisely so the column's
    // midnight is never read as a measurement.
    let (at, precision, source) = match &r.measured_at {
        Some(m) => {
            let parsed = chrono::DateTime::parse_from_rfc3339(&m.at)
                .map(|d| d.with_timezone(&chrono::Utc))
                .ok()
                .or_else(|| {
                    chrono::NaiveDate::parse_from_str(&m.at, "%Y-%m-%d")
                        .ok()
                        .and_then(|d| d.and_hms_opt(0, 0, 0))
                        .map(|dt| dt.and_utc())
                })
                .or_else(|| {
                    chrono::NaiveDateTime::parse_from_str(&m.at, "%Y-%m-%dT%H:%M:%S")
                        .ok()
                        .map(|dt| dt.and_utc())
                });
            (
                parsed,
                Some(m.precision.to_string()),
                Some(m.source.to_string()),
            )
        }
        None => (None, None, None),
    };

    let (metric_name, metric_rate) = match &r.primary_metric {
        Some(m) => (Some(m.name.clone()), Some(m.rate)),
        None => (None, None),
    };

    UpsertEvalRun {
        id: r.run_id,
        suite: r.suite,
        source: Some(EvalRunSource::CommittedReport),
        // A committed report is a finished run by definition: the file only
        // exists because the run produced it.
        status: Some(EvalRunStatus::Completed),
        dataset_name: r.dataset_name,
        harness_run_id: r.report_run_id,
        measured_at: at,
        measured_at_precision: precision,
        measured_at_source: source,
        primary_metric_name: metric_name,
        primary_metric_rate: metric_rate,
        assertion_coverage: r.assertion_coverage,
        total_cases: r.total_cases.map(|v| v as i64),
        total_tasks: r.metrics.total_tasks.map(|v| v as i64),
        passed_tasks: r.metrics.passed_tasks.map(|v| v as i64),
        failed_tasks: r.metrics.failed_tasks.map(|v| v as i64),
        error_tasks: r.metrics.error_tasks.map(|v| v as i64),
        total_cost_cents: r.metrics.total_cost_cents,
        total_tokens: r.metrics.total_tokens.map(|v| v as i64),
        total_duration_ms: r.metrics.total_duration_ms.map(|v| v as i64),
        anchor: r.anchor,
        report: None,
        requested_by: None,
        queued_at: None,
    }
}

/// Outcome of an ingest, for logging and for the recorded marker.
pub struct IngestOutcome {
    pub source_dir: String,
    pub files_seen: usize,
    pub upserted: usize,
    pub skipped: usize,
}

/// Import every committed report into the eval store.
///
/// Idempotent: the row id is the report's file stem, so re-running updates
/// rather than duplicating. Called at gateway startup and by
/// `POST /v1/evals/ingest`.
///
/// `files_skipped` is counted and recorded rather than silently dropped. A
/// report that stopped being ingested — a renamed file, malformed JSON — is
/// otherwise indistinguishable from one that was never written, and the previous
/// on-disk reader skipped both without a word.
pub async fn ingest_committed_reports(
    repo: &fd_storage::EvalsRepo,
) -> Result<IngestOutcome, String> {
    let (dir, runs) = tokio::task::spawn_blocking(load_from_resolved)
        .await
        .map_err(|e| format!("ingest task join failed: {e}"))?
        .map_err(|e| match e {
            EvalReadError::NoStore => "no evals/reports directory is reachable".to_string(),
            EvalReadError::Io(msg) => msg,
        })?;

    let dir_display = dir.display().to_string();
    let files_seen = std::fs::read_dir(&dir)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("json"))
                .count()
        })
        .unwrap_or(runs.len());

    let mut upserted = 0usize;
    for run in runs {
        let id = run.run_id.clone();
        match repo.upsert(summary_to_upsert(run)).await {
            Ok(_) => upserted += 1,
            Err(e) => {
                // Counted as skipped, not silently swallowed: a report that
                // failed to land must not look like one that was never there.
                tracing::error!(eval_run_id = %id, error = %e, "failed to ingest eval report");
            }
        }
    }

    let skipped = files_seen.saturating_sub(upserted);
    if let Err(e) = repo
        .record_ingest(
            &dir_display,
            files_seen as i32,
            upserted as i32,
            skipped as i32,
        )
        .await
    {
        // Without the marker, an empty store cannot be told from an unpopulated
        // one, so this failure has to be loud.
        tracing::error!(
            error = %e,
            "eval ingest ran but the marker could not be recorded; the read endpoints \
             will report 501 (never looked) rather than an empty 200"
        );
    }

    Ok(IngestOutcome {
        source_dir: dir_display,
        files_seen,
        upserted,
        skipped,
    })
}

/// Project a stored row onto the wire shape the dashboard already reads.
///
/// Deliberately the SAME field names the file-backed projection served, so this
/// is a change of store rather than a change of contract. `status` and `source`
/// are additive.
fn stored_to_json(r: &fd_storage::models::EvalRun) -> Value {
    let measured_at = r.measured_at.map(|at| {
        let precision = r.measured_at_precision.as_deref().unwrap_or("second");
        json!({
            // Day-precision values are re-rendered as a DATE, not as the
            // midnight the column stores. Serving `...T00:00:00Z` would assert a
            // measurement time the report never recorded.
            "at": if precision == "day" {
                at.format("%Y-%m-%d").to_string()
            } else {
                at.to_rfc3339()
            },
            "precision": precision,
            "source": r.measured_at_source.as_deref().unwrap_or("filename"),
        })
    });

    json!({
        "run_id": r.id,
        "suite": r.suite,
        "status": r.status.as_str(),
        "source": r.source.as_str(),
        "date": r.measured_at.map(|at| at.format("%Y-%m-%d").to_string()),
        "measured_at": measured_at,
        "report_run_id": r.harness_run_id,
        "dataset_name": r.dataset_name,
        "anchor": r.anchor,
        "total_cases": r.total_cases,
        "primary_metric": r.primary_metric_name.as_ref().map(|name| json!({
            "name": name,
            "rate": r.primary_metric_rate,
        })),
        "assertion_coverage": r.assertion_coverage,
        "total_tasks": r.total_tasks,
        "passed_tasks": r.passed_tasks,
        "failed_tasks": r.failed_tasks,
        "error_tasks": r.error_tasks,
        "total_cost_cents": r.total_cost_cents,
        "total_tokens": r.total_tokens,
        "total_duration_ms": r.total_duration_ms,
        "started_at": r.started_at.map(|t| t.to_rfc3339()),
        "completed_at": r.completed_at.map(|t| t.to_rfc3339()),
        "queued_at": r.queued_at.map(|t| t.to_rfc3339()),
        "requested_by": r.requested_by,
        "error": r.error,
        // `gate_status` keeps the eval-health rule: passed iff zero failed
        // tasks. Absent when the run has no task counts, and absent while it is
        // still pending -- a queued run has not passed anything.
        "gate_status": match (r.status.is_terminal(), r.failed_tasks) {
            (true, Some(f)) => Some(if f == 0 { "passed" } else { "failed" }),
            _ => None,
        },
        // The honest state of a dispatched run nobody is executing.
        "unclaimed": fd_storage::is_unclaimed(r),
    })
}

/// Rebuild the in-memory summary from a stored row.
///
/// So `build_regression_report` and `build_suite_histories` keep working
/// unchanged against the database. Rewriting those two against SQL would have
/// given one question two implementations that can disagree -- the exact shape
/// of bug this single store exists to remove.
fn stored_to_summary(r: &fd_storage::models::EvalRun) -> EvalRunSummary {
    let precision = r.measured_at_precision.as_deref().unwrap_or("second");
    EvalRunSummary {
        run_id: r.id.clone(),
        suite: r.suite.clone(),
        date: r.measured_at.map(|at| at.format("%Y-%m-%d").to_string()),
        measured_at: r.measured_at.map(|at| MeasuredAt {
            // Day-precision rows are re-rendered as a DATE, never as the
            // midnight the column stores -- that midnight is a storage
            // artifact, not a measurement.
            at: if precision == "day" {
                at.format("%Y-%m-%d").to_string()
            } else {
                at.to_rfc3339()
            },
            precision: if precision == "day" { "day" } else { "second" },
            source: if r.measured_at_source.as_deref() == Some("report.started_at") {
                "report.started_at"
            } else {
                "filename"
            },
        }),
        report_run_id: r.harness_run_id.clone(),
        dataset_name: r.dataset_name.clone(),
        anchor: r.anchor.clone(),
        total_cases: r.total_cases.map(|v| v as u64),
        primary_metric: r.primary_metric_name.as_ref().and_then(|name| {
            r.primary_metric_rate.map(|rate| PrimaryMetric {
                name: name.clone(),
                rate,
            })
        }),
        assertion_coverage: r.assertion_coverage,
        metrics: RunMetrics {
            total_tasks: r.total_tasks.map(|v| v as u64),
            passed_tasks: r.passed_tasks.map(|v| v as u64),
            failed_tasks: r.failed_tasks.map(|v| v as u64),
            error_tasks: r.error_tasks.map(|v| v as u64),
            total_cost_cents: r.total_cost_cents,
            total_tokens: r.total_tokens.map(|v| v as u64),
            total_duration_ms: r.total_duration_ms.map(|v| v as u64),
            started_at: r.started_at.map(|t| t.to_rfc3339()),
            completed_at: r.completed_at.map(|t| t.to_rfc3339()),
            gate_status: match (r.status.is_terminal(), r.failed_tasks) {
                (true, Some(f)) => Some(if f == 0 { "passed" } else { "failed" }.to_string()),
                _ => None,
            },
        },
    }
}

/// Every stored run that has actually measured something, newest first.
///
/// Dispatched-but-unclaimed runs are excluded: a regression comparison or a
/// suite headline built from a run with no metric would be built from nothing,
/// and a queued run has not scored anything yet.
async fn stored_summaries(
    repo: &fd_storage::EvalsRepo,
) -> Result<Vec<EvalRunSummary>, sqlx::Error> {
    Ok(repo
        .list(2000)
        .await?
        .iter()
        .filter(|r| r.measured_at.is_some())
        .map(stored_to_summary)
        .collect())
}

/// The "the store has never been populated" response.
///
/// Distinct from an empty `200`. `eval_ingests` is what makes the distinction
/// possible at all once the store is a database the gateway cannot start
/// without — see migration 20260825000001.
fn never_ingested_response() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": {
                "code": "NO_EVAL_STORE",
                "message": "The eval store has never been populated: no ingest of evals/reports has been recorded. No runs are returned rather than an empty list, because an empty list would read as 'no runs exist'. Run POST /v1/evals/ingest, or restart the gateway with a reachable evals/reports directory.",
                "issue": "https://github.com/sattyamjjain/ferrumdeck/issues/46"
            }
        })),
    )
        .into_response()
}

fn store_error(e: sqlx::Error) -> Response {
    tracing::error!(error = %e, "eval store query failed");
    ApiError::internal("failed to read the eval store").into_response()
}

/// `GET /v1/evals/runs` — every run in the store, newest measurement first.
pub async fn list_eval_runs_stored(State(state): State<AppState>) -> Response {
    let repo = state.repos().evals();
    match repo.latest_ingest().await {
        Ok(None) => return never_ingested_response(),
        Ok(Some(_)) => {}
        Err(e) => return store_error(e),
    }
    match repo.list(500).await {
        Ok(runs) => {
            let count = runs.len();
            let unclaimed = runs.iter().filter(|r| fd_storage::is_unclaimed(r)).count();
            Json(json!({
                "runs": runs.iter().map(stored_to_json).collect::<Vec<_>>(),
                "count": count,
                "source": "eval_runs",
                // Surfaced rather than left to be inferred: with no executor
                // shipping, every dispatched run sits here, and a dashboard
                // showing a permanently-pending run should be able to say why.
                "unclaimed_count": unclaimed,
            }))
            .into_response()
        }
        Err(e) => store_error(e),
    }
}

/// `POST /v1/evals/runs` — dispatch a suite.
///
/// Persists the run and enqueues it. Answers **202 Accepted**, never 201: the
/// run exists and is queryable, and it has not started. The gateway ships no
/// eval executor, so nothing consumes the queue yet and the run stays `pending`
/// with `queued_at` set and `started_at` null.
///
/// That is deliberately not the old stub. The old stub minted a synthetic
/// `eval_stub_<ts>` id for a run with no backend at all — an affirmative
/// confirmation of work that could never happen. This run is durable, is
/// listed, reports `unclaimed: true`, and never claims to have completed.
pub async fn dispatch_eval_run(
    State(state): State<AppState>,
    Extension(auth): Extension<crate::middleware::AuthContext>,
    Json(request): Json<DispatchEvalRunRequest>,
) -> Response {
    let suite = request.suite_id.trim();
    if suite.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({
                "error": { "code": "INVALID_SUITE", "message": "suite_id is required" }
            })),
        )
            .into_response();
    }

    let id = format!("evr_{}", ulid::Ulid::new());
    let now = chrono::Utc::now();
    let run = UpsertEvalRun {
        id: id.clone(),
        suite: suite.to_string(),
        source: Some(EvalRunSource::Dispatched),
        status: Some(EvalRunStatus::Pending),
        requested_by: Some(auth.api_key_id.clone()),
        queued_at: Some(now),
        // No measurement, and no invented one. This run has measured nothing.
        ..Default::default()
    };

    let stored = match state.repos().evals().upsert(run).await {
        Ok(r) => r,
        Err(e) => return store_error(e),
    };

    // Enqueue after the row commits, for the same reason every realtime event
    // is published after its record: a queue entry naming a run that does not
    // exist is unactionable, and a consumer could not tell "not written yet"
    // from "never written".
    let queued = match state
        .queue
        .enqueue(
            EVAL_QUEUE,
            &fd_storage::QueueMessage::new(
                stored.id.clone(),
                json!({ "eval_run_id": stored.id, "suite": stored.suite }),
            ),
        )
        .await
    {
        Ok(_) => true,
        Err(e) => {
            // The run is durable either way, so it is not lost -- but a caller
            // must not be told it is queued when it is not.
            tracing::error!(eval_run_id = %stored.id, error = %e, "failed to enqueue eval run");
            false
        }
    };

    (
        StatusCode::ACCEPTED,
        Json(json!({
            "eval_run_id": stored.id,
            "suite": stored.suite,
            "status": stored.status.as_str(),
            "queued_at": stored.queued_at.map(|t| t.to_rfc3339()),
            "queued": queued,
            "unclaimed": true,
            "note": "Accepted and persisted. No eval executor consumes this queue yet, so the run will remain 'pending' until one does — it is durable and queryable, and it is not running. Tracked in issue #46.",
        })),
    )
        .into_response()
}

/// `POST /v1/evals/ingest` — import the committed reports into the store.
pub async fn ingest_eval_reports(State(state): State<AppState>) -> Response {
    match ingest_committed_reports(&state.repos().evals()).await {
        Ok(o) => Json(json!({
            "source_dir": o.source_dir,
            "files_seen": o.files_seen,
            "runs_upserted": o.upserted,
            "files_skipped": o.skipped,
        }))
        .into_response(),
        Err(msg) => (
            StatusCode::NOT_IMPLEMENTED,
            Json(json!({
                "error": {
                    "code": "NO_EVAL_STORE",
                    "message": format!("Could not ingest committed reports: {msg}"),
                    "issue": "https://github.com/sattyamjjain/ferrumdeck/issues/46"
                }
            })),
        )
            .into_response(),
    }
}

/// Redis stream a dispatched eval run is queued onto.
pub const EVAL_QUEUE: &str = "evals:pending";

/// Body of `POST /v1/evals/runs`.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
pub struct DispatchEvalRunRequest {
    /// The suite to run, as named in `evals/suites/*.yaml`.
    pub suite_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The committed report store, resolved from this crate rather than cwd.
    /// `cargo test` runs with cwd = the package dir, so `resolve_reports_dir()`
    /// finds nothing here; the repo root is three levels up.
    fn committed_reports() -> PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../evals/reports")
    }

    fn unique_tmp() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "fd_evals_test_{}_{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parse_stem_handles_hyphenated_suites_and_dates() {
        assert_eq!(
            parse_stem("asb-20260808"),
            Some(("asb".to_string(), Some("2026-08-08".to_string()), None))
        );
        assert_eq!(
            parse_stem("governed-benchmark-20260725"),
            Some((
                "governed-benchmark".to_string(),
                Some("2026-07-25".to_string()),
                None
            ))
        );
        // No trailing 8-digit date → suite kept, date None.
        assert_eq!(
            parse_stem("weirdname-notadate"),
            Some(("weirdname".to_string(), None, None))
        );
        assert_eq!(parse_stem("nodash"), None);
    }

    #[test]
    fn parse_stem_handles_the_llm_suite_naming_family() {
        // These were dropped entirely: the stem has no `-`, so the old
        // `rsplit_once('-')` returned None and every safe-PR smoke/regression
        // report was skipped before reaching the dashboard.
        assert_eq!(
            parse_stem("eval_regression_20260816_034522"),
            Some((
                "regression".to_string(),
                Some("2026-08-16".to_string()),
                Some("034522".to_string())
            ))
        );
        assert_eq!(
            parse_stem("eval_smoke_20260816_030324"),
            Some((
                "smoke".to_string(),
                Some("2026-08-16".to_string()),
                Some("030324".to_string())
            ))
        );
        // Not the timestamped family — falls through to the hyphen rule.
        assert_eq!(parse_stem("eval_something"), None);
    }

    #[test]
    fn llm_suite_reports_are_served_not_silently_dropped() {
        let dir = unique_tmp();
        std::fs::write(
            dir.join("eval_regression_20260816_034522.json"),
            r#"{"dataset_name":"safe-pr-agent","total_tasks":20,"passed_tasks":20,
                "failed_tasks":0,"average_score":1.0,"assertion_coverage":0.5}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("eval_smoke_20260816_030324.json"),
            r#"{"dataset_name":"safe-pr-agent","total_tasks":3,"passed_tasks":3,
                "failed_tasks":0,"average_score":1.0,"assertion_coverage":0.5}"#,
        )
        .unwrap();

        let runs = load_eval_runs(&dir).unwrap();
        assert_eq!(runs.len(), 2, "both LLM-suite reports must be served");

        let regression = runs.iter().find(|r| r.suite == "regression").unwrap();
        assert_eq!(regression.total_cases, Some(20));
        assert_eq!(
            regression.primary_metric.as_ref().unwrap().name,
            "average_score"
        );
        assert_eq!(regression.primary_metric.as_ref().unwrap().rate, 1.0);
        assert_eq!(
            regression.assertion_coverage,
            Some(0.5),
            "coverage must reach the dashboard alongside the score; a 1.00 at 50% \
             coverage is an average over half a suite"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn run_metrics_are_read_verbatim_and_absent_when_unrecorded() {
        let report = json!({
            "total_tasks": 20, "passed_tasks": 18, "failed_tasks": 2,
            "total_cost_cents": 0.5, "total_input_tokens": 11004,
            "total_output_tokens": 9152, "total_execution_time_ms": 153179,
            "started_at": "2026-08-16T03:45:22Z", "completed_at": "2026-08-16T03:47:56Z",
            "results": [{"error": null}, {"error": "boom"}]
        });
        let m = run_metrics(&report);
        assert_eq!(m.total_tasks, Some(20));
        assert_eq!(m.failed_tasks, Some(2));
        assert_eq!(
            m.error_tasks,
            Some(1),
            "only the result with an error counts"
        );
        assert_eq!(m.total_tokens, Some(11004 + 9152));
        assert_eq!(m.total_duration_ms, Some(153179));
        assert_eq!(
            m.gate_status.as_deref(),
            Some("failed"),
            "two failed tasks must not read as a passing gate"
        );

        // The offline benchmarks record none of this. Everything must stay
        // absent rather than becoming a confident zero.
        let benchmark = json!({"block_rate_under_attack": {"rate": 1.0}});
        assert_eq!(run_metrics(&benchmark), RunMetrics::default());
        assert_eq!(run_metrics(&benchmark).gate_status, None);
        assert_eq!(run_metrics(&benchmark).failed_tasks, None);
    }

    #[test]
    fn gate_status_matches_the_eval_health_rule() {
        // gen_eval_health.py calls a run passed when failed_tasks == 0. The two
        // must not be able to disagree about the same report.
        assert_eq!(
            run_metrics(&json!({"failed_tasks": 0}))
                .gate_status
                .as_deref(),
            Some("passed")
        );
        assert_eq!(
            run_metrics(&json!({"failed_tasks": 1}))
                .gate_status
                .as_deref(),
            Some("failed")
        );
    }

    #[test]
    fn assertion_coverage_is_never_defaulted_when_absent() {
        // Reports predating the field genuinely do not carry it. Filling in 1.0
        // would assert full coverage for exactly the runs that did not have it.
        assert_eq!(assertion_coverage(&json!({"average_score": 1.0})), None);
        assert_eq!(
            assertion_coverage(&json!({"assertion_coverage": 0.5})),
            Some(0.5)
        );
    }

    #[test]
    fn same_day_llm_runs_order_newest_first() {
        let dir = unique_tmp();
        for (stamp, score) in [("030324", 0.4), ("174522", 0.9)] {
            std::fs::write(
                dir.join(format!("eval_smoke_20260816_{stamp}.json")),
                format!(r#"{{"total_tasks":3,"average_score":{score}}}"#),
            )
            .unwrap();
        }
        let runs = load_eval_runs(&dir).unwrap();
        assert_eq!(
            runs[0].run_id, "eval_smoke_20260816_174522",
            "two runs on one day must order by time, or the regression report \
             compares the wrong pair"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn primary_metric_reads_each_suite_schema() {
        let asb = json!({"block_rate_under_attack": {"rate": 0.92}});
        assert_eq!(
            primary_metric(&asb),
            Some(PrimaryMetric {
                name: "block_rate_under_attack".to_string(),
                rate: 0.92
            })
        );
        let governed = json!({"governed_block_pct": 80.0});
        assert_eq!(
            primary_metric(&governed),
            Some(PrimaryMetric {
                name: "governed_block_pct".to_string(),
                rate: 0.8
            })
        );
        assert_eq!(primary_metric(&json!({"unrelated": 1})), None);
    }

    #[test]
    fn total_cases_falls_back_to_unsafe_total() {
        assert_eq!(total_cases(&json!({"total_cases": 31})), Some(31));
        assert_eq!(total_cases(&json!({"unsafe_total": 12})), Some(12));
        assert_eq!(total_cases(&json!({})), None);
    }

    #[test]
    fn load_eval_runs_projects_and_orders_newest_first() {
        let dir = unique_tmp();
        std::fs::write(
            dir.join("asb-20260701.json"),
            r#"{"suite":"asb","anchor":"a","total_cases":10,"block_rate_under_attack":{"rate":0.9}}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("asb-20260808.json"),
            r#"{"suite":"asb","anchor":"a","total_cases":10,"block_rate_under_attack":{"rate":0.95}}"#,
        )
        .unwrap();
        // A malformed report and a non-json file must be skipped, not faked.
        std::fs::write(dir.join("asb-20260709.json"), "{not json").unwrap();
        std::fs::write(dir.join("asb-20260709.md"), "# report").unwrap();

        let runs = load_eval_runs(&dir).unwrap();
        assert_eq!(runs.len(), 2, "two valid reports; malformed + .md skipped");
        assert_eq!(runs[0].run_id, "asb-20260808", "newest first");
        assert_eq!(runs[1].run_id, "asb-20260701");
        assert_eq!(runs[0].total_cases, Some(10));
        assert_eq!(runs[0].primary_metric.as_ref().unwrap().rate, 0.95);

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_eval_runs_errors_when_dir_absent() {
        let missing = std::env::temp_dir().join("fd_evals_test_definitely_absent_dir_xyz");
        assert!(matches!(
            load_eval_runs(&missing),
            Err(EvalReadError::Io(_))
        ));
    }

    #[test]
    fn committed_reports_are_served_from_the_repo_store() {
        // The reports committed under evals/reports/ (and baked into the gateway
        // image) must be readable by the exact code path the endpoint uses. If a
        // real artifact were ever dropped, load_eval_runs would return empty and
        // this fails — that is the point (a fresh clone must be non-empty). Repo
        // root is three levels up from this crate.
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../evals/reports");
        let runs = load_eval_runs(&dir).expect("read committed evals/reports");
        assert!(
            !runs.is_empty(),
            "evals/reports/ must ship at least one real run record, not just .gitkeep"
        );
        let asb = runs
            .iter()
            .find(|r| r.suite == "asb")
            .expect("a committed asb run record");
        let m = asb
            .primary_metric
            .as_ref()
            .expect("asb run has a block-rate primary metric");
        assert_eq!(m.name, "block_rate_under_attack");
        assert!((0.0..=1.0).contains(&m.rate));

        // The suites `docs/eval-health.md` is about must reach the endpoint too.
        // They were dropped by the stem parser, so this assertion is what stops
        // the dashboard from silently showing only the offline benchmarks again.
        for suite in ["smoke", "regression"] {
            let run = runs
                .iter()
                .find(|r| r.suite == suite)
                .unwrap_or_else(|| panic!("a committed {suite} run record must be served"));
            assert_eq!(
                run.primary_metric.as_ref().map(|m| m.name.as_str()),
                Some("average_score"),
                "{suite} must expose its headline score to the dashboard"
            );
        }
    }

    #[test]
    fn regression_report_flags_a_drop_and_names_insufficient_history() {
        // asb dropped 0.95 -> 0.90 (regression); injection has one run (insufficient).
        let runs = vec![
            EvalRunSummary {
                metrics: RunMetrics::default(),
                assertion_coverage: None,
                measured_at: None,
                report_run_id: None,
                dataset_name: None,
                run_id: "asb-20260808".into(),
                suite: "asb".into(),
                date: Some("2026-08-08".into()),
                anchor: None,
                total_cases: None,
                primary_metric: Some(PrimaryMetric {
                    name: "block_rate_under_attack".into(),
                    rate: 0.90,
                }),
            },
            EvalRunSummary {
                metrics: RunMetrics::default(),
                assertion_coverage: None,
                measured_at: None,
                report_run_id: None,
                dataset_name: None,
                run_id: "asb-20260801".into(),
                suite: "asb".into(),
                date: Some("2026-08-01".into()),
                anchor: None,
                total_cases: None,
                primary_metric: Some(PrimaryMetric {
                    name: "block_rate_under_attack".into(),
                    rate: 0.95,
                }),
            },
            EvalRunSummary {
                metrics: RunMetrics::default(),
                assertion_coverage: None,
                measured_at: None,
                report_run_id: None,
                dataset_name: None,
                run_id: "injection_defense-20260808".into(),
                suite: "injection_defense".into(),
                date: Some("2026-08-08".into()),
                anchor: None,
                total_cases: None,
                primary_metric: Some(PrimaryMetric {
                    name: "block_rate_under_attack".into(),
                    rate: 1.0,
                }),
            },
        ];
        let report = build_regression_report(runs);
        assert_eq!(report.regressions.len(), 1);
        let r = &report.regressions[0];
        assert_eq!(r.suite, "asb");
        assert!(r.delta < 0.0);
        assert_eq!(r.from_run, "asb-20260801");
        assert_eq!(r.to_run, "asb-20260808");
        assert_eq!(report.compared, vec!["asb".to_string()]);
        assert_eq!(
            report.insufficient_history,
            vec!["injection_defense".to_string()]
        );
    }

    #[test]
    fn regression_report_no_drop_is_zero_but_still_reports_compared() {
        // An improvement (0.90 -> 0.95) is not a regression, but the suite is
        // still "compared", so 0 regressions is distinguishable from no history.
        let runs = vec![
            EvalRunSummary {
                metrics: RunMetrics::default(),
                assertion_coverage: None,
                measured_at: None,
                report_run_id: None,
                dataset_name: None,
                run_id: "asb-20260808".into(),
                suite: "asb".into(),
                date: Some("2026-08-08".into()),
                anchor: None,
                total_cases: None,
                primary_metric: Some(PrimaryMetric {
                    name: "block_rate_under_attack".into(),
                    rate: 0.95,
                }),
            },
            EvalRunSummary {
                metrics: RunMetrics::default(),
                assertion_coverage: None,
                measured_at: None,
                report_run_id: None,
                dataset_name: None,
                run_id: "asb-20260801".into(),
                suite: "asb".into(),
                date: Some("2026-08-01".into()),
                anchor: None,
                total_cases: None,
                primary_metric: Some(PrimaryMetric {
                    name: "block_rate_under_attack".into(),
                    rate: 0.90,
                }),
            },
        ];
        let report = build_regression_report(runs);
        assert!(report.regressions.is_empty());
        assert_eq!(report.compared, vec!["asb".to_string()]);
        assert!(report.insufficient_history.is_empty());
    }
    // -----------------------------------------------------------------------
    // Measurement time. Issue #6's complaint is that the live-stack suites
    // assert liveness rather than behaviour; these assert the served value
    // equals the value in the file, by comparison, not by "it returned".
    // -----------------------------------------------------------------------

    #[test]
    fn measured_at_prefers_the_report_body_over_the_file_name() {
        // The body knows the microsecond; the file name knows the second. A
        // rename cannot change the body, so the body wins.
        let report = json!({"started_at": "2026-08-24T03:07:10.966639+00:00"});
        let m = measured_at(&report, Some("2026-08-24"), Some("030710")).unwrap();
        assert_eq!(m.at, "2026-08-24T03:07:10.966639+00:00");
        assert_eq!(m.precision, "second");
        assert_eq!(m.source, "report.started_at");
    }

    #[test]
    fn measured_at_recovers_the_second_the_file_name_carries() {
        // The offline benchmarks have no `started_at`. Before this, the
        // `_HHMMSS` field was parsed and thrown away, so two runs of the same
        // suite four minutes apart were indistinguishable.
        let m = measured_at(&json!({}), Some("2026-08-24"), Some("030710")).unwrap();
        assert_eq!(m.at, "2026-08-24T03:07:10");
        assert_eq!(m.precision, "second");
        assert_eq!(m.source, "filename");
    }

    #[test]
    fn measured_at_reports_day_precision_rather_than_inventing_a_clock_time() {
        // asb / governed-benchmark reports carry no timestamp at all. Padding
        // this to `T00:00:00` would assert a midnight run that never happened.
        let m = measured_at(&json!({}), Some("2026-08-22"), None).unwrap();
        assert_eq!(m.at, "2026-08-22");
        assert_eq!(m.precision, "day");
        assert_eq!(m.source, "filename");
    }

    #[test]
    fn measured_at_is_absent_rather_than_guessed_when_nothing_records_a_time() {
        // Notably NOT file mtime: `git clone` stamps every file with checkout
        // time, so mtime would report when someone cloned the repo as when the
        // eval ran.
        assert_eq!(measured_at(&json!({}), None, None), None);
    }

    #[test]
    fn every_committed_report_is_served_with_the_time_it_was_measured() {
        // The invariant the endpoint exists to hold: no number without its
        // measurement time. Runs against the real committed store, so a report
        // added later in a shape nobody thought about fails here.
        let dir = committed_reports();
        let runs = load_eval_runs(&dir).expect("read committed evals/reports");
        assert!(!runs.is_empty(), "the committed store is not empty");

        for r in &runs {
            let m = r
                .measured_at
                .as_ref()
                .unwrap_or_else(|| panic!("run {} is served with no measurement time", r.run_id));
            assert!(
                matches!(m.precision, "second" | "day"),
                "run {} has precision {:?}",
                r.run_id,
                m.precision
            );
            // The value must start with the date the file name encodes, so the
            // timestamp cannot silently belong to a different run.
            if let Some(date) = &r.date {
                assert!(
                    m.at.starts_with(date.as_str()),
                    "run {} measured_at {:?} does not start with its date {date}",
                    r.run_id,
                    m.at
                );
            }
        }
    }

    #[test]
    fn served_numbers_equal_the_numbers_in_the_file_they_came_from() {
        // Comparison, not 200-OK. Reads one real committed report directly and
        // asserts the projection reproduces its figures exactly.
        let dir = committed_reports();
        let runs = load_eval_runs(&dir).expect("read committed evals/reports");

        let mut checked = 0usize;
        for r in &runs {
            let path = dir.join(format!("{}.json", r.run_id));
            let raw: Value =
                serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();

            if let Some(expected) = raw.get("average_score").and_then(Value::as_f64) {
                let served = r.primary_metric.as_ref().unwrap_or_else(|| {
                    panic!("{} has average_score but no primary_metric", r.run_id)
                });
                assert_eq!(served.name, "average_score");
                assert_eq!(
                    served.rate, expected,
                    "{} served {} but the file says {expected}",
                    r.run_id, served.rate
                );
                checked += 1;
            }
            if let Some(expected) = raw.get("total_tasks").and_then(Value::as_u64) {
                assert_eq!(r.metrics.total_tasks, Some(expected), "{}", r.run_id);
            }
            if let Some(expected) = raw.get("started_at").and_then(Value::as_str) {
                assert_eq!(
                    r.measured_at.as_ref().map(|m| m.at.as_str()),
                    Some(expected),
                    "{} must be timestamped with its own started_at",
                    r.run_id
                );
            }
            if let Some(expected) = raw.get("run_id").and_then(Value::as_str) {
                assert_eq!(
                    r.report_run_id.as_deref(),
                    Some(expected),
                    "{}: the harness's own run id must survive to the wire",
                    r.run_id
                );
            }
        }
        assert!(
            checked > 0,
            "no committed report exposed average_score — this test stopped comparing anything"
        );
    }

    #[test]
    fn suite_history_groups_the_store_and_dates_its_headline_figure() {
        let dir = unique_tmp();
        std::fs::write(
            dir.join("eval_smoke_20260824_030710.json"),
            r#"{"average_score":0.8,"total_tasks":3,"failed_tasks":0,
                "started_at":"2026-08-24T03:07:10+00:00"}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("eval_smoke_20260823_030542.json"),
            r#"{"average_score":0.6,"total_tasks":3,"failed_tasks":1,
                "started_at":"2026-08-23T03:05:42+00:00"}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("asb-20260822.json"),
            r#"{"suite":"asb","total_cases":31,
                "block_rate_under_attack":{"rate":1.0}}"#,
        )
        .unwrap();

        let histories = build_suite_histories(load_eval_runs(&dir).unwrap());
        assert_eq!(histories.len(), 2, "two suites in the store");

        let smoke = histories.iter().find(|h| h.suite == "smoke").unwrap();
        assert_eq!(smoke.run_count, 2);
        // Newest first: the 08-24 run, not the 08-23 one.
        assert_eq!(smoke.latest_metric.as_ref().unwrap().rate, 0.8);
        assert_eq!(
            smoke.latest_measured_at.as_ref().unwrap().at,
            "2026-08-24T03:07:10+00:00",
            "the headline figure must carry the time of the run it came from"
        );
        assert_eq!(smoke.latest_gate_status.as_deref(), Some("passed"));

        let asb = histories.iter().find(|h| h.suite == "asb").unwrap();
        assert_eq!(asb.run_count, 1);
        // No timestamp in the body -> day precision from the file name, not a
        // fabricated midnight.
        let m = asb.latest_measured_at.as_ref().unwrap();
        assert_eq!(m.at, "2026-08-22");
        assert_eq!(m.precision, "day");

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn regression_entries_carry_both_endpoints_measurement_times() {
        // A delta is a claim about two instants. Without them a reader cannot
        // tell an overnight regression from one spanning seven weeks.
        let dir = unique_tmp();
        std::fs::write(
            dir.join("eval_smoke_20260824_030710.json"),
            r#"{"average_score":0.6,"started_at":"2026-08-24T03:07:10+00:00"}"#,
        )
        .unwrap();
        std::fs::write(
            dir.join("eval_smoke_20260823_030542.json"),
            r#"{"average_score":0.9,"started_at":"2026-08-23T03:05:42+00:00"}"#,
        )
        .unwrap();

        let report = build_regression_report(load_eval_runs(&dir).unwrap());
        assert_eq!(report.regressions.len(), 1);
        let r = &report.regressions[0];
        assert_eq!(
            r.from_measured_at.as_ref().unwrap().at,
            "2026-08-23T03:05:42+00:00"
        );
        assert_eq!(
            r.to_measured_at.as_ref().unwrap().at,
            "2026-08-24T03:07:10+00:00"
        );
        assert!(r.delta < 0.0);

        std::fs::remove_dir_all(&dir).ok();
    }
}
