//! Gates the coherence monitor's shadow → enforce transition on a *measured*
//! false-positive rate.
//!
//! `FERRUMDECK_COHERENCE_MODE=enforce` makes an R3 coherence divergence park the
//! run at `WaitingApproval`. The detector is a lexical matcher, so its precision
//! is a property of the vocabulary it meets, and for four releases the only
//! statement of that precision anywhere in the repository was the phrase
//! "non-zero false-positive rate" in the README and both runbooks. No number.
//!
//! Enforcement on an unmeasured signal is not a reliability feature. Its failure
//! mode is a correct run parked at a gate, so an unknown rate is an unknown
//! availability risk — and unknown in the direction that looks fine until it is
//! a queue of blocked runs nobody is watching.
//!
//! So enforce mode does not activate on request alone. It activates when there
//! is evidence, and the evidence is a row in the append-only measurement series
//! (`docs/eval-health-series.jsonl`, the file added on 2026-09-01 precisely so a
//! regressed number cannot silently overwrite a good one). Absence of a
//! measurement is treated as a refusal, not as permission: that is the whole
//! point, and it is the one behaviour here worth keeping if everything else is
//! rewritten.

use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};

/// Env override for the measurement series (else resolved relative to cwd),
/// mirroring `FD_EVALS_REPORTS_DIR` for the eval read path.
const SERIES_PATH_ENV: &str = "FERRUMDECK_COHERENCE_FP_SERIES";

/// Default location of the append-only measurement series.
const DEFAULT_SERIES_PATH: &str = "docs/eval-health-series.jsonl";

/// Series `suite` value carrying the coherence false-positive measurement.
const FP_SUITE: &str = "coherence_fp";

// There is deliberately no maximum-false-positive-rate constant here.
//
// Through 0.8.17 this file defined `MAX_FP_RATE_FOR_ENFORCE = 0.15` and refused
// enforcement above it. That gate was circular: 0.15 was the Wilson 95% upper
// bound of the single measurement it gated (10.42%, CI [7.16%, 14.92%]) rounded
// up, so it permitted enforcement whenever the rate was "no worse than today's
// data says the true rate plausibly already is". It could not fail against the
// measurement that set it, a detector regressing from 10.42% to 14.9% would
// still have passed, and if the detector improved the threshold would not have
// followed.
//
// Deriving an honest threshold needs two inputs this project does not have and
// cannot fabricate: how many runs an operator actually puts through the gate,
// and how quickly a human clears a parked one. With those, the limit becomes a
// statement in operator terms -- "no more than N correct runs parked per week,
// cleared within M minutes" -- and the constant is derived rather than borrowed
// from a confidence interval. Without them, any number here is invented and
// wearing the costume of a derivation, which is the exact species of claim this
// gate exists to stop.
//
// So the gate is a REPORTING REQUIREMENT, not a threshold. Enforcement requires
// that a measurement exists and is fresh -- both independent of what the
// measurement says -- and the rate is then reported, in operator terms, to
// whoever turns the switch on. The operator owns the availability decision,
// because the operator is the only party holding the missing inputs. Refusing
// on an unmeasured matcher is kept: absence of evidence is still a refusal.
//
// Restoring a threshold means supplying the availability budget first. See
// issue #56.

/// How old the measurement may be before it stops counting as evidence.
///
/// Matches `MAX_AGE_DAYS` in `scripts/gen_eval_health.py`. A rate measured
/// against a matcher two releases ago describes that matcher, and the keyword
/// lists this detector runs on are edited by hand.
pub const MAX_EVIDENCE_AGE_DAYS: i64 = 14;

/// The measured false-positive rate, as read from the series.
#[derive(Debug, Clone, PartialEq)]
pub struct FpMeasurement {
    pub rate: f64,
    pub ci_low: f64,
    pub ci_high: f64,
    pub total: u64,
    pub measured_at: DateTime<Utc>,
    pub report: String,
}

/// Why enforce mode was or was not allowed to activate. Carried rather than
/// reduced to a bool so the caller can say which of the four it was; "enforce
/// is off" without a reason is how an operator concludes the flag is broken.
#[derive(Debug, Clone, PartialEq)]
pub enum EnforceDecision {
    /// Evidence exists and is fresh. The rate it carries is reported, not
    /// judged -- see the note on the absent threshold above.
    Allowed(FpMeasurement),
    /// The series file could not be read.
    NoSeries { path: PathBuf, reason: String },
    /// The series exists but carries no coherence false-positive row.
    NoMeasurement { path: PathBuf },
    /// A measurement exists but is older than [`MAX_EVIDENCE_AGE_DAYS`].
    Stale {
        measurement: FpMeasurement,
        age_days: i64,
    },
}

impl EnforceDecision {
    /// Whether enforce mode may activate.
    pub fn allowed(&self) -> bool {
        matches!(self, EnforceDecision::Allowed(_))
    }

    /// One line, suitable for a boot log and for `/ready`.
    pub fn explain(&self) -> String {
        match self {
            EnforceDecision::Allowed(m) => format!(
                "allowed: measured false-positive rate {:.2}% (n={}, Wilson 95% CI \
                 [{:.2}%, {:.2}%]) from {}. Enforcing at this rate parks roughly {} in every \
                 100 correct runs at an approval gate. This is reported, not vetted: there is \
                 no maximum-rate threshold, because deriving one needs gated-run volume and \
                 time-to-clear, which only you have. You are accepting this rate.",
                m.rate * 100.0,
                m.total,
                m.ci_low * 100.0,
                m.ci_high * 100.0,
                m.report,
                (m.rate * 100.0).round() as i64
            ),
            EnforceDecision::NoSeries { path, reason } => format!(
                "refused: no measurement series at {} ({reason}). Enforce mode gates runs on a \
                 lexical matcher; without a measured false-positive rate that is an unbounded \
                 availability risk. Run `make eval-coherence-fp` and commit the report.",
                path.display()
            ),
            EnforceDecision::NoMeasurement { path } => format!(
                "refused: {} carries no `{FP_SUITE}` row. Run `make eval-coherence-fp` and \
                 commit the report, then regenerate the series.",
                path.display()
            ),
            EnforceDecision::Stale {
                measurement,
                age_days,
            } => format!(
                "refused: the newest false-positive measurement ({}) is {age_days} days old \
                 (limit {MAX_EVIDENCE_AGE_DAYS}). The detector's keyword lists are hand-edited, \
                 so a rate measured that long ago describes a different matcher. Re-run \
                 `make eval-coherence-fp`.",
                measurement.report
            ),
        }
    }
}

/// Resolve the series path from the environment, else the default.
pub fn series_path() -> PathBuf {
    std::env::var(SERIES_PATH_ENV)
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(DEFAULT_SERIES_PATH))
}

/// Read the newest coherence false-positive measurement from `path`.
///
/// "Newest" is by `measured_at`, not by file order. The series is append-only,
/// so a correction row for an older measurement can legitimately arrive after a
/// newer one, and taking the last line would then read the correction as
/// current.
pub fn newest_measurement(path: &Path) -> Result<Option<FpMeasurement>, String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut best: Option<FpMeasurement> = None;

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Ok(row) = serde_json::from_str::<serde_json::Value>(line) else {
            continue; // a malformed line is skipped, never rewritten
        };
        if row.get("suite").and_then(|v| v.as_str()) != Some(FP_SUITE) {
            continue;
        }
        let (Some(rate), Some(total)) = (
            row.get("fp_rate").and_then(|v| v.as_f64()),
            row.get("fp_total").and_then(|v| v.as_u64()),
        ) else {
            continue;
        };
        let Some(measured_at) = row
            .get("measured_at")
            .and_then(|v| v.as_str())
            .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
            .map(|d| d.with_timezone(&Utc))
        else {
            continue;
        };
        let candidate = FpMeasurement {
            rate,
            ci_low: row
                .get("fp_ci95_low")
                .and_then(|v| v.as_f64())
                .unwrap_or(0.0),
            ci_high: row
                .get("fp_ci95_high")
                .and_then(|v| v.as_f64())
                .unwrap_or(1.0),
            total,
            measured_at,
            report: row
                .get("report")
                .and_then(|v| v.as_str())
                .unwrap_or("(unnamed)")
                .to_string(),
        };
        // Explicit match rather than `Option::is_none_or`: that is stable only
        // since 1.82 and this workspace declares MSRV 1.80.
        let is_newer = match best.as_ref() {
            None => true,
            Some(b) => candidate.measured_at >= b.measured_at,
        };
        if is_newer {
            best = Some(candidate);
        }
    }
    Ok(best)
}

/// Decide whether enforce mode may activate, given the evidence on disk.
pub fn decide(path: &Path, now: DateTime<Utc>) -> EnforceDecision {
    let measurement = match newest_measurement(path) {
        Err(reason) => {
            return EnforceDecision::NoSeries {
                path: path.to_path_buf(),
                reason,
            }
        }
        Ok(None) => {
            return EnforceDecision::NoMeasurement {
                path: path.to_path_buf(),
            }
        }
        Ok(Some(m)) => m,
    };

    let age_days = (now - measurement.measured_at).num_days();
    if age_days > MAX_EVIDENCE_AGE_DAYS {
        return EnforceDecision::Stale {
            measurement,
            age_days,
        };
    }
    // No rate comparison: the measurement is reported to the operator, not
    // judged against a number this project cannot derive. See the note above.
    EnforceDecision::Allowed(measurement)
}

/// Convenience for boot: resolve the path and decide against the current clock.
pub fn decide_now() -> EnforceDecision {
    decide(&series_path(), Utc::now())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-09-02T12:00:00Z")
            .unwrap()
            .with_timezone(&Utc)
    }

    fn row(suite: &str, rate: f64, measured_at: &str, report: &str) -> String {
        format!(
            r#"{{"suite":"{suite}","fp_rate":{rate},"fp_total":240,"fp_ci_low":0.07,"fp_ci_high":0.15,"measured_at":"{measured_at}","report":"{report}"}}"#
        )
    }

    /// Unique temp dir per call — same std-only pattern as the `handlers::evals`
    /// tests, so this adds no dependency for the sake of a fixture.
    fn write_series(lines: &[String]) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static N: AtomicU64 = AtomicU64::new(0);
        let dir = std::env::temp_dir().join(format!(
            "fd_coherence_evidence_{}_{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).expect("create dir");
        let path = dir.join("series.jsonl");
        let mut f = std::fs::File::create(&path).expect("create");
        for l in lines {
            writeln!(f, "{l}").expect("write");
        }
        path
    }

    #[test]
    fn a_missing_series_refuses_enforcement() {
        // The property worth keeping if everything else here is rewritten:
        // absence of a measurement is a refusal, never permission.
        let d = decide(Path::new("/nonexistent/series.jsonl"), now());
        assert!(!d.allowed());
        assert!(matches!(d, EnforceDecision::NoSeries { .. }));
        assert!(d.explain().contains("no measurement series"));
    }

    #[test]
    fn a_series_without_a_coherence_row_refuses_enforcement() {
        let path = write_series(&[row("smoke", 0.0, "2026-09-02T00:00:00Z", "s.json")]);
        let d = decide(&path, now());
        assert!(!d.allowed());
        assert!(matches!(d, EnforceDecision::NoMeasurement { .. }));
    }

    #[test]
    fn a_fresh_measurement_allows_enforcement() {
        let path = write_series(&[row(
            FP_SUITE,
            0.1042,
            "2026-09-02T00:00:00Z",
            "coherence_fp-20260902.json",
        )]);
        let d = decide(&path, now());
        assert!(d.allowed(), "{}", d.explain());
    }

    #[test]
    fn a_high_rate_is_reported_not_refused() {
        // Inverted at 0.8.18. This previously asserted that a rate above
        // `MAX_FP_RATE_FOR_ENFORCE` refused enforcement -- a gate that could
        // not fail, because the constant was the Wilson upper bound of the
        // measurement it gated. The rate is now reported to the operator, who
        // holds the inputs needed to price it. Absence of evidence still
        // refuses; a number the operator may dislike does not.
        let path = write_series(&[row(FP_SUITE, 0.42, "2026-09-02T00:00:00Z", "r.json")]);
        let d = decide(&path, now());
        assert!(
            d.allowed(),
            "a measured rate must not be vetted: {}",
            d.explain()
        );

        let explained = d.explain();
        assert!(
            explained.contains("42.00%"),
            "the rate must be reported verbatim: {explained}"
        );
        assert!(
            explained.contains("park"),
            "the operator must be told the cost in parked runs: {explained}"
        );
        assert!(
            explained.contains("accepting"),
            "the operator must be told they own the decision: {explained}"
        );
    }

    #[test]
    fn no_rate_threshold_is_reintroduced_without_an_availability_budget() {
        // The regression guard for issue #56. Two rates an order of magnitude
        // apart must decide identically, because nothing here is entitled to
        // judge the value. If someone reinstates a threshold, this fails and
        // points at the budget that has to exist first.
        let low = write_series(&[row(FP_SUITE, 0.0001, "2026-09-02T00:00:00Z", "r.json")]);
        let high = write_series(&[row(FP_SUITE, 0.99, "2026-09-02T00:00:00Z", "r.json")]);
        assert_eq!(
            decide(&low, now()).allowed(),
            decide(&high, now()).allowed(),
            "a rate comparison is back in the gate. Restoring one needs gated-run \
             volume and time-to-clear first -- see issue #56."
        );
        assert!(decide(&high, now()).allowed());
    }

    #[test]
    fn a_stale_measurement_refuses_enforcement() {
        // The keyword lists this detector runs on are hand-edited, so an old
        // rate describes a different matcher.
        let path = write_series(&[row(FP_SUITE, 0.05, "2026-08-01T00:00:00Z", "old.json")]);
        let d = decide(&path, now());
        assert!(!d.allowed());
        match d {
            EnforceDecision::Stale { age_days, .. } => assert!(age_days > MAX_EVIDENCE_AGE_DAYS),
            other => panic!("expected Stale, got {other:?}"),
        }
    }

    #[test]
    fn the_newest_measurement_wins_regardless_of_line_order() {
        // The series is append-only, so a correction row for an OLDER
        // measurement can legitimately be appended after a newer one. Reading
        // the last line would then treat the correction as current.
        let path = write_series(&[
            row(FP_SUITE, 0.99, "2026-08-25T00:00:00Z", "old.json"),
            row(FP_SUITE, 0.10, "2026-09-02T00:00:00Z", "new.json"),
            row(
                FP_SUITE,
                0.98,
                "2026-08-26T00:00:00Z",
                "correction-of-old.json",
            ),
        ]);
        let m = newest_measurement(&path).expect("read").expect("some");
        assert_eq!(m.report, "new.json");
        assert!(decide(&path, now()).allowed());
    }

    #[test]
    fn a_malformed_line_is_skipped_not_fatal() {
        let path = write_series(&[
            "not json at all".to_string(),
            row(FP_SUITE, 0.10, "2026-09-02T00:00:00Z", "good.json"),
        ]);
        assert!(decide(&path, now()).allowed());
    }

    #[test]
    fn the_committed_series_backs_enforcement_today() {
        // Integration against the real file. This is what an operator actually
        // gets, and it fails if the measurement is never re-run.
        let repo =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../docs/eval-health-series.jsonl");
        if !repo.exists() {
            return;
        }
        let m = newest_measurement(&repo)
            .expect("the committed series must parse")
            .expect("the committed series must carry a coherence_fp row");
        assert!(
            m.total >= 200,
            "corpus of {} is below the 200 floor",
            m.total
        );
        assert!(
            (0.0..=1.0).contains(&m.rate),
            "the published rate {:.4} is not a proportion",
            m.rate
        );
    }

    #[test]
    fn the_committed_measurement_is_reported_with_its_interval() {
        // Replaces `the_threshold_is_the_published_intervals_upper_bound`, which
        // asserted that the committed interval stayed under the constant derived
        // from it -- a tautology dressed as a check. What matters now is that
        // whatever the operator is shown is complete: rate, sample size and
        // interval, so the number can be argued with.
        let repo =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../docs/eval-health-series.jsonl");
        if !repo.exists() {
            return;
        }
        let m = newest_measurement(&repo).expect("read").expect("some");
        assert!(
            m.ci_low <= m.rate && m.rate <= m.ci_high,
            "the published point estimate {:.4} is outside its own interval [{:.4}, {:.4}]",
            m.rate,
            m.ci_low,
            m.ci_high
        );

        let explained = EnforceDecision::Allowed(m.clone()).explain();
        let needles = [
            format!("n={}", m.total),
            "Wilson 95% CI".to_string(),
            "park".to_string(),
        ];
        for needle in &needles {
            assert!(
                explained.contains(needle),
                "the operator-facing line must carry {needle:?}: {explained}"
            );
        }
    }
}
