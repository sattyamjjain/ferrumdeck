//! Claim-grounding-rate reliability metric — claim-level grounding per
//! **VeriGraph** (arXiv:2606.16603).
//!
//! `claim_grounding_rate = (claims reachable from a source node) / (total claims)`
//!
//! For a completed run, a *claim* is a sentence in the final agent output and a
//! *source node* is a tool-step output (raw data the agent observed). Per
//! VeriGraph's claim-level definition, a claim is **grounded** when a reachable
//! evidence path exists from some source node to that claim.
//!
//! ## Honest scope — a deterministic proxy, not an LLM judge
//!
//! We operationalize "reachable evidence path" as a **deterministic
//! lexical-overlap reachability proxy**: a claim is grounded when a sufficient
//! fraction of its significant tokens are covered by the union of source-node
//! tokens. This is pure and CI-stable — same inputs → same output on every
//! machine, no model call, no clock — in the same spirit as
//! [`crate::firing_rate`]. It is **"grounding rate per VeriGraph"**, a
//! lineage to the claim-level auditability literature, **not** a
//! ferrumdeck-original metric and **not** a semantic-entailment judgment.
//!
//! ## Reliability signal, not a gate
//!
//! The metric is a *reliability signal*. A project may set an optional
//! `min_claim_grounding_rate` threshold that **flags** a run below it
//! ([`ClaimGrounding::below_threshold`]); it never blocks a tool and never
//! kills a run — the deny-by-default posture is for tool permissions, not for
//! reliability scoring.
//!
//! Anti-pivot guard: like [`crate::firing_rate`], the compute takes plain
//! counters / text (no `fd-storage` dependency); the gateway extracts the
//! output + tool-output strings and calls in.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tracing::Span;

use crate::genai::attrs;

/// Default opt-in minimum grounding rate. Only used when a project explicitly
/// sets `min_claim_grounding_rate`; absent a project threshold the metric is
/// computed and surfaced but **never flags** (off by default).
pub const DEFAULT_MIN_CLAIM_GROUNDING_RATE: f64 = 0.70;

/// A claim must carry at least this many distinct significant tokens to be
/// scored — drops trivial fragments ("Done.", "OK!") that aren't real claims.
pub const MIN_CLAIM_TOKENS: usize = 3;

/// Fraction of a claim's significant tokens that must be covered by a source
/// node for the claim to count as grounded.
pub const GROUNDING_OVERLAP: f64 = 0.5;

/// Minimum length (in ASCII chars) of a "significant" token. Shorter tokens
/// (`a`, `is`, `to`, `of`) are dropped as non-discriminative.
const MIN_TOKEN_LEN: usize = 3;

/// Per-run claim-grounding snapshot. Pure derived metric — same inputs always
/// produce the same struct. Mirrored field-for-field by the Python
/// `fd_evals.claim_grounding.ClaimGrounding`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ClaimGrounding {
    /// Total scored claims found in the final output.
    pub claims_total: u32,
    /// Claims with a reachable evidence path from a source node.
    pub claims_grounded: u32,
    /// `claims_grounded / claims_total`, in `[0.0, 1.0]`. `1.0` when
    /// `claims_total == 0` — a run that makes no claims has nothing ungrounded,
    /// so "no claims" is never a failure (mirrors the firing-rate empty window).
    pub rate: f64,
    /// `true` when `claims_total > 0 && rate < threshold`. A *flag* only — never
    /// an enforcement action.
    pub below_threshold: bool,
    /// Threshold used for the flag decision.
    pub threshold: f64,
}

impl ClaimGrounding {
    /// Compute from raw counters. `claims_grounded` is clamped to
    /// `claims_total` so a mis-count can't produce a rate > 1.0.
    pub fn compute(claims_total: u32, claims_grounded: u32, threshold: f64) -> Self {
        let claims_grounded = claims_grounded.min(claims_total);
        let rate = if claims_total == 0 {
            1.0
        } else {
            f64::from(claims_grounded) / f64::from(claims_total)
        };
        let below_threshold = claims_total > 0 && rate < threshold;
        Self {
            claims_total,
            claims_grounded,
            rate,
            below_threshold,
            threshold,
        }
    }

    /// Derive the metric from the final `output` text and the `sources`
    /// (tool-output strings). Deterministic — see the module docs for the
    /// exact lexical-overlap reachability rule. Mirrors the Python
    /// `compute_from_run` token-for-token.
    pub fn compute_from_texts(output: &str, sources: &[String], threshold: f64) -> Self {
        let source_tokens: HashSet<String> =
            sources.iter().flat_map(|s| significant_tokens(s)).collect();

        let mut total = 0u32;
        let mut grounded = 0u32;
        for claim in split_claims(output) {
            let toks = distinct_significant_tokens(&claim);
            if toks.len() < MIN_CLAIM_TOKENS {
                continue;
            }
            total += 1;
            let covered = toks.iter().filter(|t| source_tokens.contains(*t)).count();
            let frac = covered as f64 / toks.len() as f64;
            if frac >= GROUNDING_OVERLAP {
                grounded += 1;
            }
        }
        Self::compute(total, grounded, threshold)
    }

    /// Whether the run made no scored claims (renders as "no claims" rather
    /// than a 100% reading on the dashboard).
    pub fn is_empty(&self) -> bool {
        self.claims_total == 0
    }
}

/// Split text into claim fragments on sentence terminators + newlines.
fn split_claims(text: &str) -> Vec<String> {
    text.split(['.', '!', '?', '\n'])
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Significant tokens of a text: ASCII-alphanumeric runs of length
/// `>= MIN_TOKEN_LEN`, lowercased. Non-ASCII chars act as separators (a
/// deterministic, locale-free rule that both planes implement identically).
fn significant_tokens(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|t| t.len() >= MIN_TOKEN_LEN)
        .map(|t| t.to_ascii_lowercase())
        .collect()
}

/// Distinct (deduplicated, insertion-order-independent) significant tokens.
fn distinct_significant_tokens(text: &str) -> HashSet<String> {
    significant_tokens(text).into_iter().collect()
}

/// Tag a [`tracing::Span`] with the claim-grounding attributes under the
/// existing `ferrumdeck.*` semconv extension.
pub fn record_on_span(span: &Span, metric: &ClaimGrounding) {
    span.record(
        attrs::FERRUMDECK_RELIABILITY_CLAIM_GROUNDING_RATE,
        metric.rate,
    );
    span.record(
        attrs::FERRUMDECK_RELIABILITY_CLAIM_GROUNDING_FLAGGED,
        metric.below_threshold,
    );
    span.record(
        attrs::FERRUMDECK_RELIABILITY_CLAIM_GROUNDING_THRESHOLD,
        metric.threshold,
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_output_has_no_claims_and_never_flags() {
        let m = ClaimGrounding::compute_from_texts("", &[], 0.7);
        assert_eq!(m.claims_total, 0);
        assert_eq!(m.rate, 1.0);
        assert!(m.is_empty());
        assert!(!m.below_threshold, "no claims must never flag");
    }

    #[test]
    fn fully_grounded_output_rate_is_one() {
        let sources = vec!["Paris is the capital of France.".to_string()];
        let m =
            ClaimGrounding::compute_from_texts("The capital of France is Paris.", &sources, 0.7);
        assert_eq!(m.claims_total, 1);
        assert_eq!(m.claims_grounded, 1);
        assert_eq!(m.rate, 1.0);
        assert!(!m.below_threshold);
    }

    #[test]
    fn unsupported_claim_is_not_grounded() {
        let sources = vec!["Paris is the capital of France.".to_string()];
        let m = ClaimGrounding::compute_from_texts(
            "Bananas are purple and fly to the distant moon.",
            &sources,
            0.7,
        );
        assert_eq!(m.claims_total, 1);
        assert_eq!(m.claims_grounded, 0);
        assert_eq!(m.rate, 0.0);
        assert!(m.below_threshold);
    }

    #[test]
    fn trivial_fragments_are_dropped() {
        // "Done" / "OK" have < MIN_CLAIM_TOKENS significant tokens.
        let m = ClaimGrounding::compute_from_texts("Done. OK!", &[], 0.7);
        assert_eq!(m.claims_total, 0);
    }

    #[test]
    fn threshold_uses_strict_less_than() {
        // rate exactly == threshold must not flag.
        let m = ClaimGrounding::compute(10, 7, 0.70);
        assert!((m.rate - 0.70).abs() < 1e-9);
        assert!(
            !m.below_threshold,
            "exact-threshold rate must not flag (strict <)"
        );
    }

    #[test]
    fn grounded_clamped_to_total() {
        let m = ClaimGrounding::compute(3, 9, 0.7);
        assert_eq!(m.claims_grounded, 3);
        assert_eq!(m.rate, 1.0);
    }

    #[test]
    fn golden_cross_plane_fixture() {
        // Pinned alongside the Python golden test
        // (`tests/fixtures/claim_grounding.golden.json`): 3 claims, 2 grounded.
        let output = "The capital of France is Paris. The Eiffel Tower is in Paris. \
                      Bananas are purple and fly to the distant moon.";
        let sources = vec![
            "Paris is the capital of France.".to_string(),
            "The Eiffel Tower stands in Paris, France.".to_string(),
        ];
        let m = ClaimGrounding::compute_from_texts(output, &sources, 0.70);
        assert_eq!(m.claims_total, 3);
        assert_eq!(m.claims_grounded, 2);
        assert!((m.rate - 2.0 / 3.0).abs() < 1e-9);
        assert!(m.below_threshold, "0.667 < 0.70 → flagged");
    }

    #[test]
    fn serialises_stable_keys() {
        let m = ClaimGrounding::compute(3, 2, 0.7);
        let json = serde_json::to_value(m).unwrap();
        assert_eq!(json["claims_total"], 3);
        assert_eq!(json["claims_grounded"], 2);
        assert!((json["rate"].as_f64().unwrap() - 2.0 / 3.0).abs() < 1e-9);
        assert_eq!(json["below_threshold"], true);
    }

    #[test]
    fn record_on_span_compiles() {
        let span = tracing::Span::none();
        record_on_span(&span, &ClaimGrounding::compute(3, 2, 0.7));
    }
}
