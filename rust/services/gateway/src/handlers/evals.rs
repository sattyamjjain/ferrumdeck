//! Eval-read endpoints (issue #7).
//!
//! Serves the on-disk eval **reports** the fd-evals framework writes to
//! `evals/reports/`, so the dashboard's eval-run and regression views can read
//! real results instead of a BFF stub. Two naming families live there and both
//! are served: `<suite>-<YYYYMMDD>.json` for the offline benchmarks, and
//! `eval_<suite>_<YYYYMMDD>_<HHMMSS>.json` for the LLM-backed suites. Only the
//! first was handled until 2026-08-16, so every safe-PR smoke and regression
//! report was dropped before it reached the dashboard — see [`parse_stem`].
//!
//! ## Deployment caveat — why #7 stays disclosed
//!
//! These reports are file-backed run records. A `make run-gateway` process
//! (cwd = repo root) resolves `evals/reports/`, and the gateway **image now bakes
//! the committed reports** (`deploy/docker/Dockerfile.gateway` copies them and sets
//! `FD_EVALS_REPORTS_DIR`), so a deployed container serves real data rather than
//! `501`. When no reports directory is reachable at all these endpoints still return
//! `501 { code: "NO_EVAL_STORE" }` — never an empty `200 { runs: [] }`, which would
//! read as "no runs exist" (the fabricated-success class the SSE mock and eval-run
//! POST fixes already closed). The store is **read-only committed records**: a run
//! *dispatched* at request time has nowhere to persist yet, so the end-to-end live
//! round-trip (dispatch → gateway → durable store → dashboard) is **not yet
//! verified** and the #7 disclosure stays until it is confirmed on a live stack.

use std::path::{Path, PathBuf};

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use serde_json::{json, Value};

use super::ApiError;

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
    pub date: Option<String>,
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

/// Parse a report file stem into `(suite, date)`.
///
/// Two naming families live in `evals/reports/`:
///
/// * `<suite>-<YYYYMMDD>` — the offline benchmarks (`asb-20260810`,
///   `governed-benchmark-20260810`). Suite names may contain hyphens, so the
///   date is the final hyphen-delimited field.
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
fn parse_stem(stem: &str) -> Option<(String, Option<String>)> {
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
                    return Some((suite.to_string(), Some(date)));
                }
            }
        }
    }

    let (suite, date_raw) = stem.rsplit_once('-')?;
    if suite.is_empty() {
        return None;
    }
    Some((suite.to_string(), iso_date(date_raw)))
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
        let Some((suite_from_name, date)) = parse_stem(stem) else {
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

/// The honest "no eval store here" response (see the module caveat). Named 501,
/// carrying #7 — never an empty 200.
fn no_store_response() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(json!({
            "error": {
                "code": "NO_EVAL_STORE",
                "message": "No eval-results store is reachable from this gateway: evals/reports was not found (set FD_EVALS_REPORTS_DIR, or run from a tree that has it; the gateway image bakes the committed reports, but eval results are not yet persisted to a durable store). No runs are returned rather than an empty list — an empty list would read as 'no runs exist'. Tracked in issue #7.",
                "issue": "https://github.com/sattyamjjain/ferrumdeck/issues/7"
            }
        })),
    )
        .into_response()
}

fn read_error_response(e: EvalReadError) -> Response {
    match e {
        EvalReadError::NoStore => no_store_response(),
        EvalReadError::Io(msg) => {
            tracing::error!(error = %msg, "reading eval reports");
            ApiError::internal("failed to read eval reports").into_response()
        }
    }
}

/// `GET /v1/evals/runs` — list eval runs, one per on-disk report, newest first.
pub async fn list_eval_runs() -> Response {
    match tokio::task::spawn_blocking(load_from_resolved).await {
        Ok(Ok((dir, runs))) => {
            let count = runs.len();
            Json(json!({
                "runs": runs,
                "count": count,
                "source": dir.display().to_string(),
            }))
            .into_response()
        }
        Ok(Err(e)) => read_error_response(e),
        Err(e) => {
            tracing::error!(error = %e, "eval reports task join failed");
            ApiError::internal("failed to read eval reports").into_response()
        }
    }
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
pub async fn eval_regression_report() -> Response {
    match tokio::task::spawn_blocking(load_from_resolved).await {
        Ok(Ok((dir, runs))) => {
            let report = build_regression_report(runs);
            Json(json!({
                "regressions": report.regressions,
                "regression_count": report.regressions.len(),
                "compared_suites": report.compared,
                "insufficient_history": report.insufficient_history,
                "source": dir.display().to_string(),
            }))
            .into_response()
        }
        Ok(Err(e)) => read_error_response(e),
        Err(e) => {
            tracing::error!(error = %e, "eval reports task join failed");
            ApiError::internal("failed to read eval reports").into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
            Some(("asb".to_string(), Some("2026-08-08".to_string())))
        );
        assert_eq!(
            parse_stem("governed-benchmark-20260725"),
            Some((
                "governed-benchmark".to_string(),
                Some("2026-07-25".to_string())
            ))
        );
        // No trailing 8-digit date → suite kept, date None.
        assert_eq!(
            parse_stem("weirdname-notadate"),
            Some(("weirdname".to_string(), None))
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
            Some(("regression".to_string(), Some("2026-08-16".to_string())))
        );
        assert_eq!(
            parse_stem("eval_smoke_20260816_030324"),
            Some(("smoke".to_string(), Some("2026-08-16".to_string())))
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
}
