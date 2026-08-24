//! `GET /v1/events/{channel}` — the gateway's SSE surface (issue #5).
//!
//! See [`crate::events`] for the two invariants this endpoint exists to hold:
//! events are published only after the record they describe is durable, and a
//! reconnect that cannot be replayed completely says so instead of looking
//! quiet.

use std::convert::Infallible;
use std::time::Duration;

use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    Json,
};
use serde::Deserialize;
use serde_json::json;
use tokio_stream::{wrappers::BroadcastStream, Stream, StreamExt};

use crate::events::StreamEvent;
use crate::state::AppState;

/// Channel prefixes this endpoint serves, matching the BFF's `parseChannel`.
const VALID_CHANNEL_TYPES: [&str; 4] = ["runs", "run", "approvals", "audit"];

#[derive(Debug, Deserialize, Default)]
pub struct EventStreamParams {
    /// Resume cursor for a client that rebuilt its `EventSource`.
    ///
    /// A browser resends `Last-Event-ID` as a header only when the *browser*
    /// reconnects the same `EventSource`. Application-level reconnect logic that
    /// constructs a new one — which is what the dashboard's subscription manager
    /// does — sends no header at all, and `EventSource` cannot set one. So the
    /// cursor is accepted here as well, and the header wins when both arrive.
    pub last_event_id: Option<String>,
}

/// Parse a resume cursor. A malformed cursor is treated as absent rather than
/// rejected: refusing the connection would leave the client with no stream at
/// all, which is strictly worse than starting from now.
fn resume_from(headers: &HeaderMap, params: &EventStreamParams) -> Option<u64> {
    headers
        .get("last-event-id")
        .and_then(|v| v.to_str().ok())
        .or(params.last_event_id.as_deref())
        .and_then(|s| s.trim().parse::<u64>().ok())
}

fn sse_event(e: &StreamEvent) -> Event {
    // `serde_json::to_string` on a StreamEvent cannot fail (Value is always
    // serializable), but an unwrap in a stream would take the process down, so
    // it degrades to an error event the client can see instead.
    match serde_json::to_string(e) {
        Ok(data) => Event::default()
            .id(e.id.clone())
            .event("message")
            .data(data),
        Err(err) => Event::default().event("message").data(
            json!({
                "type": "stream.error",
                "channel": e.channel,
                "payload": { "message": err.to_string() }
            })
            .to_string(),
        ),
    }
}

/// `GET /v1/events/{channel}` — subscribe to a realtime channel.
///
/// Emits, in order:
/// 1. `stream.gap` — only when a resume cursor could not be fully served.
/// 2. the buffered tail after the cursor, if any.
/// 3. live events, until the client disconnects.
pub async fn event_stream(
    State(state): State<AppState>,
    Path(channel): Path<String>,
    Query(params): Query<EventStreamParams>,
    headers: HeaderMap,
) -> Response {
    let channel_type = channel.split(':').next().unwrap_or_default();
    if !VALID_CHANNEL_TYPES.contains(&channel_type) || !channel.contains(':') {
        return (
            axum::http::StatusCode::BAD_REQUEST,
            Json(json!({
                "error": {
                    "code": "INVALID_CHANNEL",
                    "message": format!(
                        "Channel must be `type:identifier` with type one of {VALID_CHANNEL_TYPES:?}; got {channel:?}"
                    )
                }
            })),
        )
            .into_response();
    }

    let bus = state.events.clone();
    let cursor = resume_from(&headers, &params);

    // Subscribe BEFORE reading the replay tail. The other order has a hole: an
    // event published between the read and the subscribe reaches neither, and
    // the client silently loses it — the failure mode that makes an SSE audit
    // stream worse than polling.
    let live = bus.subscribe();
    let (replayed, complete) = bus.replay(&channel, cursor);

    let mut preamble: Vec<Event> = Vec::with_capacity(replayed.len() + 2);

    // A `stream.connected` control frame, sent first and always.
    //
    // Not cosmetic. Subscription happens when the HTTP body starts flowing, and
    // until then a client has NO way to know it is attached — so anything
    // published in that window is delivered to nobody and, with no cursor to
    // replay from, is simply lost. A caller that must not miss the next event
    // (a test, or a console opened to watch a specific run) has to wait for a
    // signal, and before this there was none to wait for; the only options were
    // to sleep an arbitrary interval and hope, or to miss events.
    //
    // Deliberately carries NO `id:` line. It is a control frame, not a
    // governance event: giving it an id would advance the client's resume
    // cursor past a position that names no record.
    preamble.push(
        Event::default().event("message").data(
            json!({
                "type": "stream.connected",
                "channel": channel,
                "timestamp": chrono::Utc::now().to_rfc3339(),
                "payload": {
                    "channel": channel,
                    "resumed_from": cursor,
                    "replayed": replayed.len(),
                }
            })
            .to_string(),
        ),
    );

    if cursor.is_some() && !complete {
        // Say what could not be replayed. A client that receives this must
        // re-read the audit endpoint rather than assume it is caught up.
        preamble.push(
            Event::default().event("message").data(
                json!({
                    "type": "stream.gap",
                    "channel": channel,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                    "payload": {
                        "requested_after": cursor,
                        "message": "Events after the resume cursor are no longer buffered, so this stream is NOT complete. Re-read the audit endpoint for the missing range rather than treating the gap as quiet.",
                        "buffer_size": crate::events::REPLAY_BUFFER,
                    }
                })
                .to_string(),
            ),
        );
    }
    preamble.extend(replayed.iter().map(|e| sse_event(e)));

    let channel_for_live = channel.clone();
    let live_stream = BroadcastStream::new(live).filter_map(move |res| match res {
        Ok(e) if e.channel == channel_for_live => Some(Ok::<Event, Infallible>(sse_event(&e))),
        Ok(_) => None,
        // The subscriber fell behind the fan-out buffer. Same rule as a replay
        // gap: report it, never swallow it.
        Err(tokio_stream::wrappers::errors::BroadcastStreamRecvError::Lagged(n)) => {
            tracing::warn!(
                channel = %channel_for_live,
                skipped = n,
                "SSE subscriber lagged; reporting a gap to the client"
            );
            Some(Ok(Event::default().event("message").data(
                json!({
                    "type": "stream.gap",
                    "channel": channel_for_live,
                    "timestamp": chrono::Utc::now().to_rfc3339(),
                    "payload": {
                        "skipped": n,
                        "message": "This subscriber fell behind and events were dropped. The stream is NOT complete; re-read the audit endpoint for the gap."
                    }
                })
                .to_string(),
            )))
        }
    });

    let stream =
        tokio_stream::iter(preamble.into_iter().map(Ok::<Event, Infallible>)).chain(live_stream);

    sse_response(stream)
}

fn sse_response<S>(stream: S) -> Response
where
    S: Stream<Item = Result<Event, Infallible>> + Send + 'static,
{
    Sse::new(stream)
        .keep_alive(
            KeepAlive::new()
                .interval(Duration::from_secs(15))
                .text("keep-alive"),
        )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::HeaderValue;

    fn headers_with(id: &str) -> HeaderMap {
        let mut h = HeaderMap::new();
        h.insert("last-event-id", HeaderValue::from_str(id).unwrap());
        h
    }

    #[test]
    fn the_header_wins_over_the_query_parameter() {
        // Both can arrive: the browser resends the header on its own reconnect,
        // and the dashboard appends the parameter when it rebuilds the
        // EventSource. The header is the one the transport itself vouched for.
        let params = EventStreamParams {
            last_event_id: Some("5".into()),
        };
        assert_eq!(resume_from(&headers_with("9"), &params), Some(9));
    }

    #[test]
    fn the_query_parameter_is_honoured_when_no_header_is_sent() {
        // This is the path that matters in practice: a fresh `EventSource` sends
        // no `Last-Event-ID` header, and the API gives no way to add one, so
        // without this every application-level reconnect would restart from now
        // and drop the gap.
        let params = EventStreamParams {
            last_event_id: Some("42".into()),
        };
        assert_eq!(resume_from(&HeaderMap::new(), &params), Some(42));
    }

    #[test]
    fn a_malformed_cursor_starts_from_now_rather_than_refusing_the_stream() {
        let params = EventStreamParams {
            last_event_id: Some("not-a-number".into()),
        };
        assert_eq!(resume_from(&HeaderMap::new(), &params), None);
        assert_eq!(resume_from(&headers_with("¬"), &params), None);
    }

    #[test]
    fn no_cursor_at_all_is_none() {
        assert_eq!(
            resume_from(&HeaderMap::new(), &EventStreamParams::default()),
            None
        );
    }

    #[test]
    fn sse_event_carries_the_id_the_client_will_resume_from() {
        let e = StreamEvent {
            id: "7".into(),
            event_type: "policy.response.recorded".into(),
            channel: "run:r1".into(),
            timestamp: "2026-08-24T00:00:00Z".into(),
            payload: json!({"decision": "deny"}),
        };
        // Axum's Event has no getters, so assert on the wire bytes — which is
        // what the client actually parses anyway.
        let wire = format!("{:?}", sse_event(&e));
        assert!(wire.contains("id: 7"), "wire was: {wire}");
        assert!(wire.contains("policy.response.recorded"));
    }
}
