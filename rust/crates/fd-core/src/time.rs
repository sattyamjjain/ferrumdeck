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
