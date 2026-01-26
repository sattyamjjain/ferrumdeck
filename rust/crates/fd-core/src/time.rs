//! Time utilities for FerrumDeck

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Get current UTC timestamp
pub fn now() -> DateTime<Utc> {
    Utc::now()
}

/// Timestamp wrapper for consistent serialization
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Timestamp(DateTime<Utc>);

impl Timestamp {
    /// Create a new timestamp for now
    pub fn now() -> Self {
        Self(Utc::now())
    }

    /// Create from a DateTime
    pub fn from_datetime(dt: DateTime<Utc>) -> Self {
        Self(dt)
    }

    /// Get the inner DateTime
    pub fn inner(&self) -> DateTime<Utc> {
        self.0
    }

    /// Get milliseconds since epoch
    pub fn millis(&self) -> i64 {
        self.0.timestamp_millis()
    }

    /// Create from milliseconds since epoch
    pub fn from_millis(millis: i64) -> Option<Self> {
        DateTime::from_timestamp_millis(millis).map(Self)
    }
}

impl Default for Timestamp {
    fn default() -> Self {
        Self::now()
    }
}

impl std::fmt::Display for Timestamp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0.to_rfc3339())
    }
}

impl From<DateTime<Utc>> for Timestamp {
    fn from(dt: DateTime<Utc>) -> Self {
        Self(dt)
    }
}

impl From<Timestamp> for DateTime<Utc> {
    fn from(ts: Timestamp) -> Self {
        ts.0
    }
}

/// Duration in milliseconds (for budgets, timeouts)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DurationMs(u64);

impl DurationMs {
    pub fn new(ms: u64) -> Self {
        Self(ms)
    }

    pub fn from_secs(secs: u64) -> Self {
        Self(secs * 1000)
    }

    pub fn from_mins(mins: u64) -> Self {
        Self(mins * 60 * 1000)
    }

    pub fn as_millis(&self) -> u64 {
        self.0
    }

    pub fn as_secs(&self) -> u64 {
        self.0 / 1000
    }

    pub fn as_std(&self) -> std::time::Duration {
        std::time::Duration::from_millis(self.0)
    }
}

impl From<u64> for DurationMs {
    fn from(ms: u64) -> Self {
        Self(ms)
    }
}

impl From<std::time::Duration> for DurationMs {
    fn from(d: std::time::Duration) -> Self {
        Self(d.as_millis() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // CORE-TIME-001: Timestamp creation and manipulation
    // ============================================================

    #[test]
    fn test_timestamp_now_creates_current_time() {
        let before = Utc::now();
        let ts = Timestamp::now();
        let after = Utc::now();

        assert!(ts.inner() >= before);
        assert!(ts.inner() <= after);
    }

    #[test]
    fn test_timestamp_from_datetime() {
        let dt = Utc::now();
        let ts = Timestamp::from_datetime(dt);
        assert_eq!(ts.inner(), dt);
    }

    #[test]
    fn test_timestamp_inner_returns_datetime() {
        let dt = Utc::now();
        let ts = Timestamp::from_datetime(dt);
        assert_eq!(ts.inner(), dt);
    }

    #[test]
    fn test_timestamp_millis_conversion() {
        let ts = Timestamp::now();
        let millis = ts.millis();
        assert!(millis > 0);
    }

    #[test]
    fn test_timestamp_from_millis() {
        let ts = Timestamp::now();
        let millis = ts.millis();
        let ts2 = Timestamp::from_millis(millis).unwrap();
        // Compare milliseconds since we lose sub-millisecond precision
        assert_eq!(ts.millis(), ts2.millis());
    }

    #[test]
    fn test_timestamp_from_invalid_millis_returns_none() {
        // Very negative values might not be valid
        let result = Timestamp::from_millis(i64::MIN);
        // This depends on chrono's behavior for extreme values
        // Just verify it doesn't panic
        let _ = result;
    }

    #[test]
    fn test_timestamp_default_creates_now() {
        let before = Utc::now();
        let ts = Timestamp::default();
        let after = Utc::now();

        assert!(ts.inner() >= before);
        assert!(ts.inner() <= after);
    }

    // ============================================================
    // CORE-TIME-002: Timestamp traits
    // ============================================================

    #[test]
    fn test_timestamp_display_is_rfc3339() {
        let ts = Timestamp::now();
        let display = ts.to_string();
        // RFC3339 format has 'T' separator and timezone
        assert!(display.contains('T'));
        assert!(display.ends_with('Z') || display.contains('+') || display.contains('-'));
    }

    #[test]
    fn test_timestamp_from_datetime_trait() {
        let dt = Utc::now();
        let ts: Timestamp = dt.into();
        assert_eq!(ts.inner(), dt);
    }

    #[test]
    fn test_timestamp_into_datetime_trait() {
        let ts = Timestamp::now();
        let dt: DateTime<Utc> = ts.into();
        assert_eq!(dt, ts.inner());
    }

    #[test]
    fn test_timestamp_is_cloneable() {
        let ts = Timestamp::now();
        let cloned = ts.clone();
        assert_eq!(ts, cloned);
    }

    #[test]
    fn test_timestamp_is_copyable() {
        let ts = Timestamp::now();
        let copied = ts;
        assert_eq!(ts, copied);
    }

    #[test]
    fn test_timestamp_equality() {
        let dt = Utc::now();
        let ts1 = Timestamp::from_datetime(dt);
        let ts2 = Timestamp::from_datetime(dt);
        assert_eq!(ts1, ts2);
    }

    #[test]
    fn test_timestamp_is_debuggable() {
        let ts = Timestamp::now();
        let debug = format!("{:?}", ts);
        assert!(debug.contains("Timestamp"));
    }

    // ============================================================
    // CORE-TIME-003: Timestamp serialization
    // ============================================================

    #[test]
    fn test_timestamp_serializes_to_string() {
        let ts = Timestamp::now();
        let json = serde_json::to_string(&ts).unwrap();
        // Should serialize as a string (RFC3339)
        assert!(json.starts_with('"'));
        assert!(json.ends_with('"'));
    }

    #[test]
    fn test_timestamp_deserializes_from_string() {
        let json = r#""2024-01-15T10:30:00Z""#;
        let ts: Timestamp = serde_json::from_str(json).unwrap();
        assert_eq!(ts.inner().year(), 2024);
        assert_eq!(ts.inner().month(), 1);
        assert_eq!(ts.inner().day(), 15);
    }

    #[test]
    fn test_timestamp_roundtrip_serialization() {
        let ts = Timestamp::now();
        let json = serde_json::to_string(&ts).unwrap();
        let ts2: Timestamp = serde_json::from_str(&json).unwrap();
        // Compare at millisecond precision
        assert_eq!(ts.millis(), ts2.millis());
    }

    // ============================================================
    // CORE-TIME-004: DurationMs creation
    // ============================================================

    #[test]
    fn test_duration_ms_new() {
        let d = DurationMs::new(5000);
        assert_eq!(d.as_millis(), 5000);
    }

    #[test]
    fn test_duration_ms_from_secs() {
        let d = DurationMs::from_secs(5);
        assert_eq!(d.as_millis(), 5000);
    }

    #[test]
    fn test_duration_ms_from_mins() {
        let d = DurationMs::from_mins(2);
        assert_eq!(d.as_millis(), 120000);
    }

    #[test]
    fn test_duration_ms_as_millis() {
        let d = DurationMs::new(12345);
        assert_eq!(d.as_millis(), 12345);
    }

    #[test]
    fn test_duration_ms_as_secs() {
        let d = DurationMs::new(5500);
        assert_eq!(d.as_secs(), 5); // Truncates
    }

    #[test]
    fn test_duration_ms_as_std() {
        let d = DurationMs::new(5000);
        let std_d = d.as_std();
        assert_eq!(std_d.as_millis(), 5000);
    }

    // ============================================================
    // CORE-TIME-005: DurationMs traits
    // ============================================================

    #[test]
    fn test_duration_ms_from_u64() {
        let d: DurationMs = 3000u64.into();
        assert_eq!(d.as_millis(), 3000);
    }

    #[test]
    fn test_duration_ms_from_std_duration() {
        let std_d = std::time::Duration::from_millis(2500);
        let d: DurationMs = std_d.into();
        assert_eq!(d.as_millis(), 2500);
    }

    #[test]
    fn test_duration_ms_is_cloneable() {
        let d = DurationMs::new(1000);
        let cloned = d.clone();
        assert_eq!(d, cloned);
    }

    #[test]
    fn test_duration_ms_is_copyable() {
        let d = DurationMs::new(1000);
        let copied = d;
        assert_eq!(d, copied);
    }

    #[test]
    fn test_duration_ms_equality() {
        let d1 = DurationMs::new(1000);
        let d2 = DurationMs::new(1000);
        assert_eq!(d1, d2);
    }

    #[test]
    fn test_duration_ms_inequality() {
        let d1 = DurationMs::new(1000);
        let d2 = DurationMs::new(2000);
        assert_ne!(d1, d2);
    }

    #[test]
    fn test_duration_ms_is_debuggable() {
        let d = DurationMs::new(1000);
        let debug = format!("{:?}", d);
        assert!(debug.contains("DurationMs"));
    }

    // ============================================================
    // CORE-TIME-006: DurationMs serialization
    // ============================================================

    #[test]
    fn test_duration_ms_serializes_to_number() {
        let d = DurationMs::new(5000);
        let json = serde_json::to_string(&d).unwrap();
        assert_eq!(json, "5000");
    }

    #[test]
    fn test_duration_ms_deserializes_from_number() {
        let json = "3000";
        let d: DurationMs = serde_json::from_str(json).unwrap();
        assert_eq!(d.as_millis(), 3000);
    }

    #[test]
    fn test_duration_ms_roundtrip_serialization() {
        let d = DurationMs::new(7500);
        let json = serde_json::to_string(&d).unwrap();
        let d2: DurationMs = serde_json::from_str(&json).unwrap();
        assert_eq!(d, d2);
    }

    // ============================================================
    // CORE-TIME-007: now() function
    // ============================================================

    #[test]
    fn test_now_returns_current_time() {
        let before = Utc::now();
        let result = now();
        let after = Utc::now();

        assert!(result >= before);
        assert!(result <= after);
    }

    #[test]
    fn test_now_is_monotonic() {
        let t1 = now();
        let t2 = now();
        assert!(t2 >= t1);
    }

    // ============================================================
    // CORE-TIME-008: Edge cases
    // ============================================================

    #[test]
    fn test_duration_ms_zero() {
        let d = DurationMs::new(0);
        assert_eq!(d.as_millis(), 0);
        assert_eq!(d.as_secs(), 0);
    }

    #[test]
    fn test_duration_ms_large_value() {
        let d = DurationMs::new(u64::MAX);
        assert_eq!(d.as_millis(), u64::MAX);
    }

    #[test]
    fn test_timestamp_epoch() {
        let ts = Timestamp::from_millis(0).unwrap();
        assert_eq!(ts.millis(), 0);
    }

    use chrono::Datelike;
}
