//! Application state

use fd_core::ToolVersionId;
use fd_policy::airlock::{BehavioralDriftMonitor, SchemaDriftGuard};
use fd_policy::{
    AirlockConfig, AirlockInspector, AirlockMode, CoherenceConfig, CoherenceMonitor, PolicyEngine,
};
use fd_storage::{
    AgentsRepo, ApiKeysRepo, AuditRepo, DbPool, PoliciesRepo, ProjectsRepo, QueueClient, RunsRepo,
    StepsRepo, ThreatsRepo, ToolsRepo, WorkflowsRepo,
};
use std::sync::Arc;

use crate::middleware::{
    create_oauth2_validator, create_rate_limiter, OAuth2Validator, RateLimiter,
};

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    /// Database pool
    pub db: DbPool,

    /// Policy engine for authorization
    pub policy_engine: Arc<PolicyEngine>,

    /// Airlock security inspector
    pub airlock: Arc<AirlockInspector>,

    /// The schema-drift guard the inspector holds, shared here so registry
    /// write paths can register a new tool version's schema live (#13). Same
    /// `Arc` as inside `airlock`; interior-mutable behind an `RwLock`.
    pub schema_drift_guard: Arc<SchemaDriftGuard>,

    /// Coherence-divergence monitor (Strained Coherence, arXiv:2606.07889) —
    /// a trajectory-level Airlock RASP signal fed live from the run's step
    /// stream. One monitor shared across the process; it keys per-run state by
    /// run id internally. Surfaces divergences (never blocks).
    pub coherence: Arc<CoherenceMonitor>,

    /// Config for the coherence monitor (enable flag, lookahead, confidence).
    pub coherence_config: CoherenceConfig,

    /// What the two NAME-MATCHED Airlock layers actually inspect on THIS
    /// deployment — Layer 1 (anti-RCE) and Layer 3 (exfiltration + credential
    /// DLP) — reconciled at boot from the tool registry against each layer's
    /// `target_tools`. Both now default to empty, meaning inspect everything;
    /// this stays because narrowing is still allowed, and an operator who
    /// narrows should be able to see what it leaves uncovered. Surfaced on
    /// `/ready` so it is visible without reading boot logs.
    pub airlock_coverage: Arc<fd_policy::airlock::AirlockCoverage>,

    /// When `true` (`FERRUMDECK_COHERENCE_MODE=enforce`), a coherence divergence
    /// that maps to the R3 rung gates the run (→ `WaitingApproval`). Default
    /// `false` (shadow): the R-tier response is recorded + surfaced but the run
    /// is never gated. Mirrors the Airlock shadow/enforce convention.
    pub coherence_enforce: bool,

    /// Why [`Self::coherence_enforce`] is what it is. Surfaced on `/ready` so an
    /// operator who set `FERRUMDECK_COHERENCE_MODE=enforce` and did not get a
    /// gate can see the reason without reading boot logs — the same treatment
    /// `airlock_coverage` gets, for the same reason.
    pub coherence_enforce_reason: String,

    /// Whether enforce mode was asked for, independent of whether it was
    /// granted. Without this, "enforce: false" cannot be told apart from
    /// "nobody asked".
    pub coherence_enforce_requested: bool,

    /// How long a human has to act on an approval gate before it expires
    /// (`FERRUMDECK_APPROVAL_TTL_SECS`, default 3600).
    ///
    /// The deadline is recorded on the escalation audit event, so a reader can
    /// tell an approval that expired against a 60-second window from one that
    /// expired against a day-long one. Those are different facts about the
    /// control even though both end in `approval.expired`.
    pub approval_ttl_secs: i64,

    /// Queue client for job publishing (lock-free, uses multiplexed connection)
    pub queue: Arc<QueueClient>,

    /// Rate limiter for API requests
    pub rate_limiter: RateLimiter,

    /// OAuth2/JWT validator (None if disabled)
    pub oauth2_validator: Option<Arc<OAuth2Validator>>,

    /// API key secret for HMAC hashing (for secure API key verification)
    pub api_key_secret: Arc<Vec<u8>>,

    /// Realtime event bus backing `GET /v1/events/{channel}` (issue #5).
    ///
    /// Publish through [`AppState::spawn_audit_and_publish`] rather than
    /// touching this directly on the decision path: events about a persisted
    /// record must not be emitted until that record exists.
    pub events: Arc<crate::events::EventBus>,

    /// Repositories (lazy-initialized from db pool)
    repos: Repos,
}

impl AppState {
    /// Write an audit record off the request path, and publish a realtime event
    /// **only once that record is durable** (issue #5).
    ///
    /// This is the split the SSE work exists to make. `Repos::spawn_audit` is
    /// fire-and-forget: the handler returns before the insert commits. Emitting
    /// the event where the decision is *computed* would hand a consumer a
    /// `record_id` that reads back as nothing, and an audit consumer cannot
    /// distinguish "not written yet" from "never written" — so it would have to
    /// treat every event as unverifiable, which is worse than polling.
    ///
    /// `make_events` is called with the row **as inserted**, so an id it puts on
    /// the wire is an id that already exists. It returns zero or more
    /// `(channel, event_type, payload)` triples — several, when one record
    /// warrants more than one view of itself, and an empty vec to publish
    /// nothing.
    ///
    /// When the write FAILS, nothing is published. A consumer seeing silence is
    /// correct — there is no record — and the drop is still logged at ERROR by
    /// the same path `spawn_audit` uses, so it stays countable.
    pub fn spawn_audit_and_publish<F>(
        &self,
        event: fd_storage::models::CreateAuditEvent,
        make_events: F,
    ) where
        F: FnOnce(&fd_storage::models::AuditEvent) -> Vec<crate::events::PendingEvent>
            + Send
            + 'static,
    {
        let audit_repo = self.repos().audit();
        let bus = self.events.clone();
        tokio::spawn(crate::events::record_then_publish(
            audit_repo,
            bus,
            event,
            make_events,
        ));
    }

    /// Publish a realtime event about a record this caller has **already
    /// awaited to a successful write**.
    ///
    /// The sibling of [`Self::spawn_audit_and_publish`], for the state that does
    /// not live in `audit_events`. The run forecast is written with an awaited
    /// `RunsRepo::update_forecast`, so by the time that returns `Ok` the row is
    /// durable and a consumer reading `GET /v1/runs/{id}` will see it.
    ///
    /// The ordering rule is identical and just as load-bearing: call this on the
    /// `Ok` arm only. On `Err` publish nothing — silence is the correct signal
    /// when there is no record, and an event describing a write that failed is
    /// the one thing an audit stream must never emit.
    pub fn publish_committed(&self, channel: &str, event_type: &str, payload: serde_json::Value) {
        self.events.publish(channel, event_type, payload);
    }
}

/// Repository container
#[derive(Clone)]
pub struct Repos {
    db: DbPool,
}

impl Repos {
    pub fn new(db: DbPool) -> Self {
        Self { db }
    }

    /// Spawn an audit event write in the background (fire-and-forget).
    /// This reduces API latency by not waiting for audit writes to complete.
    /// Write an audit event off the request path.
    ///
    /// Fire-and-forget: nothing retries, so a failure here means the event is
    /// **lost**. That is why the failure is ERROR rather than WARN — the audit
    /// trail is the evidence base for the EU AI Act Art. 12 record-keeping and
    /// CRA Art. 14 reporting claims, and a dropped record is an evidence loss,
    /// not a degraded-service notice. `AuditRepo::create` logs the chain-
    /// collision case with the tenant and the `chain_seq` that could not be
    /// claimed; this line catches every other failure mode.
    pub fn spawn_audit(&self, event: fd_storage::models::CreateAuditEvent) {
        let audit_repo = self.audit();
        let tenant_id = event
            .tenant_id
            .clone()
            .unwrap_or_else(|| fd_storage::repos::audit::GLOBAL_CHAIN_TENANT.to_string());
        let event_id = event.id.clone();
        let action = event.action.clone();
        tokio::spawn(async move {
            if let Err(e) = audit_repo.create(event).await {
                tracing::error!(
                    error = %e,
                    tenant_id = %tenant_id,
                    event_id = %event_id,
                    action = %action,
                    "audit event DROPPED: nothing retries this write, so the record is lost"
                );
            }
        });
    }

    pub fn runs(&self) -> RunsRepo {
        RunsRepo::new(self.db.clone())
    }

    pub fn steps(&self) -> StepsRepo {
        StepsRepo::new(self.db.clone())
    }

    pub fn agents(&self) -> AgentsRepo {
        AgentsRepo::new(self.db.clone())
    }

    pub fn tools(&self) -> ToolsRepo {
        ToolsRepo::new(self.db.clone())
    }

    pub fn policies(&self) -> PoliciesRepo {
        PoliciesRepo::new(self.db.clone())
    }

    pub fn projects(&self) -> ProjectsRepo {
        ProjectsRepo::new(self.db.clone())
    }

    #[allow(dead_code)]
    pub fn api_keys(&self) -> ApiKeysRepo {
        ApiKeysRepo::new(self.db.clone())
    }

    /// The eval-run store (issue #46). One queryable place for both committed
    /// reports and dispatched runs; `evals/reports/*.json` is its import source.
    pub fn evals(&self) -> fd_storage::EvalsRepo {
        fd_storage::EvalsRepo::new(self.db.clone())
    }

    pub fn audit(&self) -> AuditRepo {
        AuditRepo::new(self.db.clone())
    }

    pub fn workflows(&self) -> WorkflowsRepo {
        WorkflowsRepo::new(self.db.clone())
    }

    pub fn threats(&self) -> ThreatsRepo {
        ThreatsRepo::new(self.db.clone())
    }
}

impl AppState {
    pub async fn new() -> anyhow::Result<Self> {
        // Load configuration from environment
        let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck".to_string()
        });

        let redis_url =
            std::env::var("REDIS_URL").unwrap_or_else(|_| "redis://localhost:6379".to_string());

        let redis_prefix =
            std::env::var("REDIS_QUEUE_PREFIX").unwrap_or_else(|_| "fd:queue:".to_string());

        // SECURITY: Load API key secret for HMAC hashing
        // In production, this MUST be set to a secure random value (at least 32 bytes)
        let is_production = std::env::var("FERRUMDECK_ENV")
            .map(|v| v.to_lowercase() == "production")
            .unwrap_or(false);

        let api_key_secret = match std::env::var("API_KEY_SECRET") {
            Ok(secret) => {
                if secret.len() < 32 {
                    tracing::warn!(
                        "API_KEY_SECRET is less than 32 bytes, consider using a longer secret"
                    );
                }
                secret
            }
            Err(_) => {
                if is_production {
                    return Err(anyhow::anyhow!(
                        "API_KEY_SECRET must be set in production. \
                         Generate a secure random value with: openssl rand -base64 32"
                    ));
                }
                tracing::warn!(
                    "API_KEY_SECRET not set, using default development secret. \
                     DO NOT USE IN PRODUCTION!"
                );
                "ferrumdeck-dev-secret-do-not-use-in-production".to_string()
            }
        };

        // Create database pool
        let db = fd_storage::pool::create_pool(&database_url, 20, 5).await?;

        // Run database migrations
        if std::env::var("RUN_MIGRATIONS").unwrap_or_else(|_| "true".to_string()) == "true" {
            fd_storage::run_migrations(&db)
                .await
                .map_err(|e| anyhow::anyhow!("Migration failed: {}", e))?;
        }

        // Create queue client (lock-free, uses multiplexed connection internally)
        let queue = QueueClient::new(&redis_url, &redis_prefix).await?;

        // Initialize step queue
        queue.init_queue("steps").await?;

        // Create policy engine with defaults
        let policy_engine = Arc::new(PolicyEngine::default());

        // Create Airlock security inspector
        let airlock_mode = match std::env::var("FERRUMDECK_AIRLOCK_MODE")
            .unwrap_or_else(|_| "shadow".to_string())
            .to_lowercase()
            .as_str()
        {
            "enforce" => AirlockMode::Enforce,
            _ => AirlockMode::Shadow, // Default to shadow mode for safety
        };

        // Schema-drift posture for tool versions the guard has no schema for
        // (registered-but-not-yet-populated, or an uncompilable schema).
        // Default fail-open (skip); opt into deny-by-default with
        // FERRUMDECK_SCHEMA_DRIFT_FAIL_CLOSED=true.
        let schema_drift_fail_closed = std::env::var("FERRUMDECK_SCHEMA_DRIFT_FAIL_CLOSED")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false);
        let airlock_config = AirlockConfig {
            mode: airlock_mode,
            schema_drift: fd_policy::airlock::config::SchemaDriftConfig {
                fail_closed_on_unregistered: schema_drift_fail_closed,
                ..fd_policy::airlock::config::SchemaDriftConfig::default()
            },
            ..AirlockConfig::default()
        };

        // Captured before `airlock_config` is moved into the inspector below;
        // the coverage reconciliation needs both name-matched layers after that
        // point.
        let rce_config = airlock_config.rce.clone();
        let exfil_config = airlock_config.exfiltration.clone();

        tracing::info!(
            mode = ?airlock_mode,
            "Airlock security inspector initialized"
        );

        // Wire the two drift layers into the inspector so they fire in the
        // running gateway. Without both of these the schema-drift (Layer 0) and
        // behavioral-drift (Layer -1) layers are inert: the inspector skips them
        // unless it holds a guard/monitor AND the per-call context carries a
        // tool_version_id / agent_id (populated in `check_tool_policy`). See #4.
        //
        // The schema-drift guard is SEEDED here from the `tool_versions` table,
        // then kept current at runtime: `create_tool` calls `guard.upsert(..)`
        // on every registry write, so a tool version registered after boot is
        // drift-checked without a restart (#13). We keep the same `Arc` in
        // `AppState.schema_drift_guard` so those handlers reach the very guard
        // the inspector reads. The behavioral-drift monitor is a single
        // process-wide instance so its per-agent baselines accumulate across
        // every run.
        let schema_guard = Arc::new(match ToolsRepo::new(db.clone()).list_all_versions().await {
            Ok(versions) => {
                let pairs = versions.into_iter().filter_map(|tv| {
                    ToolVersionId::parse(&tv.id)
                        .ok()
                        .map(|id| (id, tv.input_schema))
                });
                let guard = SchemaDriftGuard::new(pairs);
                tracing::info!(
                    schema_count = guard.len(),
                    "Airlock schema-drift guard seeded at boot"
                );
                guard
            }
            Err(e) => {
                tracing::warn!(
                    error = %e,
                    "failed to load tool versions for schema-drift guard; \
                     starting empty (registry writes will populate it live)"
                );
                SchemaDriftGuard::empty()
            }
        });
        let behavioral_monitor = Arc::new(BehavioralDriftMonitor::new());

        let airlock = Arc::new(
            AirlockInspector::new(airlock_config)
                .with_schema_drift_guard(Arc::clone(&schema_guard))
                .with_behavioral_drift_monitor(behavioral_monitor),
        );

        // Reconcile what Layer 1 will actually inspect. `RcePatternMatcher::
        // should_inspect` matches the tool NAME against `rce.target_tools`, so
        // a registry full of domain-named tools and a shell-shaped default
        // target list produce a layer that is enabled, tested, and inert. This
        // does not change any decision -- widening the default is a posture
        // call for the operator -- it makes the answer sayable.
        let airlock_coverage = Arc::new(
            match ToolsRepo::new(db.clone()).list(None, None, 1_000, 0).await {
                Ok(tools) => {
                    let names: Vec<String> = tools.into_iter().map(|t| t.slug).collect();
                    fd_policy::airlock::AirlockCoverage::reconcile(
                        &names,
                        &rce_config,
                        &exfil_config,
                    )
                }
                Err(e) => {
                    // Report nothing rather than assert coverage we did not verify.
                    tracing::warn!(
                        error = %e,
                        "could not read the tool registry to reconcile Airlock coverage; \
                         reporting it as unknown (no tools counted)"
                    );
                    fd_policy::airlock::AirlockCoverage::reconcile(&[], &rce_config, &exfil_config)
                }
            },
        );
        for layer in airlock_coverage.layers() {
            if layer.is_blind() {
                tracing::warn!(
                    layer = %layer.layer,
                    status = layer.status().as_str(),
                    registered_tools = ?layer.uninspected,
                    target_tools = ?layer.target_tools,
                    "{}",
                    layer.summary()
                );
            } else if !layer.uninspected.is_empty() {
                tracing::warn!(
                    layer = %layer.layer,
                    status = layer.status().as_str(),
                    uninspected = ?layer.uninspected,
                    "{}",
                    layer.summary()
                );
            } else {
                tracing::info!(layer = %layer.layer, status = layer.status().as_str(), "{}", layer.summary());
            }
        }

        // Coherence-divergence monitor — fed live from the step stream in
        // `submit_step_result`. Enabled by default; disable via
        // FERRUMDECK_COHERENCE_ENABLED=false (it only surfaces, never blocks).
        let coherence_config = CoherenceConfig {
            enabled: std::env::var("FERRUMDECK_COHERENCE_ENABLED")
                .map(|v| !v.eq_ignore_ascii_case("false"))
                .unwrap_or(true),
            ..CoherenceConfig::default()
        };
        // Enforce mode is REQUESTED here and granted below only if there is a
        // measured false-positive rate to justify it. Asking is not the same as
        // being allowed: this detector is a lexical matcher, and gating runs on
        // an unmeasured matcher trades a reliability signal for an availability
        // risk of unknown size. See `crate::coherence_evidence`.
        let coherence_enforce_requested = std::env::var("FERRUMDECK_COHERENCE_MODE")
            .map(|v| v.eq_ignore_ascii_case("enforce"))
            .unwrap_or(false);

        let coherence_evidence = crate::coherence_evidence::decide_now();
        let coherence_enforce = coherence_enforce_requested && coherence_evidence.allowed();

        if coherence_enforce_requested && !coherence_enforce {
            // ERROR, not WARN. The operator asked for a gate and is not getting
            // one; silently running in shadow while the config says `enforce`
            // is the failure this whole module exists to prevent.
            tracing::error!(
                requested = true,
                active = false,
                reason = %coherence_evidence.explain(),
                "FERRUMDECK_COHERENCE_MODE=enforce REFUSED — running in shadow"
            );
        }
        tracing::info!(
            enabled = coherence_config.enabled,
            enforce_requested = coherence_enforce_requested,
            enforce = coherence_enforce,
            evidence = %coherence_evidence.explain(),
            "Coherence-divergence monitor initialized"
        );
        let coherence = Arc::new(CoherenceMonitor::new());

        let approval_ttl_secs = std::env::var("FERRUMDECK_APPROVAL_TTL_SECS")
            .ok()
            .and_then(|v| v.parse::<i64>().ok())
            .filter(|v| *v > 0)
            .unwrap_or(3600);

        // Create rate limiter
        let rate_limiter = create_rate_limiter();

        // Create OAuth2 validator (if enabled via environment)
        let oauth2_validator = create_oauth2_validator();

        Ok(Self {
            db: db.clone(),
            policy_engine,
            airlock,
            schema_drift_guard: schema_guard,
            coherence,
            coherence_config,
            coherence_enforce,
            coherence_enforce_reason: coherence_evidence.explain(),
            coherence_enforce_requested,
            airlock_coverage,
            approval_ttl_secs,
            queue: Arc::new(queue),
            rate_limiter,
            oauth2_validator,
            api_key_secret: Arc::new(api_key_secret.into_bytes()),
            events: Arc::new(crate::events::EventBus::new()),
            repos: Repos::new(db),
        })
    }

    /// Get repositories
    pub fn repos(&self) -> &Repos {
        &self.repos
    }

    /// Publish a step job to the queue
    ///
    /// This method is lock-free and can be called concurrently from multiple tasks.
    pub async fn enqueue_step(
        &self,
        message: &fd_storage::QueueMessage<fd_storage::queue::StepJob>,
    ) -> Result<String, redis::RedisError> {
        self.queue.enqueue("steps", message).await
    }
}
