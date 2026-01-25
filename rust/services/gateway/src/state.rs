//! Application state

use fd_policy::{AirlockConfig, AirlockInspector, AirlockMode, PolicyEngine};
use fd_storage::{
    AgentsRepo, ApiKeysRepo, AuditRepo, DbPool, PoliciesRepo, QueueClient, RunsRepo, StepsRepo,
    ThreatsRepo, ToolsRepo, WorkflowsRepo,
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

    /// Queue client for job publishing (lock-free, uses multiplexed connection)
    pub queue: Arc<QueueClient>,

    /// Rate limiter for API requests
    pub rate_limiter: RateLimiter,

    /// OAuth2/JWT validator (None if disabled)
    pub oauth2_validator: Option<Arc<OAuth2Validator>>,

    /// API key secret for HMAC hashing (for secure API key verification)
    pub api_key_secret: Arc<Vec<u8>>,

    /// Repositories (lazy-initialized from db pool)
    repos: Repos,
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
    pub fn spawn_audit(&self, event: fd_storage::models::CreateAuditEvent) {
        let audit_repo = self.audit();
        tokio::spawn(async move {
            if let Err(e) = audit_repo.create(event).await {
                tracing::warn!(error = %e, "Failed to create audit event");
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

    #[allow(dead_code)]
    pub fn api_keys(&self) -> ApiKeysRepo {
        ApiKeysRepo::new(self.db.clone())
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

        let airlock_config = AirlockConfig {
            mode: airlock_mode,
            ..AirlockConfig::default()
        };

        tracing::info!(
            mode = ?airlock_mode,
            "Airlock security inspector initialized"
        );

        let airlock = Arc::new(AirlockInspector::new(airlock_config));

        // Create rate limiter
        let rate_limiter = create_rate_limiter();

        // Create OAuth2 validator (if enabled via environment)
        let oauth2_validator = create_oauth2_validator();

        Ok(Self {
            db: db.clone(),
            policy_engine,
            airlock,
            queue: Arc::new(queue),
            rate_limiter,
            oauth2_validator,
            api_key_secret: Arc::new(api_key_secret.into_bytes()),
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
