//! Tenant quota repository operations.

use rust_decimal::Decimal;
use sqlx::PgPool;

use crate::models::quotas::{QuotaCheckResult, TenantQuota, TenantUsageCurrent, UsageSummary, UsageUpdate};

/// Get quota limits for a tenant.
pub async fn get_quota(pool: &PgPool, tenant_id: &str) -> Result<Option<TenantQuota>, sqlx::Error> {
    sqlx::query_as::<_, TenantQuota>(
        r#"
        SELECT * FROM tenant_quotas WHERE tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Create or update quota limits for a tenant.
pub async fn upsert_quota(
    pool: &PgPool,
    tenant_id: &str,
    monthly_cost_limit_cents: Option<i64>,
    daily_run_limit: Option<i32>,
    concurrent_run_limit: Option<i32>,
    requests_per_minute: Option<i32>,
    max_cost_per_run_cents: Option<i32>,
) -> Result<TenantQuota, sqlx::Error> {
    sqlx::query_as::<_, TenantQuota>(
        r#"
        INSERT INTO tenant_quotas (tenant_id, monthly_cost_limit_cents, daily_run_limit, 
                                   concurrent_run_limit, requests_per_minute, max_cost_per_run_cents)
        VALUES ($1, $2, $3, COALESCE($4, 10), COALESCE($5, 1000), COALESCE($6, 500))
        ON CONFLICT (tenant_id) DO UPDATE SET
            monthly_cost_limit_cents = COALESCE($2, tenant_quotas.monthly_cost_limit_cents),
            daily_run_limit = COALESCE($3, tenant_quotas.daily_run_limit),
            concurrent_run_limit = COALESCE($4, tenant_quotas.concurrent_run_limit),
            requests_per_minute = COALESCE($5, tenant_quotas.requests_per_minute),
            max_cost_per_run_cents = COALESCE($6, tenant_quotas.max_cost_per_run_cents),
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(tenant_id)
    .bind(monthly_cost_limit_cents)
    .bind(daily_run_limit)
    .bind(concurrent_run_limit)
    .bind(requests_per_minute)
    .bind(max_cost_per_run_cents)
    .fetch_one(pool)
    .await
}

/// Get current usage for a tenant.
pub async fn get_current_usage(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<TenantUsageCurrent>, sqlx::Error> {
    sqlx::query_as::<_, TenantUsageCurrent>(
        r#"
        SELECT * FROM tenant_usage_current WHERE tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await
}

/// Update usage and check quotas atomically.
/// Returns quota check result.
pub async fn update_usage_and_check(
    pool: &PgPool,
    tenant_id: &str,
    update: &UsageUpdate,
) -> Result<QuotaCheckResult, sqlx::Error> {
    let row = sqlx::query_as::<_, (bool, Option<String>, Decimal, i64)>(
        r#"
        SELECT * FROM update_tenant_usage($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(tenant_id)
    .bind(update.input_tokens)
    .bind(update.output_tokens)
    .bind(update.cost_cents)
    .bind(update.is_run_start)
    .bind(update.is_run_complete)
    .bind(update.is_api_request)
    .fetch_one(pool)
    .await?;

    Ok(QuotaCheckResult {
        exceeded: row.0,
        reason: row.1,
        current_month_cost: row.2,
        month_limit: if row.3 > 0 { Some(row.3) } else { None },
    })
}

/// Check if running this request would exceed quota (pre-check).
/// Does not update usage.
pub async fn check_quota_preemptive(
    pool: &PgPool,
    tenant_id: &str,
    estimated_cost: Decimal,
) -> Result<QuotaCheckResult, sqlx::Error> {
    let row = sqlx::query_as::<_, (bool, Option<String>, Decimal, Option<i64>)>(
        r#"
        SELECT 
            CASE 
                WHEN q.monthly_cost_limit_cents IS NOT NULL AND 
                     COALESCE(c.month_cost_cents, 0) + $2 > q.monthly_cost_limit_cents 
                THEN TRUE
                WHEN c.concurrent_runs >= q.concurrent_run_limit 
                THEN TRUE
                ELSE FALSE
            END as exceeded,
            CASE 
                WHEN q.monthly_cost_limit_cents IS NOT NULL AND 
                     COALESCE(c.month_cost_cents, 0) + $2 > q.monthly_cost_limit_cents 
                THEN 'Monthly cost limit would be exceeded'
                WHEN c.concurrent_runs >= q.concurrent_run_limit 
                THEN 'Concurrent run limit reached'
                ELSE NULL
            END as reason,
            COALESCE(c.month_cost_cents, 0) as current_month_cost,
            q.monthly_cost_limit_cents
        FROM tenant_quotas q
        LEFT JOIN tenant_usage_current c ON c.tenant_id = q.tenant_id
        WHERE q.tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .bind(estimated_cost)
    .fetch_optional(pool)
    .await?;

    match row {
        Some((exceeded, reason, current_cost, limit)) => Ok(QuotaCheckResult {
            exceeded,
            reason,
            current_month_cost: current_cost,
            month_limit: limit,
        }),
        None => Ok(QuotaCheckResult {
            exceeded: false,
            reason: None,
            current_month_cost: Decimal::ZERO,
            month_limit: None,
        }),
    }
}

/// Get usage summary for a tenant.
pub async fn get_usage_summary(
    pool: &PgPool,
    tenant_id: &str,
) -> Result<Option<UsageSummary>, sqlx::Error> {
    let row = sqlx::query_as::<
        _,
        (
            String,
            i64,
            i64,
            Decimal,
            i32,
            Option<i64>,
            Option<i32>,
            i32,
            i32,
            i32,
        ),
    >(
        r#"
        SELECT 
            q.tenant_id,
            COALESCE(c.month_input_tokens, 0) as month_input_tokens,
            COALESCE(c.month_output_tokens, 0) as month_output_tokens,
            COALESCE(c.month_cost_cents, 0) as month_cost_cents,
            COALESCE(c.month_runs, 0) as month_runs,
            q.monthly_cost_limit_cents,
            q.daily_run_limit,
            q.concurrent_run_limit,
            COALESCE(c.day_runs, 0) as runs_today,
            COALESCE(c.concurrent_runs, 0) as concurrent_runs
        FROM tenant_quotas q
        LEFT JOIN tenant_usage_current c ON c.tenant_id = q.tenant_id
        WHERE q.tenant_id = $1
        "#,
    )
    .bind(tenant_id)
    .fetch_optional(pool)
    .await?;

    match row {
        Some((
            tenant_id,
            input_tokens,
            output_tokens,
            cost_cents,
            month_runs,
            monthly_limit,
            daily_limit,
            concurrent_limit,
            runs_today,
            concurrent_runs,
        )) => {
            let cost_percentage = if let Some(limit) = monthly_limit {
                if limit > 0 {
                    (cost_cents.to_string().parse::<f64>().unwrap_or(0.0) / limit as f64) * 100.0
                } else {
                    0.0
                }
            } else {
                0.0
            };

            Ok(Some(UsageSummary {
                tenant_id,
                month_input_tokens: input_tokens,
                month_output_tokens: output_tokens,
                month_cost_cents: cost_cents,
                month_runs,
                monthly_cost_limit_cents: monthly_limit,
                daily_run_limit: daily_limit,
                concurrent_run_limit: concurrent_limit,
                cost_percentage,
                runs_today,
                concurrent_runs,
            }))
        }
        None => Ok(None),
    }
}

/// Trigger daily usage rollup.
pub async fn rollup_daily_usage(
    pool: &PgPool,
    date: chrono::NaiveDate,
) -> Result<i32, sqlx::Error> {
    let row = sqlx::query_scalar::<_, i32>(
        r#"
        SELECT rollup_daily_usage($1)
        "#,
    )
    .bind(date)
    .fetch_one(pool)
    .await?;

    Ok(row)
}
