//! Rate limiting middleware using token bucket algorithm
//!
//! Supports configurable limits per tenant or IP address with sliding window.

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::RwLock;
use tracing::{debug, warn};

use super::AuthContext;
use crate::state::AppState;

/// Rate limiter configuration
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Maximum requests per window
    pub max_requests: u32,
    /// Window duration
    pub window: Duration,
    /// Whether to use tenant ID (authenticated) or IP (unauthenticated)
    pub by_tenant: bool,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            max_requests: 100,
            window: Duration::from_secs(60),
            by_tenant: true,
        }
    }
}

impl RateLimitConfig {
    /// Create a rate limiter with requests per minute limit
    pub fn per_minute(requests: u32) -> Self {
        Self {
            max_requests: requests,
            window: Duration::from_secs(60),
            by_tenant: true,
        }
    }

    /// Create a rate limiter with requests per second limit
    #[allow(dead_code)]
    pub fn per_second(requests: u32) -> Self {
        Self {
            max_requests: requests,
            window: Duration::from_secs(1),
            by_tenant: true,
        }
    }

    /// Use IP-based limiting instead of tenant
    #[allow(dead_code)]
    pub fn by_ip(mut self) -> Self {
        self.by_tenant = false;
        self
    }
}

/// Sliding window counter for rate limiting
#[derive(Debug)]
struct WindowCounter {
    /// Timestamps of requests within the window
    requests: Vec<Instant>,
    /// Maximum requests allowed
    max_requests: u32,
    /// Window duration
    window: Duration,
}

impl WindowCounter {
    fn new(max_requests: u32, window: Duration) -> Self {
        Self {
            requests: Vec::with_capacity(max_requests as usize),
            max_requests,
            window,
        }
    }

    /// Try to record a request, returns true if allowed
    fn try_request(&mut self) -> bool {
        let now = Instant::now();
        let cutoff = now - self.window;

        // Remove expired requests
        self.requests.retain(|&t| t > cutoff);

        // Check if under limit
        if self.requests.len() < self.max_requests as usize {
            self.requests.push(now);
            true
        } else {
            false
        }
    }

    /// Get remaining requests in current window
    fn remaining(&self) -> u32 {
        let now = Instant::now();
        let cutoff = now - self.window;
        let current = self.requests.iter().filter(|&&t| t > cutoff).count();
        self.max_requests.saturating_sub(current as u32)
    }

    /// Get time until window resets (in seconds)
    fn reset_after(&self) -> u64 {
        if self.requests.is_empty() {
            return 0;
        }

        let oldest = self.requests.iter().min().unwrap();
        let reset_time = *oldest + self.window;
        let now = Instant::now();

        if reset_time > now {
            (reset_time - now).as_secs()
        } else {
            0
        }
    }
}

/// In-memory rate limiter store
#[derive(Debug)]
pub struct RateLimiterStore {
    counters: HashMap<String, WindowCounter>,
    last_cleanup: Instant,
}

impl Default for RateLimiterStore {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiterStore {
    pub fn new() -> Self {
        Self {
            counters: HashMap::new(),
            last_cleanup: Instant::now(),
        }
    }

    /// Try to record a request for the given key
    fn try_request(&mut self, key: &str, config: &RateLimitConfig) -> (bool, u32, u64) {
        // Periodic cleanup of stale entries
        if self.last_cleanup.elapsed() > Duration::from_secs(60) {
            self.cleanup(config.window);
        }

        let counter = self
            .counters
            .entry(key.to_string())
            .or_insert_with(|| WindowCounter::new(config.max_requests, config.window));

        let allowed = counter.try_request();
        let remaining = counter.remaining();
        let reset_after = counter.reset_after();

        (allowed, remaining, reset_after)
    }

    /// Remove stale counters
    fn cleanup(&mut self, window: Duration) {
        let cutoff = Instant::now() - window - Duration::from_secs(1);
        self.counters
            .retain(|_, counter| counter.requests.iter().any(|&t| t > cutoff));
        self.last_cleanup = Instant::now();
    }
}

/// Shared rate limiter state
pub type RateLimiter = Arc<RwLock<RateLimiterStore>>;

/// Create a new rate limiter
pub fn create_rate_limiter() -> RateLimiter {
    Arc::new(RwLock::new(RateLimiterStore::new()))
}

/// Rate limiting middleware
pub async fn rate_limit_middleware(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    // Get rate limiter from app state or create default config
    let config = RateLimitConfig::per_minute(100);
    let limiter = state.rate_limiter.clone();

    // Determine the key for rate limiting
    // Use tenant ID from auth context (set by auth middleware)
    let key = request
        .extensions()
        .get::<AuthContext>()
        .map(|ctx| format!("tenant:{}", ctx.tenant_id))
        .unwrap_or_else(|| "unknown".to_string());

    // Check rate limit
    let (allowed, remaining, reset_after) = {
        let mut store = limiter.write().await;
        store.try_request(&key, &config)
    };

    if !allowed {
        warn!(
            key = %key,
            remaining = remaining,
            reset_after = reset_after,
            "Rate limit exceeded"
        );

        return (
            StatusCode::TOO_MANY_REQUESTS,
            [
                ("X-RateLimit-Limit", config.max_requests.to_string()),
                ("X-RateLimit-Remaining", "0".to_string()),
                ("X-RateLimit-Reset", reset_after.to_string()),
                ("Retry-After", reset_after.to_string()),
            ],
            Json(json!({
                "error": {
                    "code": "RATE_LIMIT_EXCEEDED",
                    "message": "Too many requests. Please retry later.",
                    "retry_after": reset_after
                }
            })),
        )
            .into_response();
    }

    debug!(
        key = %key,
        remaining = remaining,
        "Rate limit check passed"
    );

    // Add rate limit headers to response
    let mut response = next.run(request).await;

    let headers = response.headers_mut();
    headers.insert(
        "X-RateLimit-Limit",
        config.max_requests.to_string().parse().unwrap(),
    );
    headers.insert(
        "X-RateLimit-Remaining",
        remaining.to_string().parse().unwrap(),
    );
    headers.insert(
        "X-RateLimit-Reset",
        reset_after.to_string().parse().unwrap(),
    );

    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_counter_allows_under_limit() {
        let mut counter = WindowCounter::new(5, Duration::from_secs(60));

        for _ in 0..5 {
            assert!(counter.try_request());
        }
        assert!(!counter.try_request()); // 6th should fail
    }

    #[test]
    fn test_window_counter_remaining() {
        let mut counter = WindowCounter::new(10, Duration::from_secs(60));

        assert_eq!(counter.remaining(), 10);
        counter.try_request();
        assert_eq!(counter.remaining(), 9);
    }

    #[test]
    fn test_rate_limiter_store() {
        let mut store = RateLimiterStore::new();
        let config = RateLimitConfig::per_minute(3);

        // First 3 requests should pass
        for i in 0..3 {
            let (allowed, remaining, _) = store.try_request("test_key", &config);
            assert!(allowed, "Request {} should be allowed", i);
            assert_eq!(remaining, 2 - i as u32);
        }

        // 4th request should fail
        let (allowed, remaining, _) = store.try_request("test_key", &config);
        assert!(!allowed);
        assert_eq!(remaining, 0);
    }

    #[test]
    fn test_different_keys_independent() {
        let mut store = RateLimiterStore::new();
        let config = RateLimitConfig::per_minute(2);

        // Use up key1's limit
        store.try_request("key1", &config);
        store.try_request("key1", &config);
        let (allowed, _, _) = store.try_request("key1", &config);
        assert!(!allowed);

        // key2 should still work
        let (allowed, _, _) = store.try_request("key2", &config);
        assert!(allowed);
    }
}
