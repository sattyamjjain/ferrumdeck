# Runbook: Database Migration

## Overview

Database schema migrations for FerrumDeck PostgreSQL database. Migrations are managed via SQLx and applied automatically on Gateway startup or manually.

## Pre-Migration Checklist

- [ ] Backup database
- [ ] Review migration SQL for safety
- [ ] Test migration on staging
- [ ] Schedule maintenance window if needed
- [ ] Notify stakeholders

## Migration Types

### Safe Migrations (No Downtime)

These can run while application is live:
- Adding new tables
- Adding nullable columns
- Adding indexes CONCURRENTLY
- Inserting/updating reference data

### Risky Migrations (May Require Downtime)

These may lock tables or cause issues:
- Dropping columns/tables
- Renaming columns/tables
- Adding NOT NULL constraints
- Altering column types
- Large data migrations

## Running Migrations

### Automatic (Recommended for Production)

Gateway runs embedded migrations on startup:

```bash
# Deploy new Gateway version with migrations
kubectl apply -k deploy/k8s/overlays/production

# Migrations run automatically before serving traffic
# Check logs for migration status:
kubectl logs -n ferrumdeck-prod deployment/gateway | grep -i migration
```

### Manual

For more control or dry-run:

```bash
# Using sqlx-cli
cd rust/services/gateway
export DATABASE_URL="postgres://user:pass@host:5432/ferrumdeck"

# Check pending migrations
sqlx migrate info

# Dry run (show SQL)
sqlx migrate run --dry-run

# Apply migrations
sqlx migrate run

# Revert last migration (if needed)
sqlx migrate revert
```

## Creating New Migrations

```bash
cd rust/services/gateway

# Create new migration
sqlx migrate add <migration_name>
# Creates: migrations/<timestamp>_<migration_name>.sql

# Edit the migration file
# Follow naming: YYYYMMDDHHMMSS_description.sql
```

### Migration Best Practices

1. **One change per migration**: Easier to revert

2. **Use transactions**:
   ```sql
   BEGIN;
   -- your changes
   COMMIT;
   ```

3. **Add indexes concurrently**:
   ```sql
   CREATE INDEX CONCURRENTLY idx_name ON table (column);
   ```

4. **Backfill in batches**:
   ```sql
   UPDATE table SET new_col = 'value' 
   WHERE id BETWEEN 1 AND 10000;
   ```

5. **Include down migration** (in comments):
   ```sql
   -- Down: DROP INDEX idx_name;
   ```

## Rollback Procedures

### Via sqlx (Preferred)

```bash
# Revert last migration
sqlx migrate revert

# Verify
sqlx migrate info
```

### Manual Rollback

```sql
-- Connect to database
psql -h postgres-prod -d ferrumdeck

-- Check current migrations
SELECT * FROM _sqlx_migrations ORDER BY installed_on DESC;

-- Run reversal SQL (from migration comments)
DROP INDEX IF EXISTS idx_name;

-- Update migration table (if not using sqlx revert)
DELETE FROM _sqlx_migrations WHERE version = <version>;
```

## Emergency Procedures

### Migration Stuck/Hanging

1. Check for locks:
   ```sql
   SELECT * FROM pg_locks WHERE granted = false;
   SELECT * FROM pg_stat_activity WHERE state = 'active';
   ```

2. Kill blocking queries (carefully):
   ```sql
   SELECT pg_terminate_backend(<pid>);
   ```

3. Consider restarting migration with lock timeout:
   ```sql
   SET lock_timeout = '30s';
   ```

### Database Corrupted

1. Stop all writes:
   ```bash
   kubectl scale deployment gateway -n ferrumdeck-prod --replicas=0
   kubectl scale deployment worker -n ferrumdeck-prod --replicas=0
   ```

2. Assess damage:
   ```sql
   -- Check for corruption
   SELECT pg_catalog.pg_database.datname, age(datfrozenxid) 
   FROM pg_catalog.pg_database;
   ```

3. Restore from backup:
   ```bash
   # RDS
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier ferrumdeck-prod \
     --target-db-instance-identifier ferrumdeck-prod-restored \
     --restore-time <timestamp>
   ```

## Backup Procedures

### Before Major Migration

```bash
# PostgreSQL dump
pg_dump -h postgres-prod -U admin -d ferrumdeck \
  -F c -f backup-$(date +%Y%m%d-%H%M%S).dump

# Verify backup
pg_restore --list backup-*.dump | head -20
```

### Continuous Backups

Rely on managed service features:
- RDS: Automated backups, point-in-time recovery
- Cloud SQL: Automated backups
- Self-managed: pg_basebackup + WAL archiving

## Post-Migration Verification

```bash
# Check migration status
sqlx migrate info

# Verify schema changes
psql -h postgres-prod -d ferrumdeck -c "\dt"
psql -h postgres-prod -d ferrumdeck -c "\d+ <table_name>"

# Run smoke tests
./scripts/run-evals.sh smoke
```

## Related Runbooks

- [Incident Response](incident-response.md)
