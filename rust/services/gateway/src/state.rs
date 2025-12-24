//! Application state

use fd_policy::PolicyEngine;
use fd_storage::{
    AgentsRepo, ApiKeysRepo, AuditRepo, DbPool, PoliciesRepo, QueueClient, RunsRepo, StepsRepo,
    ToolsRepo, WorkflowsRepo,
};
use std::sync::Arc;
use tokio::sync::RwLock;

use crate::middleware::{
    create_oauth2_validator, create_rate_limiter, OAuth2Validator, RateLimiter,
};

/// Shared application state
#[derive(Clone)]
pub struct AppState {
    /// Database pool
    pub db: DbPool,

    /// Policy engine for authorization
    #[allow(dead_code)]
    pub policy_engine: Arc<PolicyEngine>,

    /// Queue client for job publishing
    pub queue: Arc<RwLock<QueueClient>>,

    /// Rate limiter for API requests
    pub rate_limiter: RateLimiter,

    /// OAuth2/JWT validator (None if disabled)
    #[allow(dead_code)]
    pub oauth2_validator: Option<Arc<OAuth2Validator>>,

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

    #[allow(dead_code)]
    pub fn audit(&self) -> AuditRepo {
        AuditRepo::new(self.db.clone())
    }

    pub fn workflows(&self) -> WorkflowsRepo {
        WorkflowsRepo::new(self.db.clone())
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

        // Create database pool
        let db = fd_storage::pool::create_pool(&database_url, 20, 5).await?;

        // Create queue client
        let mut queue = QueueClient::new(&redis_url, &redis_prefix).await?;

        // Initialize step queue
        queue.init_queue("steps").await?;

        // Create policy engine with defaults
        let policy_engine = Arc::new(PolicyEngine::default());

        // Create rate limiter
        let rate_limiter = create_rate_limiter();

        // Create OAuth2 validator (if enabled via environment)
        let oauth2_validator = create_oauth2_validator();

        Ok(Self {
            db: db.clone(),
            policy_engine,
            queue: Arc::new(RwLock::new(queue)),
            rate_limiter,
            oauth2_validator,
            repos: Repos::new(db),
        })
    }

    /// Get repositories
    pub fn repos(&self) -> &Repos {
        &self.repos
    }

    /// Publish a step job to the queue
    pub async fn enqueue_step(
        &self,
        message: &fd_storage::QueueMessage<fd_storage::queue::StepJob>,
    ) -> Result<String, redis::RedisError> {
        let mut queue = self.queue.write().await;
        queue.enqueue("steps", message).await
    }
}
