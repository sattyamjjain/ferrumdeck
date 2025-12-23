//! Database connection pool

use sqlx::postgres::PgPoolOptions;
use sqlx::PgPool;
use std::time::Duration;

/// Database pool wrapper
pub type DbPool = PgPool;

/// Create a new database connection pool
pub async fn create_pool(
    database_url: &str,
    max_connections: u32,
    min_connections: u32,
) -> Result<DbPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .min_connections(min_connections)
        .acquire_timeout(Duration::from_secs(5))
        .idle_timeout(Duration::from_secs(60 * 10))
        .connect(database_url)
        .await
}
