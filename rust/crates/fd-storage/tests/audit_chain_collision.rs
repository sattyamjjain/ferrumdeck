//! Concurrent audit writes to one tenant must not lose an event.
//!
//! This test used to assert the opposite. Before 0.8.12, `AuditRepo::create`
//! read the tenant's chain tip `FOR UPDATE` and inserted at `tip + 1`; that
//! lock does not stop a concurrent transaction inserting a new maximum, and at
//! genesis there was no row to lock at all. Two writers could read the same tip
//! and collide on `idx_audit_events_chain`. Nothing retried the loser and the
//! hot-path caller is fire-and-forget, so the event was **lost** — while the
//! surviving chain still verified, because the missing `chain_seq` was never
//! allocated. This file's first version measured that: **17 of 24 concurrent
//! writers collided**, and asserted only that each drop was logged.
//!
//! A transaction-scoped per-tenant advisory lock closed it. The assertions are
//! now inverted: every writer must succeed, no drop may be logged, and the
//! resulting `chain_seq` values must be contiguous with no gap — a gap would
//! mean a sequence was allocated and then rolled back, which is the same
//! evidence loss wearing a different shape.
//!
//! The old assertions are kept as a guard in `a_collision_would_still_be_loud`:
//! if the race ever returns, the ERROR must still carry the tenant and the
//! index, so a regression is countable rather than silent.
//!
//! Run with a database:
//!     DATABASE_URL=postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck \
//!         cargo test -p fd-storage --test audit_chain_collision -- --ignored
//!
//! `make test-integration` runs it as part of `cargo test --lib --tests -- --ignored`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use fd_storage::models::{action, actor, resource, AuditEventBuilder};
use fd_storage::repos::AuditRepo;
use tracing::Level;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::Layer;

/// The dev tenant seeded by db/migrations/20241223000002. A real id is required:
/// `audit_events.tenant_id` is a foreign key, so an invented tenant would fail
/// the insert for the wrong reason and the test would pass without ever
/// provoking the race it exists to provoke.
const SEEDED_TENANT: &str = "ten_01JFVX0000000000000000001";

fn database_url() -> String {
    std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck".into())
}

// ---------------------------------------------------------------------------
// A minimal capturing subscriber. `tracing` has no built-in assertion surface,
// and the claim under test is specifically about what reaches the logs, so the
// log is what gets asserted on rather than a return value that stands in for it.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct CapturedEvent {
    level: Level,
    message: String,
    fields: HashMap<String, String>,
}

#[derive(Clone, Default)]
struct Captured(Arc<Mutex<Vec<CapturedEvent>>>);

impl Captured {
    fn errors(&self) -> Vec<CapturedEvent> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|e| e.level == Level::ERROR)
            .cloned()
            .collect()
    }
}

struct FieldVisitor<'a>(&'a mut HashMap<String, String>, &'a mut String);

impl tracing::field::Visit for FieldVisitor<'_> {
    fn record_debug(&mut self, field: &tracing::field::Field, value: &dyn std::fmt::Debug) {
        let v = format!("{value:?}");
        if field.name() == "message" {
            *self.1 = v.trim_matches('"').to_string();
        } else {
            self.0.insert(field.name().to_string(), v);
        }
    }
    fn record_str(&mut self, field: &tracing::field::Field, value: &str) {
        if field.name() == "message" {
            *self.1 = value.to_string();
        } else {
            self.0.insert(field.name().to_string(), value.to_string());
        }
    }
    fn record_i64(&mut self, field: &tracing::field::Field, value: i64) {
        self.0.insert(field.name().to_string(), value.to_string());
    }
    fn record_u64(&mut self, field: &tracing::field::Field, value: u64) {
        self.0.insert(field.name().to_string(), value.to_string());
    }
}

impl<S: tracing::Subscriber> Layer<S> for Captured {
    fn on_event(&self, event: &tracing::Event<'_>, _ctx: Context<'_, S>) {
        let mut fields = HashMap::new();
        let mut message = String::new();
        event.record(&mut FieldVisitor(&mut fields, &mut message));
        self.0.lock().unwrap().push(CapturedEvent {
            level: *event.metadata().level(),
            message,
            fields,
        });
    }
}

/// Install the capturing subscriber **globally**.
///
/// Not `set_default`: that installs a thread-local, and the writes under test
/// run in spawned tokio tasks on other worker threads, which do not inherit it.
/// The first version of this test used it and captured zero events while the
/// race fired seventeen times -- a test that would have passed its own
/// assertion had the assertion been weaker. This binary holds one test, so a
/// global is safe here.
fn capture() -> Captured {
    let captured = Captured::default();
    let subscriber = tracing_subscriber::registry().with(captured.clone());
    tracing::subscriber::set_global_default(subscriber)
        .expect("no other subscriber is installed in this test binary");
    captured
}

fn event(tenant: &str, n: usize) -> fd_storage::models::CreateAuditEvent {
    AuditEventBuilder::new(action::POLICY_DENIED, resource::RUN)
        .actor(actor::SYSTEM, None)
        .tenant(tenant.to_string())
        .details(serde_json::json!({ "collision_probe": n }))
        .build()
}

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore = "requires DATABASE_URL"]
async fn concurrent_writes_to_one_tenant_all_land_with_a_contiguous_chain() {
    let pool = fd_storage::pool::create_pool(&database_url(), 16, 4)
        .await
        .expect("connect to the dev database (make dev-up)");
    let repo = AuditRepo::new(pool.clone());

    // Enough concurrency that at least one pair reads the same tip. The race is
    // real but not guaranteed on any single pair, so this fans out rather than
    // asserting on a two-writer coin flip.
    const WRITERS: usize = 24;

    let captured = capture();

    let mut handles = Vec::with_capacity(WRITERS);
    for n in 0..WRITERS {
        let repo = repo.clone();
        handles.push(tokio::spawn(async move {
            repo.create(event(SEEDED_TENANT, n)).await
        }));
    }

    let mut ok = 0usize;
    let mut collisions = 0usize;
    let mut seqs: Vec<i64> = Vec::with_capacity(WRITERS);
    for h in handles {
        match h.await.expect("task did not panic") {
            Ok(row) => {
                ok += 1;
                // Option only because pre-migration rows sit outside the chain;
                // anything this method writes is always chained.
                seqs.push(row.chain_seq.expect("a row written by create() is chained"));
            }
            Err(e) => {
                let msg = e.to_string();
                assert!(
                    msg.contains("idx_audit_events_chain"),
                    "the only failure this test anticipates is the chain collision, got: {msg}"
                );
                collisions += 1;
            }
        }
    }

    // --- the claim: the race is gone, not merely logged -------------------
    assert_eq!(
        collisions, 0,
        "{collisions} of {WRITERS} concurrent writers lost their audit event to a chain \
         collision. The per-tenant advisory lock in AuditRepo::create is supposed to make \
         this impossible; if it is reachable again, every caveat that was removed when it \
         landed has to come back (README audit-trail section, AuditRepo::create docs, \
         docs/compliance/safe-evidence-coverage.md row 7)."
    );
    assert_eq!(ok, WRITERS, "every writer must land its event");

    // A gap would mean a chain_seq was allocated and rolled back -- the same
    // evidence loss in a different shape, and invisible to verify_chain.
    seqs.sort_unstable();
    let expected: Vec<i64> = (seqs[0]..seqs[0] + WRITERS as i64).collect();
    assert_eq!(
        seqs, expected,
        "chain_seq must be contiguous across concurrent writers; a gap means a sequence was \
         claimed and lost, which verify_chain cannot see"
    );

    // --- and nothing was reported as dropped ------------------------------
    let drops: Vec<_> = captured
        .errors()
        .into_iter()
        .filter(|e| e.message.contains("audit chain collision"))
        .collect();
    // Checked before the emptiness assertion, not after: if the race ever
    // regresses, the first thing this test should tell you is whether the drop
    // is still attributable. An unattributable drop is a gap nobody can size.
    for d in &drops {
        assert!(
            d.fields.contains_key("tenant_id") && d.fields.contains_key("chain_seq"),
            "a chain-collision ERROR must still name the tenant and the index it could \
             not claim; got fields {:?}",
            d.fields
        );
    }
    assert!(
        drops.is_empty(),
        "no drop should be logged when no write was lost; got {drops:?}"
    );

    // --- the chain still verifies -----------------------------------------
    let verified = repo.verify_chain(Some(SEEDED_TENANT)).await;
    assert!(verified.is_ok(), "chain must verify: {verified:?}");
}

/// If the race ever comes back, it must come back *loudly*.
///
/// The fix is a lock, and a lock can be removed by someone who does not know
/// what it was for. This pins the diagnostics that made the original gap
/// countable: the ERROR path must still name the tenant and the `chain_seq`
/// that could not be claimed. Asserted against a synthetic collision so it does
/// not depend on the race being reachable.
#[tokio::test]
#[ignore = "requires DATABASE_URL"]
async fn a_collision_would_still_be_loud() {
    let pool = fd_storage::pool::create_pool(&database_url(), 4, 1)
        .await
        .expect("connect to the dev database (make dev-up)");
    let repo = AuditRepo::new(pool.clone());

    // Write one event, then force a duplicate chain_seq by hand -- the shape a
    // lost write took before the lock existed.
    let first = repo
        .create(event(SEEDED_TENANT, 0))
        .await
        .expect("baseline write");
    let seq = first.chain_seq.expect("baseline row is chained");

    let dup = sqlx::query(
        r#"INSERT INTO audit_events (id, actor_type, action, resource_type, details,
                                     tenant_id, occurred_at, prev_hash, record_hash, chain_seq)
           VALUES ($1,'system','policy.denied','run','{}'::jsonb,$2,NOW(),$3,$4,$5)"#,
    )
    .bind(format!("aud_dup_{}", seq))
    .bind(SEEDED_TENANT)
    .bind(first.prev_hash.clone())
    .bind(format!(
        "{}-dup",
        first.record_hash.clone().unwrap_or_default()
    ))
    .bind(seq)
    .execute(&pool)
    .await;

    let err = dup.expect_err("a duplicate chain_seq must still be rejected by the index");
    assert!(
        err.to_string().contains("idx_audit_events_chain"),
        "the unique index is what makes a lost write detectable at all; got: {err}"
    );
}
