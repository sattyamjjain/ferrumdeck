//! Concurrent audit writes to one tenant collide, and the losing event is lost.
//!
//! This test does not fix that. It turns a *known* gap into a *tracked* one.
//!
//! `AuditRepo::create` reads the tenant's chain tip `FOR UPDATE` and inserts at
//! `tip + 1`. `FOR UPDATE` locks the row it found; it does not stop a concurrent
//! transaction inserting a new maximum, so two writers can read the same tip,
//! both compute the same `chain_seq`, and collide on `idx_audit_events_chain`.
//! At genesis there is no row to lock at all and the first two writes race
//! unconditionally.
//!
//! Nothing retries the loser. The caller on the hot path (`Repos::spawn_audit`)
//! is fire-and-forget, so the event is dropped. The surviving chain still
//! verifies — every remaining row links to its predecessor and no `chain_seq`
//! gap is left, because the sequence was never allocated. **A chain that
//! verifies is therefore not a chain that is complete**, and only the first of
//! those is claimed anywhere in this codebase.
//!
//! What this asserts is that the drop is *countable*: an ERROR carrying the
//! tenant and the `chain_seq` that could not be claimed. A silent drop and a
//! logged drop are the difference between a gap nobody can size and one an
//! operator can alert on.
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
async fn concurrent_writes_to_one_tenant_collide_and_the_drop_is_logged_with_tenant_and_index() {
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
    for h in handles {
        match h.await.expect("task did not panic") {
            Ok(_) => ok += 1,
            Err(e) => {
                let msg = e.to_string();
                assert!(
                    msg.contains("idx_audit_events_chain"),
                    "the only expected failure here is the chain collision, got: {msg}"
                );
                collisions += 1;
            }
        }
    }

    assert_eq!(ok + collisions, WRITERS);
    assert!(
        collisions > 0,
        "expected at least one chain collision across {WRITERS} concurrent writers, got none. \
         If this stops reproducing, the race may have been fixed -- in which case delete this \
         test and the caveats it backs (README audit-trail section, AuditRepo::create doc \
         comment, docs/compliance/safe-evidence-coverage.md) in the same commit."
    );

    // --- the claim under test: the drop is countable, not merely observable ---
    let errors = captured.errors();
    let drops: Vec<_> = errors
        .iter()
        .filter(|e| e.message.contains("audit chain collision"))
        .collect();

    assert_eq!(
        drops.len(),
        collisions,
        "every collision must be logged exactly once; got {} ERROR line(s) for {collisions} \
         collision(s). A drop nobody logs is a gap nobody can size.",
        drops.len()
    );

    for d in &drops {
        assert_eq!(d.level, Level::ERROR, "a lost audit record is not a WARN");

        let tenant = d.fields.get("tenant_id").unwrap_or_else(|| {
            panic!(
                "collision ERROR must carry tenant_id; fields: {:?}",
                d.fields
            )
        });
        assert!(
            tenant.contains(SEEDED_TENANT),
            "tenant_id must name the tenant whose chain lost the write, got {tenant}"
        );

        let seq = d.fields.get("chain_seq").unwrap_or_else(|| {
            panic!(
                "collision ERROR must carry chain_seq; fields: {:?}",
                d.fields
            )
        });
        assert!(
            seq.trim_matches('"').parse::<i64>().is_ok(),
            "chain_seq must be the numeric index that could not be claimed, got {seq}"
        );

        // The message must say the event is lost. "Failed to create" reads as a
        // transient that something will retry; nothing retries this.
        assert!(
            d.message.contains("LOST"),
            "the message must say the event is lost, got: {}",
            d.message
        );
    }

    // --- and the surviving chain still verifies, which is the whole point ---
    let verified = repo.verify_chain(Some(SEEDED_TENANT)).await;
    assert!(
        verified.is_ok(),
        "the chain must still verify after dropping writes -- that is precisely why a \
         verifying chain is not evidence of completeness. Got: {verified:?}"
    );
}
