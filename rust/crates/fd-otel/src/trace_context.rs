//! W3C Trace Context extraction from an MCP request `_meta`, per **MCP SEP-414**.
//!
//! SEP-414 ("Document OpenTelemetry Trace Context Propagation Conventions",
//! Final / Standards Track) reserves the **unprefixed** `_meta` keys
//! `traceparent`, `tracestate`, and `baggage` — an exception to MCP's DNS-prefix
//! rule — so an OpenTelemetry trace can cross the MCP boundary. When present the
//! values follow [W3C Trace Context](https://www.w3.org/TR/trace-context/) and
//! [W3C Baggage](https://www.w3.org/TR/baggage/) formats. See
//! <https://modelcontextprotocol.io/seps/414-request-meta>.
//!
//! This module turns a caller-supplied `_meta` object into a validated
//! [`ExtractedTraceContext`] used to **parent** ferrumdeck's existing
//! enforcement decision span (`fd_otel::decision::emit_tool_decision_span`), so a
//! trace reads end-to-end: host → client SDK → MCP server → ferrumdeck decision
//! → downstream.
//!
//! ## Posture
//!
//! - **Liberal in what we accept, strict in what we emit.** Key lookup is
//!   case-insensitive; hex is lowercased before validation. But a `traceparent`
//!   that does not parse as a valid W3C value is **rejected** (extraction returns
//!   `None`) rather than propagated — an unvalidated trace-id is an injection
//!   surface into whatever consumes the audit log downstream. An all-zero
//!   trace-id or parent-id is invalid per W3C and rejected.
//! - **Cap, don't error, on `tracestate`/`baggage` overflow.** Oversized values
//!   are truncated to the W3C limits and the drop is recorded
//!   ([`TraceDrops`]) — a hostile or chatty caller cannot make extraction fail.
//! - **Pure.** No environment reads here; the caller applies the stability
//!   opt-in gate (`OTEL_SEMCONV_STABILITY_OPT_IN`) before calling.

use std::str::FromStr;

use opentelemetry::trace::{SpanContext, SpanId, TraceContextExt, TraceFlags, TraceId, TraceState};
use opentelemetry::Context;
use serde::{Deserialize, Serialize};

/// `_meta` key carrying the W3C `traceparent` (SEP-414). Unprefixed by design.
pub const TRACEPARENT_META_KEY: &str = "traceparent";
/// `_meta` key carrying the W3C `tracestate` (SEP-414).
pub const TRACESTATE_META_KEY: &str = "tracestate";
/// `_meta` key carrying the W3C `baggage` (SEP-414).
pub const BAGGAGE_META_KEY: &str = "baggage";

/// Anchor recorded with the audit linkage so a reader can cite the convention.
pub const MCP_TRACE_CONTEXT_ANCHOR: &str = "mcp-sep-414-w3c-trace-context";

// W3C tracestate limits (https://www.w3.org/TR/trace-context/#tracestate-limits):
// at most 32 list-members; combined length target 512; entries longer than 128
// chars are dropped first.
const TRACESTATE_MAX_MEMBERS: usize = 32;
const TRACESTATE_MAX_LEN: usize = 512;
const TRACESTATE_LONG_ENTRY: usize = 128;

// W3C Baggage limits (https://www.w3.org/TR/baggage/#limits): at most 180
// members and 8192 bytes total.
const BAGGAGE_MAX_MEMBERS: usize = 180;
const BAGGAGE_MAX_LEN: usize = 8192;

/// What was dropped while capping `tracestate` / `baggage` to the W3C limits.
/// All-zero when nothing was dropped.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TraceDrops {
    /// `tracestate` list-members removed to fit the member/length limits.
    pub tracestate_members_dropped: usize,
    /// Whether `tracestate` was truncated for length/member overflow.
    pub tracestate_truncated: bool,
    /// `baggage` list-members removed to fit the member/length limits.
    pub baggage_members_dropped: usize,
    /// Whether `baggage` was truncated for length/member overflow.
    pub baggage_truncated: bool,
}

impl TraceDrops {
    /// Whether anything was dropped.
    pub fn any(self) -> bool {
        self.tracestate_truncated || self.baggage_truncated
    }
}

/// A validated W3C trace context extracted from `_meta`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExtractedTraceContext {
    /// 32-hex-lowercase trace-id (never all-zero).
    pub trace_id: String,
    /// 16-hex-lowercase parent span-id of the caller (never all-zero).
    pub parent_id: String,
    /// Whether the caller's `sampled` flag (0x01) is set.
    pub sampled: bool,
    /// Capped, re-serialized `tracestate` (if any survived).
    pub tracestate: Option<String>,
    /// Capped, re-serialized `baggage` (if any survived).
    pub baggage: Option<String>,
    /// What was dropped while capping.
    pub dropped: TraceDrops,
}

impl ExtractedTraceContext {
    /// The canonical (strict, lowercase) `traceparent` we emit downstream.
    pub fn canonical_traceparent(&self) -> String {
        let flags = if self.sampled { "01" } else { "00" };
        format!("00-{}-{}-{}", self.trace_id, self.parent_id, flags)
    }

    /// Build the OpenTelemetry parent [`Context`] to hang the decision span off,
    /// so the span joins the caller's trace as a remote parent.
    pub fn otel_parent_context(&self) -> Context {
        let trace_flags = if self.sampled {
            TraceFlags::SAMPLED
        } else {
            TraceFlags::default()
        };
        let trace_state = self
            .tracestate
            .as_deref()
            .and_then(|ts| TraceState::from_str(ts).ok())
            .unwrap_or_default();
        // These unwraps cannot fail: `trace_id`/`parent_id` were validated as
        // fixed-length lowercase hex during extraction.
        let sc = SpanContext::new(
            TraceId::from_hex(&self.trace_id).unwrap_or(TraceId::INVALID),
            SpanId::from_hex(&self.parent_id).unwrap_or(SpanId::INVALID),
            trace_flags,
            true, // is_remote — this parent came in over the wire
            trace_state,
        );
        Context::new().with_remote_span_context(sc)
    }
}

/// Case-insensitive lookup of a string value in the `_meta` object.
fn meta_get<'a>(meta: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    let obj = meta.as_object()?;
    // Fast path: exact (spec-canonical lowercase) key.
    if let Some(v) = obj.get(key).and_then(serde_json::Value::as_str) {
        return Some(v);
    }
    // Liberal path: case-insensitive match.
    for (k, v) in obj {
        if k.eq_ignore_ascii_case(key) {
            if let Some(s) = v.as_str() {
                return Some(s);
            }
        }
    }
    None
}

/// Parse + strictly validate a W3C `traceparent`. Returns `(trace_id, parent_id,
/// sampled)` or `None` if malformed. Liberal on case (lowercased first), strict
/// on structure; all-zero ids are rejected.
fn parse_traceparent(raw: &str) -> Option<(String, String, bool)> {
    let raw = raw.trim().to_ascii_lowercase();
    let parts: Vec<&str> = raw.split('-').collect();
    // version-format `00` has exactly four fields. We accept only version 00 and
    // reject anything else (unknown future versions are not propagated blindly).
    if parts.len() != 4 {
        return None;
    }
    let (version, trace_id, parent_id, flags) = (parts[0], parts[1], parts[2], parts[3]);

    if version != "00" {
        return None;
    }
    if trace_id.len() != 32 || !is_hex(trace_id) || is_all_zero(trace_id) {
        return None;
    }
    if parent_id.len() != 16 || !is_hex(parent_id) || is_all_zero(parent_id) {
        return None;
    }
    if flags.len() != 2 || !is_hex(flags) {
        return None;
    }
    let flag_byte = u8::from_str_radix(flags, 16).ok()?;
    let sampled = (flag_byte & 0x01) != 0;
    Some((trace_id.to_string(), parent_id.to_string(), sampled))
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_hexdigit())
}

fn is_all_zero(s: &str) -> bool {
    s.bytes().all(|b| b == b'0')
}

/// Cap a comma-separated W3C list (`tracestate`/`baggage`) to the given member
/// and length limits. Per W3C: drop entries longer than `long_entry` first, then
/// drop from the end until within limits. Returns the re-serialized value (if any
/// members survive) and `(members_dropped, truncated)`.
fn cap_list(
    raw: &str,
    max_members: usize,
    max_len: usize,
    long_entry: usize,
) -> (Option<String>, usize, bool) {
    let original: Vec<String> = raw
        .split(',')
        .map(|e| e.trim().to_string())
        .filter(|e| !e.is_empty())
        .collect();
    let original_count = original.len();

    // 1) Drop over-long entries first.
    let mut kept: Vec<String> = original
        .into_iter()
        .filter(|e| e.len() <= long_entry)
        .collect();

    // 2) Drop from the end until within the member limit.
    if kept.len() > max_members {
        kept.truncate(max_members);
    }

    // 3) Drop from the end until within the combined-length limit.
    while joined_len(&kept) > max_len && !kept.is_empty() {
        kept.pop();
    }

    let dropped = original_count.saturating_sub(kept.len());
    let truncated = dropped > 0;
    if kept.is_empty() {
        (None, dropped, truncated)
    } else {
        (Some(kept.join(",")), dropped, truncated)
    }
}

/// Combined length of a comma-joined list (members + separating commas).
fn joined_len(entries: &[String]) -> usize {
    if entries.is_empty() {
        return 0;
    }
    entries.iter().map(String::len).sum::<usize>() + (entries.len() - 1)
}

/// Extract + validate a W3C trace context from an MCP request `_meta` object.
///
/// Returns `None` when there is no valid `traceparent` (missing, or malformed —
/// in which case the caller starts a root span exactly as before). A present but
/// oversized `tracestate`/`baggage` is capped, not rejected.
pub fn extract_from_meta(meta: &serde_json::Value) -> Option<ExtractedTraceContext> {
    let raw_traceparent = meta_get(meta, TRACEPARENT_META_KEY)?;
    let (trace_id, parent_id, sampled) = parse_traceparent(raw_traceparent)?;

    let mut dropped = TraceDrops::default();

    let tracestate = meta_get(meta, TRACESTATE_META_KEY).and_then(|raw| {
        let (capped, n, truncated) = cap_list(
            raw,
            TRACESTATE_MAX_MEMBERS,
            TRACESTATE_MAX_LEN,
            TRACESTATE_LONG_ENTRY,
        );
        dropped.tracestate_members_dropped = n;
        dropped.tracestate_truncated = truncated;
        capped
    });

    let baggage = meta_get(meta, BAGGAGE_META_KEY).and_then(|raw| {
        let (capped, n, truncated) =
            cap_list(raw, BAGGAGE_MAX_MEMBERS, BAGGAGE_MAX_LEN, BAGGAGE_MAX_LEN);
        dropped.baggage_members_dropped = n;
        dropped.baggage_truncated = truncated;
        capped
    });

    Some(ExtractedTraceContext {
        trace_id,
        parent_id,
        sampled,
        tracestate,
        baggage,
        dropped,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // The SEP-414 non-normative example traceparent.
    const SEP414_TP: &str = "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01";

    #[test]
    fn valid_traceparent_extracts_and_parent_context_matches() {
        let meta = serde_json::json!({ "traceparent": SEP414_TP });
        let ctx = extract_from_meta(&meta).expect("valid traceparent");
        assert_eq!(ctx.trace_id, "0af7651916cd43dd8448eb211c80319c");
        assert_eq!(ctx.parent_id, "00f067aa0ba902b7");
        assert!(ctx.sampled);

        // The built OTel parent context carries the same ids + sampled flag —
        // this is the linkage the decision span hangs off.
        let parent = ctx.otel_parent_context();
        let span = parent.span();
        let sc = span.span_context();
        assert_eq!(sc.trace_id().to_string(), ctx.trace_id);
        assert_eq!(sc.span_id().to_string(), ctx.parent_id);
        assert!(sc.is_sampled());
        assert!(sc.is_remote());
    }

    #[test]
    fn unsampled_flag_is_honored() {
        let meta = serde_json::json!({
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-00"
        });
        let ctx = extract_from_meta(&meta).expect("valid");
        assert!(!ctx.sampled);
        let parent = ctx.otel_parent_context();
        let span = parent.span();
        assert!(!span.span_context().is_sampled());
    }

    #[test]
    fn case_insensitive_key_and_uppercase_hex_accepted() {
        let meta = serde_json::json!({
            "TraceParent": "00-0AF7651916CD43DD8448EB211C80319C-00F067AA0BA902B7-01"
        });
        let ctx = extract_from_meta(&meta).expect("liberal accept");
        // Strict emit: lowercased.
        assert_eq!(ctx.trace_id, "0af7651916cd43dd8448eb211c80319c");
        assert_eq!(ctx.canonical_traceparent(), SEP414_TP);
    }

    #[test]
    fn malformed_traceparent_is_rejected() {
        for bad in [
            "",
            "garbage",
            "00-tooShort-00f067aa0ba902b7-01",
            "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7", // missing flags
            "01-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01", // unknown version
            "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-0z", // non-hex flags
            "00-0af7651916cd43dd8448eb211c80319cZZ-00f067aa0ba902b7-01", // non-hex/len trace-id
        ] {
            let meta = serde_json::json!({ "traceparent": bad });
            assert!(
                extract_from_meta(&meta).is_none(),
                "should reject malformed: {bad:?}"
            );
        }
    }

    #[test]
    fn all_zero_ids_are_rejected() {
        let zero_trace = serde_json::json!({
            "traceparent": "00-00000000000000000000000000000000-00f067aa0ba902b7-01"
        });
        assert!(extract_from_meta(&zero_trace).is_none());
        let zero_parent = serde_json::json!({
            "traceparent": "00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01"
        });
        assert!(extract_from_meta(&zero_parent).is_none());
    }

    #[test]
    fn absent_meta_yields_none() {
        assert!(extract_from_meta(&serde_json::json!({})).is_none());
        assert!(extract_from_meta(&serde_json::json!({ "other": "x" })).is_none());
        assert!(extract_from_meta(&serde_json::Value::Null).is_none());
    }

    #[test]
    fn tracestate_is_captured_when_valid() {
        let meta = serde_json::json!({
            "traceparent": SEP414_TP,
            "tracestate": "vendor1=abc,vendor2=def",
        });
        let ctx = extract_from_meta(&meta).expect("valid");
        assert_eq!(ctx.tracestate.as_deref(), Some("vendor1=abc,vendor2=def"));
        assert!(!ctx.dropped.tracestate_truncated);
    }

    #[test]
    fn oversized_tracestate_is_truncated_and_recorded() {
        // 40 small members > the 32-member limit.
        let members: Vec<String> = (0..40).map(|i| format!("v{i}=x")).collect();
        let meta = serde_json::json!({
            "traceparent": SEP414_TP,
            "tracestate": members.join(","),
        });
        let ctx = extract_from_meta(&meta).expect("valid");
        let kept = ctx.tracestate.expect("some survive");
        assert!(kept.split(',').count() <= TRACESTATE_MAX_MEMBERS);
        assert!(ctx.dropped.tracestate_truncated);
        assert!(ctx.dropped.tracestate_members_dropped >= 8);
    }

    #[test]
    fn overlong_tracestate_entry_dropped_first() {
        let long = format!("big={}", "a".repeat(200)); // > 128 chars
        let meta = serde_json::json!({
            "traceparent": SEP414_TP,
            "tracestate": format!("keep=1,{long},keep2=2"),
        });
        let ctx = extract_from_meta(&meta).expect("valid");
        let kept = ctx.tracestate.expect("some survive");
        assert!(!kept.contains("big="), "over-long entry dropped first");
        assert!(kept.contains("keep=1") && kept.contains("keep2=2"));
        assert!(ctx.dropped.tracestate_truncated);
    }

    #[test]
    fn combined_length_cap_enforced() {
        // 10 members of ~80 chars each = ~800 chars > 512 limit, none individually
        // over 128, so length-capping (not per-entry) must kick in.
        let members: Vec<String> = (0..10)
            .map(|i| format!("v{i}={}", "a".repeat(76)))
            .collect();
        let meta = serde_json::json!({
            "traceparent": SEP414_TP,
            "tracestate": members.join(","),
        });
        let ctx = extract_from_meta(&meta).expect("valid");
        let kept = ctx.tracestate.expect("some survive");
        assert!(kept.len() <= TRACESTATE_MAX_LEN);
        assert!(ctx.dropped.tracestate_truncated);
    }
}
