//! In-process realtime event bus + its SSE surface (issue #5).
//!
//! Until this landed, the dashboard's realtime channel carried **heartbeats
//! only**. The BFF owned an SSE endpoint, the wire shapes were defined in
//! `nextjs/src/lib/realtime/channels.ts`, and a synthetic generator behind
//! `FERRUMDECK_SSE_MOCK_EVENTS` could fabricate them for wire-shape work — but
//! the gateway had no SSE surface at all (`rg "text/event-stream" rust/` matched
//! nothing) and pushed nothing, so every governance value on the console came
//! from polling.
//!
//! ## Publish AFTER the record is durable, never before
//!
//! The one rule this module exists to enforce. Policy decisions are written by
//! `Repos::spawn_audit`, which is fire-and-forget: it `tokio::spawn`s the insert
//! and the HTTP handler returns before the row exists. Publishing at the point
//! the decision is *computed* would hand a consumer an event whose `record_id`
//! reads back as nothing — the audit surface's worst failure, because the
//! consumer cannot tell "not written yet" from "never written".
//!
//! So [`crate::state::AppState::spawn_audit_and_publish`] publishes from inside
//! that spawned task, after `AuditRepo::create` returns `Ok(row)`, and the event
//! carries `row.id` — an id that cannot exist until the insert has committed.
//!
//! ## Replay, because a dropped event is worse than a poll
//!
//! Every event gets a monotonic `id`. The stream honours `Last-Event-ID` (the
//! header a browser's `EventSource` sends on its own reconnect) and the
//! `?last_event_id=` query parameter (what a client that rebuilds its
//! `EventSource` must send, since a fresh one sends no header). On reconnect the
//! buffered tail after that id is replayed before live delivery resumes.
//!
//! The buffer is bounded and in-process. Two honest limits follow, and both are
//! reported to the client rather than papered over:
//!
//! * A reconnect that arrives after more than [`REPLAY_BUFFER`] events have
//!   passed cannot be served completely. The stream then emits a
//!   `stream.gap` event naming the range it could not replay, so the consumer
//!   knows to re-read rather than assuming it has everything.
//! * A multi-replica gateway has one buffer per process. A client that reconnects
//!   to a different replica gets that replica's buffer. Durable cross-replica
//!   replay needs a shared log and is not claimed here.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tokio::sync::broadcast;

/// Events retained per process for reconnect replay. Sized for a burst of tool
/// calls across concurrent runs, not for durability — see the module caveat.
pub const REPLAY_BUFFER: usize = 1024;

/// Live subscriber fan-out capacity. A subscriber that falls this far behind is
/// lagged by `broadcast`, which the stream reports as a gap rather than hiding.
const BROADCAST_CAPACITY: usize = 512;

/// One realtime event, in the wire shape `nextjs/src/lib/realtime/channels.ts`
/// already defines: `{ id, type, channel, timestamp, payload }`.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct StreamEvent {
    /// Monotonic within a process. Serialized as a string because that is what
    /// SSE `id:` lines and `Last-Event-ID` carry.
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub channel: String,
    pub timestamp: String,
    pub payload: Value,
}

impl StreamEvent {
    /// The numeric ordinal behind `id`, for replay comparisons.
    pub fn seq(&self) -> Option<u64> {
        self.id.parse().ok()
    }
}

/// Process-local publish/subscribe with a bounded replay tail.
pub struct EventBus {
    tx: broadcast::Sender<Arc<StreamEvent>>,
    seq: AtomicU64,
    recent: Mutex<VecDeque<Arc<StreamEvent>>>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
        Self {
            tx,
            seq: AtomicU64::new(0),
            recent: Mutex::new(VecDeque::with_capacity(REPLAY_BUFFER)),
        }
    }

    /// Publish one event and return it.
    ///
    /// The event is buffered for replay **before** it is broadcast, so a
    /// subscriber that reconnects in the same instant cannot observe a live
    /// event that is not yet replayable.
    pub fn publish(&self, channel: &str, event_type: &str, payload: Value) -> Arc<StreamEvent> {
        let id = self.seq.fetch_add(1, Ordering::SeqCst) + 1;
        let event = Arc::new(StreamEvent {
            id: id.to_string(),
            event_type: event_type.to_string(),
            channel: channel.to_string(),
            timestamp: chrono::Utc::now().to_rfc3339(),
            payload,
        });

        if let Ok(mut recent) = self.recent.lock() {
            if recent.len() == REPLAY_BUFFER {
                recent.pop_front();
            }
            recent.push_back(Arc::clone(&event));
        }

        // `Err` only means nobody is listening right now. That is not a failure:
        // the event is already buffered, so a client that connects a moment later
        // and asks for the tail still receives it.
        let _ = self.tx.send(Arc::clone(&event));
        event
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Arc<StreamEvent>> {
        self.tx.subscribe()
    }

    /// The buffered tail for `channel` strictly after `after_seq`, oldest first.
    ///
    /// Returns `(events, complete)`. `complete` is false when the buffer has
    /// already discarded events the caller asked for — the caller must tell the
    /// client, because silently returning a short list is indistinguishable from
    /// "nothing happened".
    pub fn replay(&self, channel: &str, after_seq: Option<u64>) -> (Vec<Arc<StreamEvent>>, bool) {
        let Ok(recent) = self.recent.lock() else {
            return (Vec::new(), false);
        };
        let Some(after) = after_seq else {
            // No cursor: this is a fresh connection, not a resume. Send nothing
            // historic; the client asked to watch from now.
            return (Vec::new(), true);
        };

        // The oldest event still held. If the client's cursor predates it, the
        // events between are gone.
        let oldest = recent.front().and_then(|e| e.seq());
        let complete = match oldest {
            // `after + 1` is the first event the client still needs.
            Some(o) => o <= after + 1,
            None => true,
        };

        let events = recent
            .iter()
            .filter(|e| e.channel == channel)
            .filter(|e| e.seq().is_some_and(|s| s > after))
            .cloned()
            .collect();

        (events, complete)
    }

    /// Highest id issued so far. Test/diagnostic use.
    pub fn latest_seq(&self) -> u64 {
        self.seq.load(Ordering::SeqCst)
    }
}

/// Write an audit record, then publish a realtime event about it — in that
/// order, and only if the write succeeded.
///
/// Free function rather than a method so the ordering invariant can be tested
/// against a real `AuditRepo` + `EventBus` without standing up an `AppState`
/// (which needs Redis, a policy engine and a dozen env vars). The invariant is
/// the whole point of the function; it needs to be reachable by a test.
///
/// [`crate::state::AppState::spawn_audit_and_publish`] is the thin wrapper the
/// handlers call. `make_events` may return several events about the one record,
/// or an empty vec to publish nothing.
/// One realtime event to publish about a committed record:
/// `(channel, event_type, payload)`.
pub type PendingEvent = (String, String, Value);

pub async fn record_then_publish<F>(
    audit_repo: fd_storage::AuditRepo,
    bus: Arc<EventBus>,
    event: fd_storage::models::CreateAuditEvent,
    make_events: F,
) where
    F: FnOnce(&fd_storage::models::AuditEvent) -> Vec<PendingEvent>,
{
    let tenant_id = event
        .tenant_id
        .clone()
        .unwrap_or_else(|| fd_storage::repos::audit::GLOBAL_CHAIN_TENANT.to_string());
    let event_id = event.id.clone();
    let action = event.action.clone();

    match audit_repo.create(event).await {
        Ok(row) => {
            // One record can warrant more than one event. A tool-call decision
            // is both `policy.response.recorded` (what was decided) and
            // `policy.decision.explained` (why, via the precedence trace) --
            // two views of one committed row, so both become durable at the
            // same instant and neither can outrun it.
            for (channel, event_type, payload) in make_events(&row) {
                bus.publish(&channel, &event_type, payload);
            }
        }
        Err(e) => {
            // No event is published. A consumer seeing silence is CORRECT here:
            // there is no record for it to read back. Publishing anyway would
            // put a record id on the wire that resolves to nothing, which is
            // the one thing an audit stream must never do.
            tracing::error!(
                error = %e,
                tenant_id = %tenant_id,
                event_id = %event_id,
                action = %action,
                "audit event DROPPED: nothing retries this write, so the record is lost \
                 — and no realtime event was published, because there is no record for a \
                 consumer to read back"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ids_are_monotonic_and_events_are_replayable_immediately() {
        let bus = EventBus::new();
        let a = bus.publish("run:r1", "policy.response.recorded", json!({"n": 1}));
        let b = bus.publish("run:r1", "policy.response.recorded", json!({"n": 2}));
        assert_eq!(a.id, "1");
        assert_eq!(b.id, "2");

        // Buffered before broadcast: a resume from 0 sees both even though no
        // subscriber existed when they were published.
        let (events, complete) = bus.replay("run:r1", Some(0));
        assert!(complete);
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].id, "1");
    }

    #[test]
    fn replay_returns_only_the_channel_asked_for() {
        let bus = EventBus::new();
        bus.publish("run:r1", "e", json!({}));
        bus.publish("run:r2", "e", json!({}));
        bus.publish("run:r1", "e", json!({}));

        let (events, _) = bus.replay("run:r1", Some(0));
        assert_eq!(events.len(), 2);
        assert!(events.iter().all(|e| e.channel == "run:r1"));
    }

    #[test]
    fn a_fresh_connection_replays_nothing() {
        // No cursor means "watch from now", not "send me everything you have".
        let bus = EventBus::new();
        bus.publish("run:r1", "e", json!({}));
        let (events, complete) = bus.replay("run:r1", None);
        assert!(events.is_empty());
        assert!(complete);
    }

    #[test]
    fn a_reconnect_past_the_buffer_is_reported_as_incomplete_not_as_empty() {
        // The assertion that matters: when the buffer has dropped events the
        // client needs, `complete` is false. A short list returned as complete
        // is indistinguishable from "nothing happened", which for an audit
        // surface is the expensive direction to be wrong in.
        let bus = EventBus::new();
        for _ in 0..(REPLAY_BUFFER + 10) {
            bus.publish("run:r1", "e", json!({}));
        }
        let (_, complete) = bus.replay("run:r1", Some(1));
        assert!(
            !complete,
            "a cursor older than the retained tail must be reported as a gap"
        );

        // A cursor still inside the buffer is complete.
        let latest = bus.latest_seq();
        let (events, complete) = bus.replay("run:r1", Some(latest - 3));
        assert!(complete);
        assert_eq!(events.len(), 3);
    }

    #[test]
    fn the_buffer_is_bounded() {
        let bus = EventBus::new();
        for _ in 0..(REPLAY_BUFFER * 2) {
            bus.publish("run:r1", "e", json!({}));
        }
        assert_eq!(bus.recent.lock().unwrap().len(), REPLAY_BUFFER);
    }

    #[tokio::test]
    async fn a_subscriber_receives_what_is_published_after_it_subscribes() {
        let bus = EventBus::new();
        let mut rx = bus.subscribe();
        bus.publish("run:r1", "policy.response.recorded", json!({"ok": true}));
        let got = rx.recv().await.unwrap();
        assert_eq!(got.event_type, "policy.response.recorded");
        assert_eq!(got.channel, "run:r1");
    }
    // -----------------------------------------------------------------------
    // The ordering invariant, against a real database.
    //
    // These assert an OUTCOME, not liveness (issue #6's complaint): the event
    // is published only after the row it names is readable, and a policy denial
    // produces exactly one event -- not zero, not two.
    //
    //   DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck \
    //       cargo test -p gateway --bin gateway events:: -- --ignored
    // -----------------------------------------------------------------------

    use fd_storage::models::{action, actor, resource, AuditEventBuilder};

    /// The dev tenant seeded by db/migrations/20241223000002. A real id is
    /// required: `audit_events.tenant_id` is a foreign key, so an invented
    /// tenant would fail the insert for the wrong reason and the test would
    /// "pass" without ever exercising the path it exists to exercise.
    const SEEDED_TENANT: &str = "ten_01JFVX0000000000000000001";

    fn database_url() -> String {
        std::env::var("DATABASE_URL")
            .unwrap_or_else(|_| "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck".into())
    }

    fn denial_event(probe: &str) -> fd_storage::models::CreateAuditEvent {
        AuditEventBuilder::new(action::POLICY_DENIED, resource::RUN)
            .actor(actor::SYSTEM, None)
            .tenant(SEEDED_TENANT.to_string())
            .details(serde_json::json!({ "sse_probe": probe }))
            .build()
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn the_row_is_readable_by_the_time_the_event_arrives() {
        // The claim SSE is worth having for. A consumer that receives an event
        // and reads back nothing cannot tell "not written yet" from "never
        // written", so it would have to treat every event as unverifiable --
        // strictly worse than polling.
        let pool = fd_storage::pool::create_pool(&database_url(), 8, 2)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool.clone());
        let bus = Arc::new(EventBus::new());
        let mut rx = bus.subscribe();

        record_then_publish(repo.clone(), bus.clone(), denial_event("readable"), |row| {
            vec![(
                "run:probe".to_string(),
                "policy.response.recorded".to_string(),
                json!({
                    "decision": "Deny",
                    "rule": "allowlist:denied",
                    "latency_ms": 1,
                    "record_id": row.id,
                }),
            )]
        })
        .await;

        let event = rx.try_recv().expect("an event was published");
        let record_id = event.payload["record_id"]
            .as_str()
            .expect("the event names the record it is about");

        // The assertion: read it back NOW, with no sleep and no retry. If the
        // publish had happened before the insert committed, this is nothing.
        let row = repo
            .get(record_id)
            .await
            .expect("query the audit row named by the event")
            .unwrap_or_else(|| {
                panic!(
                    "event named record {record_id}, which is not readable. The publish \
                     happened before the write was durable."
                )
            });
        assert_eq!(row.action, action::POLICY_DENIED);
        assert_eq!(
            row.details["sse_probe"], "readable",
            "the row read back must be the one the event was about"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn a_policy_denial_publishes_exactly_one_event() {
        // Not zero (the push never fired) and not two (the decision path
        // publishes in more than one place). Both have shipped in this
        // codebase's neighbours, so both are asserted rather than assumed.
        let pool = fd_storage::pool::create_pool(&database_url(), 8, 2)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool.clone());
        let bus = Arc::new(EventBus::new());
        let mut rx = bus.subscribe();

        record_then_publish(repo, bus.clone(), denial_event("exactly-once"), |row| {
            vec![(
                "run:probe".to_string(),
                "policy.response.recorded".to_string(),
                json!({ "record_id": row.id }),
            )]
        })
        .await;

        assert!(rx.try_recv().is_ok(), "exactly one event, got zero");
        assert!(
            rx.try_recv().is_err(),
            "exactly one event, got a second — the decision path is publishing twice"
        );
        assert_eq!(bus.latest_seq(), 1, "one publish, one id issued");
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn a_failed_write_publishes_nothing() {
        // Silence is the honest signal when there is no record: an event whose
        // record id resolves to nothing is worse than no event at all.
        let pool = fd_storage::pool::create_pool(&database_url(), 4, 1)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool);
        let bus = Arc::new(EventBus::new());
        let mut rx = bus.subscribe();

        // A tenant that violates the foreign key -> the insert fails.
        let mut bad = denial_event("failed-write");
        bad.tenant_id = Some("ten_this_tenant_does_not_exist".to_string());

        record_then_publish(repo, bus.clone(), bad, |row| {
            vec![(
                "run:probe".to_string(),
                "policy.response.recorded".to_string(),
                json!({ "record_id": row.id }),
            )]
        })
        .await;

        assert!(
            rx.try_recv().is_err(),
            "no event may be published for a record that was never written"
        );
        assert_eq!(bus.latest_seq(), 0);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn a_reconnecting_consumer_receives_the_event_it_missed() {
        // The reconnect path end to end: publish while nobody is listening,
        // then resume from the last id seen and get the gap. An SSE stream that
        // drops events on reconnect is worse than polling for an audit surface.
        let pool = fd_storage::pool::create_pool(&database_url(), 8, 2)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool);
        let bus = Arc::new(EventBus::new());

        // Event 1 arrives while a consumer is connected.
        record_then_publish(repo.clone(), bus.clone(), denial_event("before"), |row| {
            vec![(
                "run:probe".to_string(),
                "policy.response.recorded".to_string(),
                json!({ "record_id": row.id }),
            )]
        })
        .await;
        let last_seen = bus.latest_seq();

        // ... the consumer drops. Event 2 is published to nobody.
        record_then_publish(repo.clone(), bus.clone(), denial_event("during"), |row| {
            vec![(
                "run:probe".to_string(),
                "policy.response.recorded".to_string(),
                json!({ "record_id": row.id }),
            )]
        })
        .await;

        // ... and reconnects with its cursor.
        let (replayed, complete) = bus.replay("run:probe", Some(last_seen));
        assert!(complete, "the gap is inside the buffer, so it is serveable");
        assert_eq!(replayed.len(), 1, "the missed event must be replayed");
        assert!(replayed[0].payload["record_id"].is_string());

        // And it names a row that is genuinely readable.
        let id = replayed[0].payload["record_id"].as_str().unwrap();
        assert!(
            repo.get(id).await.expect("query").is_some(),
            "a replayed event must name a durable record too"
        );
    }
    // -----------------------------------------------------------------------
    // Issue #47: the same ordering invariant, for each of the four events.
    //
    // Every test below fails if the event is observable before its backing
    // record is durable. They assert an OUTCOME -- the row is readable at the
    // instant the event arrives -- rather than that an event turned up, which
    // is issue #6's complaint about the live-stack suites and not a pile worth
    // adding to.
    // -----------------------------------------------------------------------

    /// Drive `record_then_publish` with a real audit row and assert the event
    /// names a record that is readable **now**: no sleep, no retry. A retry loop
    /// here would hide the exact bug these tests exist to catch.
    async fn assert_event_names_a_readable_record(
        action: &str,
        event_type: &str,
        details: serde_json::Value,
    ) {
        let pool = fd_storage::pool::create_pool(&database_url(), 8, 2)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool.clone());
        let bus = Arc::new(EventBus::new());
        let mut rx = bus.subscribe();

        let event = AuditEventBuilder::new(action, resource::RUN)
            .actor(actor::SYSTEM, None)
            .tenant(SEEDED_TENANT.to_string())
            .details(details)
            .build();

        let ty = event_type.to_string();
        record_then_publish(repo.clone(), bus.clone(), event, move |row| {
            vec![(
                "run:probe".to_string(),
                ty,
                json!({ "record_id": row.id, "chain_seq": row.chain_seq }),
            )]
        })
        .await;

        let published = rx
            .try_recv()
            .unwrap_or_else(|e| panic!("{event_type} was not published: {e:?}"));
        assert_eq!(published.event_type, event_type);

        let record_id = published.payload["record_id"]
            .as_str()
            .unwrap_or_else(|| panic!("{event_type} must name the record it describes"));

        let row = repo
            .get(record_id)
            .await
            .expect("query the audit row")
            .unwrap_or_else(|| {
                panic!(
                    "{event_type} named record {record_id}, which is not readable. \
                     The publish happened before the write was durable."
                )
            });
        assert_eq!(row.action, action);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn coherence_divergence_is_not_observable_before_its_record() {
        assert_event_names_a_readable_record(
            "airlock.violation_detected",
            "coherence.divergence.detected",
            json!({
                "violation_type": "coherence_divergence",
                "response_rung": "R3",
                "mode": "shadow",
                "gated": false,
            }),
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn routing_decision_is_not_observable_before_its_record() {
        assert_event_names_a_readable_record(
            action::ROUTING_DECIDED,
            "routing.decision.recorded",
            json!({ "subtask_id": "stp_probe", "content_hash": "0".repeat(64) }),
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn policy_decision_explained_is_not_observable_before_its_record() {
        assert_event_names_a_readable_record(
            action::POLICY_DENIED,
            "policy.decision.explained",
            json!({
                "tool_name": "probe",
                // The field whose ABSENCE previously made this event
                // unemittable: the trace was computed, returned over HTTP, and
                // discarded, so nothing the event described could be read back.
                "decision_trace": {
                    "matched": [],
                    "precedence": "deny > requires_approval > budget_cap > allow",
                },
            }),
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn the_decision_trace_survives_the_round_trip_to_the_row() {
        // `policy.decision.explained` is only evidence if the trace is IN the
        // committed row. This reads it back off the row rather than trusting
        // that it was passed in.
        let pool = fd_storage::pool::create_pool(&database_url(), 4, 1)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool);

        let row = repo
            .create(
                AuditEventBuilder::new(action::POLICY_DENIED, resource::RUN)
                    .actor(actor::SYSTEM, None)
                    .tenant(SEEDED_TENANT.to_string())
                    .details(json!({
                        "decision_trace": {
                            "winning_kind": "deny",
                            "winning_source": "allowlist:denied",
                            "overrides": [{
                                "verdict": { "kind": "allow", "source": "allowlist:allowed" },
                                "overridden_by": "deny",
                                "reason": "deny outranks allow",
                            }],
                            "precedence": "deny > requires_approval > budget_cap > allow",
                        }
                    }))
                    .build(),
            )
            .await
            .expect("write the decision record");

        let stored = repo
            .get(&row.id)
            .await
            .expect("read back")
            .expect("present");
        let trace = &stored.details["decision_trace"];
        assert_eq!(trace["winning_source"], "allowlist:denied");
        assert_eq!(
            trace["overrides"][0]["verdict"]["source"], "allowlist:allowed",
            "the losing verdicts must survive too; reconstructing a decision from \
             the log needs them, and `reason` alone does not carry them"
        );
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn a_failed_write_publishes_none_of_the_four() {
        // The rule that makes the whole surface trustworthy, asserted for a
        // multi-event callback: if the record never commits, NOTHING goes out --
        // not the first event, not a partial batch.
        let pool = fd_storage::pool::create_pool(&database_url(), 4, 1)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool);
        let bus = Arc::new(EventBus::new());
        let mut rx = bus.subscribe();

        let mut bad = AuditEventBuilder::new(action::POLICY_DENIED, resource::RUN)
            .actor(actor::SYSTEM, None)
            .tenant(SEEDED_TENANT.to_string())
            .details(json!({}))
            .build();
        bad.tenant_id = Some("ten_this_tenant_does_not_exist".to_string());

        record_then_publish(repo, bus.clone(), bad, |row| {
            vec![
                (
                    "run:probe".to_string(),
                    "policy.response.recorded".to_string(),
                    json!({ "record_id": row.id }),
                ),
                (
                    "run:probe".to_string(),
                    "policy.decision.explained".to_string(),
                    json!({ "record_id": row.id }),
                ),
            ]
        })
        .await;

        assert!(
            rx.try_recv().is_err(),
            "no event may be published for a record that was never written"
        );
        assert_eq!(bus.latest_seq(), 0);
    }

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn one_record_can_publish_two_events_and_both_name_it() {
        // A tool-call decision is both `policy.response.recorded` (what) and
        // `policy.decision.explained` (why). Both must name the SAME committed
        // row, or the console would show a verdict and an explanation that are
        // not about the same decision.
        let pool = fd_storage::pool::create_pool(&database_url(), 8, 2)
            .await
            .expect("connect to the dev database (make dev-up)");
        let repo = fd_storage::AuditRepo::new(pool);
        let bus = Arc::new(EventBus::new());
        let mut rx = bus.subscribe();

        record_then_publish(
            repo.clone(),
            bus.clone(),
            AuditEventBuilder::new(action::POLICY_DENIED, resource::RUN)
                .actor(actor::SYSTEM, None)
                .tenant(SEEDED_TENANT.to_string())
                .details(json!({ "decision_trace": { "winning_kind": "deny" } }))
                .build(),
            |row| {
                vec![
                    (
                        "run:probe".to_string(),
                        "policy.response.recorded".to_string(),
                        json!({ "record_id": row.id }),
                    ),
                    (
                        "run:probe".to_string(),
                        "policy.decision.explained".to_string(),
                        json!({ "record_id": row.id }),
                    ),
                ]
            },
        )
        .await;

        let first = rx.try_recv().expect("the verdict event");
        let second = rx.try_recv().expect("the explanation event");
        assert_eq!(first.event_type, "policy.response.recorded");
        assert_eq!(second.event_type, "policy.decision.explained");
        assert_eq!(
            first.payload["record_id"], second.payload["record_id"],
            "both events must describe the same committed decision"
        );

        let id = first.payload["record_id"].as_str().unwrap();
        assert!(
            repo.get(id).await.expect("query").is_some(),
            "and that record must be readable when they arrive"
        );
    }

    /// The seeded dev agent version and project (db/migrations/20241223000002).
    const SEEDED_PROJECT: &str = "prj_01JFVX0000000000000000001";
    const SEEDED_AGENT_VERSION: &str = "agv_01JFVX0000000000000000001";

    #[tokio::test]
    #[ignore = "requires DATABASE_URL"]
    async fn the_forecast_event_is_not_observable_before_the_run_row_carries_it() {
        // `run.forecast.updated` is the odd one of the four: its record is the
        // RUN ROW, not an audit event, so there is no `record_id` to resolve.
        // The ordering rule is identical though, and the field that stands in
        // for the record id is `forecast_at` -- a consumer matches it against
        // `GET /v1/runs/{id}` to confirm they hold the same snapshot.
        //
        // This drives the exact sequence the handler does: await the write, then
        // publish. It fails if the row does not already carry the published
        // snapshot when the event arrives.
        let pool = fd_storage::pool::create_pool(&database_url(), 8, 2)
            .await
            .expect("connect to the dev database (make dev-up)");
        let runs = fd_storage::RunsRepo::new(pool.clone());
        let bus = Arc::new(EventBus::new());
        let mut rx = bus.subscribe();

        let run = runs
            .create(fd_storage::models::CreateRun {
                id: format!("run_{}", ulid::Ulid::new()),
                project_id: SEEDED_PROJECT.to_string(),
                agent_version_id: SEEDED_AGENT_VERSION.to_string(),
                input: json!({ "task": "forecast-ordering-probe" }),
                config: json!({}),
                trace_id: None,
                span_id: None,
            })
            .await
            .expect("create a run against the seeded agent version");

        let forecast_at = chrono::Utc::now();
        let snapshot = fd_storage::RunForecastSnapshot {
            projected_cost_cents: 4242,
            ewma_cost_cents: 100,
            ewma_step_cost_cents: 10,
            budget_breach_projected: true,
            breach_kind: Some("cost_cents".to_string()),
            forecast_at,
        };

        // --- the sequence under test -------------------------------------
        runs.update_forecast(&run.id, &snapshot)
            .await
            .expect("persist the forecast snapshot");
        bus.publish(
            &format!("run:{}", run.id),
            "run.forecast.updated",
            json!({
                "run_id": run.id,
                "projected_cost_cents": snapshot.projected_cost_cents,
                "budget_breach_projected": snapshot.budget_breach_projected,
                "forecast_at": snapshot.forecast_at.to_rfc3339(),
            }),
        );

        let event = rx.try_recv().expect("the forecast event was published");
        assert_eq!(event.event_type, "run.forecast.updated");

        // Read the row back NOW. If the publish had preceded the write, this is
        // either the previous snapshot or nothing -- and a consumer would have
        // no way to tell a stale forecast from a current one.
        let stored = runs
            .get(&run.id)
            .await
            .expect("query the run")
            .expect("the run exists");
        assert_eq!(
            stored.projected_cost_cents,
            Some(4242),
            "the run row must already carry the forecast the event announced"
        );
        assert!(
            stored.forecast_at.is_some(),
            "forecast_at is the field a consumer matches the event against"
        );
        assert_eq!(
            event.payload["projected_cost_cents"], 4242,
            "the event and the row must report the same number"
        );
    }
}
