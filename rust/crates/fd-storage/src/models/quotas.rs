//! Tenant quota models and types.

use chrono::{DateTime, NaiveDate, Utc};
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use uuid::Uuid;

/// Quota limits for a tenant.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TenantQuota {
    pub id: Uuid,
    pub tenant_id: String, // TEXT in database (ULID format: ten_xxxxx)

    // Token quotas (monthly)
    pub monthly_input_token_limit: Option<i64>,
    pub monthly_output_token_limit: Option<i64>,

    // Cost quotas (monthly, in cents)
    pub monthly_cost_limit_cents: Option<i64>,

    // Run quotas
    pub daily_run_limit: Option<i32>,
    pub concurrent_run_limit: i32,

    // API rate limits
    pub requests_per_minute: i32,
    pub requests_per_hour: i32,

    // Budget per run
    pub max_cost_per_run_cents: i32,
    pub max_tokens_per_run: i32,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Current usage tracking for quota enforcement.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TenantUsageCurrent {
    pub tenant_id: String, // TEXT in database (ULID format: ten_xxxxx)

    // Current month totals
    pub month_start: NaiveDate,
    pub month_input_tokens: i64,
    pub month_output_tokens: i64,
    pub month_cost_cents: Decimal,
    pub month_runs: i32,

    // Current day totals
    pub day_start: NaiveDate,
    pub day_runs: i32,
    pub day_api_requests: i32,

    // Current concurrent runs
    pub concurrent_runs: i32,

    // Rate limiting
    pub minute_window_start: DateTime<Utc>,
    pub minute_requests: i32,
    pub hour_window_start: DateTime<Utc>,
    pub hour_requests: i32,

    pub updated_at: DateTime<Utc>,
}

/// Daily aggregated usage for a tenant.
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct TenantUsageDaily {
    pub id: Uuid,
    pub tenant_id: String, // TEXT in database (ULID format: ten_xxxxx)
    pub usage_date: NaiveDate,

    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_cents: Decimal,

    pub runs_started: i32,
    pub runs_completed: i32,
    pub runs_failed: i32,

    pub llm_steps: i32,
    pub tool_steps: i32,

    pub tool_usage: serde_json::Value,
    pub api_requests: i32,

    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Result of quota check.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuotaCheckResult {
    pub exceeded: bool,
    pub reason: Option<String>,
    pub current_month_cost: Decimal,
    pub month_limit: Option<i64>,
}

/// Usage update parameters.
#[derive(Debug, Clone, Default)]
pub struct UsageUpdate {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_cents: Decimal,
    pub is_run_start: bool,
    pub is_run_complete: bool,
    pub is_api_request: bool,
}

impl UsageUpdate {
    /// Create update for API request.
    pub fn api_request() -> Self {
        Self {
            is_api_request: true,
            ..Default::default()
        }
    }

    /// Create update for run start.
    pub fn run_start() -> Self {
        Self {
            is_run_start: true,
            ..Default::default()
        }
    }

    /// Create update for run completion.
    pub fn run_complete() -> Self {
        Self {
            is_run_complete: true,
            ..Default::default()
        }
    }

    /// Create update for token usage.
    pub fn tokens(input: i64, output: i64, cost: Decimal) -> Self {
        Self {
            input_tokens: input,
            output_tokens: output,
            cost_cents: cost,
            ..Default::default()
        }
    }
}

/// Summary of tenant usage for API response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSummary {
    pub tenant_id: String, // TEXT in database (ULID format: ten_xxxxx)

    // Current month
    pub month_input_tokens: i64,
    pub month_output_tokens: i64,
    pub month_cost_cents: Decimal,
    pub month_runs: i32,

    // Quotas
    pub monthly_cost_limit_cents: Option<i64>,
    pub daily_run_limit: Option<i32>,
    pub concurrent_run_limit: i32,

    // Current usage vs limits
    pub cost_percentage: f64,
    pub runs_today: i32,
    pub concurrent_runs: i32,
}
