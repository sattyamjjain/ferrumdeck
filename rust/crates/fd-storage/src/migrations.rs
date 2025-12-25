//! Database migration runner
//!
//! Embeds and runs SQL migrations on startup.

use sqlx::PgPool;
use tracing::info;

/// Run all pending database migrations.
///
/// This function embeds migrations at compile time from the `db/migrations` directory
/// and applies any that haven't been run yet.
///
/// # Arguments
/// * `pool` - Database connection pool
///
/// # Returns
/// * `Ok(())` if all migrations completed successfully
/// * `Err` if any migration failed
pub async fn run_migrations(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    info!("Running database migrations...");

    // The path is relative to the crate's Cargo.toml
    // fd-storage is at rust/crates/fd-storage, migrations are at db/migrations
    let migrator = sqlx::migrate!("../../../db/migrations");

    migrator.run(pool).await?;

    info!("Migrations complete");

    // Log what was applied (for debugging)
    if let Err(e) = log_migration_status(pool).await {
        tracing::warn!("Failed to log migration status: {}", e);
    }

    Ok(())
}

/// Log the current migration status.
async fn log_migration_status(pool: &PgPool) -> Result<(), sqlx::Error> {
    let rows: Vec<(String, i64)> =
        sqlx::query_as("SELECT version::text, checksum FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await?;

    for (version, _checksum) in rows {
        info!(version = %version, "Applied migration");
    }

    Ok(())
}

/// Check if migrations are needed without applying them.
///
/// Returns `true` if there are pending migrations.
pub async fn migrations_pending(pool: &PgPool) -> Result<bool, sqlx::migrate::MigrateError> {
    let migrator = sqlx::migrate!("../../../db/migrations");

    // Check if the migrations table exists
    let table_exists: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = '_sqlx_migrations')",
    )
    .fetch_one(pool)
    .await
    .unwrap_or(false);

    if !table_exists {
        return Ok(true); // Need to run migrations
    }

    // Count applied migrations
    let applied_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
        .unwrap_or(0);

    let total_migrations = migrator.migrations.len() as i64;

    Ok(applied_count < total_migrations)
}
