//! Configuration management for FerrumDeck

use serde::Deserialize;

/// Main application configuration
#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    /// Environment (development, staging, production)
    #[serde(default = "default_env")]
    pub env: String,

    /// Logging configuration
    #[serde(default)]
    pub log: LogConfig,

    /// Gateway configuration
    #[serde(default)]
    pub gateway: GatewayConfig,

    /// Database configuration
    pub database: DatabaseConfig,

    /// Redis configuration
    pub redis: RedisConfig,

    /// OpenTelemetry configuration
    #[serde(default)]
    pub otel: OtelConfig,
}

#[derive(Debug, Clone, Deserialize)]
pub struct LogConfig {
    #[serde(default = "default_log_level")]
    pub level: String,

    #[serde(default = "default_log_format")]
    pub format: String,
}

impl Default for LogConfig {
    fn default() -> Self {
        Self {
            level: default_log_level(),
            format: default_log_format(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GatewayConfig {
    #[serde(default = "default_host")]
    pub host: String,

    #[serde(default = "default_port")]
    pub port: u16,

    #[serde(default = "default_workers")]
    pub workers: usize,
}

impl Default for GatewayConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            workers: default_workers(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DatabaseConfig {
    pub url: String,

    #[serde(default = "default_max_connections")]
    pub max_connections: u32,

    #[serde(default = "default_min_connections")]
    pub min_connections: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedisConfig {
    pub url: String,

    #[serde(default = "default_queue_prefix")]
    pub queue_prefix: String,

    #[serde(default = "default_cache_prefix")]
    pub cache_prefix: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct OtelConfig {
    #[serde(default)]
    pub enabled: bool,

    pub endpoint: Option<String>,

    #[serde(default = "default_service_name")]
    pub service_name: String,
}

impl Default for OtelConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            endpoint: None,
            service_name: default_service_name(),
        }
    }
}

// Default value functions
fn default_env() -> String {
    "development".to_string()
}
fn default_log_level() -> String {
    "debug".to_string()
}
fn default_log_format() -> String {
    "pretty".to_string()
}
fn default_host() -> String {
    "0.0.0.0".to_string()
}
fn default_port() -> u16 {
    8080
}
fn default_workers() -> usize {
    4
}
fn default_max_connections() -> u32 {
    20
}
fn default_min_connections() -> u32 {
    5
}
fn default_queue_prefix() -> String {
    "fd:queue:".to_string()
}
fn default_cache_prefix() -> String {
    "fd:cache:".to_string()
}
fn default_service_name() -> String {
    "ferrumdeck".to_string()
}

impl Config {
    /// Load configuration from environment and optional file
    pub fn load() -> Result<Self, config::ConfigError> {
        // Load .env file if present
        let _ = dotenvy::dotenv();

        let builder = config::Config::builder()
            // Set defaults
            .set_default("env", "development")?
            // Load from environment with FERRUMDECK_ prefix
            .add_source(
                config::Environment::with_prefix("FERRUMDECK")
                    .separator("_")
                    .try_parsing(true),
            )
            // Database from DATABASE_URL
            .add_source(
                config::Environment::default()
                    .prefix("DATABASE")
                    .separator("_"),
            )
            // Redis from REDIS_URL
            .add_source(
                config::Environment::default()
                    .prefix("REDIS")
                    .separator("_"),
            )
            // Gateway from GATEWAY_
            .add_source(
                config::Environment::default()
                    .prefix("GATEWAY")
                    .separator("_"),
            )
            // OTel from OTEL_
            .add_source(config::Environment::default().prefix("OTEL").separator("_"));

        builder.build()?.try_deserialize()
    }
}
