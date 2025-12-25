# Runbook: Database Migration

## Overview
This runbook covers database migration procedures for FerrumDeck.

## Migration Strategy
FerrumDeck uses **embedded migrations** via SQLx. Migrations run automatically on gateway startup unless disabled.

## Pre-Migration Checklist
- [ ] Backup database
- [ ] Review migration SQL
- [ ] Test on staging environment
- [ ] Schedule maintenance window (if destructive)
- [ ] Notify stakeholders

## Automatic Migration (Default)

### How It Works
1. Gateway starts
2. Checks `RUN_MIGRATIONS` env var (default: `true`)
3. Runs `sqlx::migrate!()` which applies pending migrations
4. Logs applied migrations
5. Begins serving requests

### Disable Auto-Migration
```bash
# Set environment variable
export RUN_MIGRATIONS=false

# Or in Kubernetes
kubectl set env deployment/gateway RUN_MIGRATIONS=false -n ferrumdeck
```

## Manual Migration

### Using SQLx CLI
```bash
# Install sqlx-cli
cargo install sqlx-cli

# Set database URL
export DATABASE_URL=postgres://user:pass@host:5432/ferrumdeck

# Check pending migrations
sqlx migrate info --source db/migrations

# Run migrations
sqlx migrate run --source db/migrations

# Revert last migration (if reversible)
sqlx migrate revert --source db/migrations
```

### Direct SQL
```bash
# Connect to database
psql $DATABASE_URL

# Check migration history
SELECT version, description, installed_on
FROM _sqlx_migrations
ORDER BY version;
```

## Creating New Migrations

### Naming Convention
```
YYYYMMDDHHMMSS_description.sql
Example: 20241226000001_add_workflow_triggers.sql
```

### Best Practices
1. **Make migrations reversible** when possible
2. **Avoid destructive changes** without careful planning
3. **Use transactions** (SQLx wraps each migration)
4. **Test on production-like data**
5. **Keep migrations small and focused**

### Template
```sql
-- Migration: YYYYMMDDHHMMSS_description.sql
-- Description: Brief explanation

-- Forward migration
CREATE TABLE new_table (...);

-- Note: SQLx doesn't support DOWN migrations automatically
-- Document rollback steps in comments if needed
-- ROLLBACK: DROP TABLE new_table;
```

## Handling Migration Failures

### Symptoms
- Gateway fails to start
- Logs show "Migration failed"
- Database may be in partial state

### Recovery Steps

1. **Don't panic** - failed migrations are rolled back

2. **Check error message**
   ```bash
   kubectl logs deployment/gateway -n ferrumdeck | grep -i migration
   ```

3. **Connect to database and verify state**
   ```sql
   SELECT * FROM _sqlx_migrations ORDER BY version DESC LIMIT 5;
   ```

4. **Fix the migration file**

5. **Retry**
   ```bash
   kubectl rollout restart deployment/gateway -n ferrumdeck
   ```

### Manual Intervention
If migration partially applied:

```sql
-- Check for partial changes
\dt  -- List tables

-- Manually complete or revert
-- Then update migration history if needed
INSERT INTO _sqlx_migrations (version, description, installed_on, checksum)
VALUES (20241226000001, 'add_workflow_triggers', NOW(), 0);
```

## Large Table Migrations

For tables with millions of rows:

### Use Online DDL
```sql
-- Add column with default (PostgreSQL 11+ is fast)
ALTER TABLE large_table ADD COLUMN new_col TEXT DEFAULT 'value';

-- Add index concurrently (doesn't block writes)
CREATE INDEX CONCURRENTLY idx_name ON large_table(column);
```

### Batch Updates
```sql
-- Update in batches to avoid long locks
DO $$
DECLARE
  batch_size INT := 10000;
  affected INT;
BEGIN
  LOOP
    UPDATE large_table
    SET new_col = computed_value
    WHERE id IN (
      SELECT id FROM large_table
      WHERE new_col IS NULL
      LIMIT batch_size
    );
    GET DIAGNOSTICS affected = ROW_COUNT;
    EXIT WHEN affected = 0;
    COMMIT;
    PERFORM pg_sleep(0.1);  -- Brief pause
  END LOOP;
END $$;
```

## Rollback Procedures

### Revert Using Backup
```bash
# Stop gateway
kubectl scale deployment/gateway --replicas=0 -n ferrumdeck

# Restore from backup
pg_restore -d ferrumdeck backup.dump

# Restart with migrations disabled
kubectl set env deployment/gateway RUN_MIGRATIONS=false -n ferrumdeck
kubectl scale deployment/gateway --replicas=2 -n ferrumdeck
```

## Post-Migration Verification
- [ ] All tables present (`\dt`)
- [ ] Indexes created (`\di`)
- [ ] Triggers active (`\dS`)
- [ ] Gateway starts successfully
- [ ] API health check passes
- [ ] Sample queries work correctly
