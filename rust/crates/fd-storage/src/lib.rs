//! FerrumDeck Storage Layer
//!
//! PostgreSQL repositories for all FerrumDeck entities.
//! Uses SQLx for compile-time checked queries.

pub mod migrations;
pub mod models;
pub mod pool;
pub mod queue;
pub mod repos;
pub mod retention;

pub use migrations::run_migrations;
pub use pool::{create_pool, DbPool};
pub use queue::{QueueClient, QueueMessage};
pub use repos::*;
pub use retention::{
    check_retention_floor, PruneError, RetentionFloorError, AUDIT_RETENTION_FLOOR_YEARS,
};
