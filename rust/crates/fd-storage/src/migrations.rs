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
///
/// Selects only `version`. The previous implementation also selected
/// `checksum` into an `i64`, but `_sqlx_migrations.checksum` is `BYTEA`, so the
/// decode failed on every call and the caller swallowed it into a warning —
/// meaning the per-migration `info!` below had never once been emitted, and a
/// `fd_storage::migrations` WARN was unconditional noise rather than a signal.
/// The checksum was bound and immediately discarded, so it is simply not
/// selected now. See issue #34.
async fn log_migration_status(pool: &PgPool) -> Result<(), sqlx::Error> {
    let versions: Vec<String> =
        sqlx::query_scalar("SELECT version::text FROM _sqlx_migrations ORDER BY version")
            .fetch_all(pool)
            .await?;

    for version in versions {
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test for #34.
    ///
    /// `log_migration_status` returned `Err` on every call for the life of the
    /// function, because it decoded the `BYTEA` `checksum` column into an
    /// `i64`. The caller downgraded that to a `warn!`, so nothing failed and
    /// nobody noticed — the intended per-migration `info!` was never emitted.
    ///
    /// Ignored by default because it needs a live migrated database:
    ///   make dev-up && cargo test -p fd-storage -- --ignored
    #[tokio::test]
    #[ignore = "requires a live Postgres (make dev-up)"]
    async fn log_migration_status_succeeds_against_a_migrated_database() {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck".into()
        });
        let pool = PgPool::connect(&url)
            .await
            .expect("connect to the dev database");

        run_migrations(&pool).await.expect("migrations apply");

        // The assertion that matters: this must be Ok, not a swallowed Err.
        log_migration_status(&pool)
            .await
            .expect("migration status logging must succeed, not warn");

        // And it must actually have rows to log, otherwise the assertion above
        // would pass vacuously against an empty table.
        let versions: Vec<String> =
            sqlx::query_scalar("SELECT version::text FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .expect("read applied migrations");
        assert!(
            !versions.is_empty(),
            "expected at least one applied migration to log"
        );
    }

    /// Pins the column type that caused #34: if `checksum` is ever selected
    /// again, it must not be decoded as an integer.
    #[tokio::test]
    #[ignore = "requires a live Postgres (make dev-up)"]
    async fn migrations_checksum_column_is_bytea() {
        let url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
            "postgres://ferrumdeck:ferrumdeck@localhost:5433/ferrumdeck".into()
        });
        let pool = PgPool::connect(&url)
            .await
            .expect("connect to the dev database");
        run_migrations(&pool).await.expect("migrations apply");

        let data_type: String = sqlx::query_scalar(
            "SELECT data_type FROM information_schema.columns \
             WHERE table_name = '_sqlx_migrations' AND column_name = 'checksum'",
        )
        .fetch_one(&pool)
        .await
        .expect("read checksum column type");

        assert_eq!(
            data_type, "bytea",
            "checksum is {data_type}, not bytea — the #34 decode assumption changed"
        );
    }
}
