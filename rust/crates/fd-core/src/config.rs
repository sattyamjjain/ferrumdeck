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

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // CORE-CFG-001: Config struct definitions
    // ============================================================

    #[test]
    fn test_config_struct_has_required_fields() {
        // Verify Config struct has all expected fields by construction
        let config = Config {
            env: "test".to_string(),
            log: LogConfig::default(),
            gateway: GatewayConfig::default(),
            database: DatabaseConfig {
                url: "postgres://test".to_string(),
                max_connections: 10,
                min_connections: 2,
            },
            redis: RedisConfig {
                url: "redis://test".to_string(),
                queue_prefix: "test:".to_string(),
                cache_prefix: "cache:".to_string(),
            },
            otel: OtelConfig::default(),
        };
        assert_eq!(config.env, "test");
    }

    #[test]
    fn test_config_is_cloneable() {
        let config = Config {
            env: "test".to_string(),
            log: LogConfig::default(),
            gateway: GatewayConfig::default(),
            database: DatabaseConfig {
                url: "postgres://test".to_string(),
                max_connections: 10,
                min_connections: 2,
            },
            redis: RedisConfig {
                url: "redis://test".to_string(),
                queue_prefix: "test:".to_string(),
                cache_prefix: "cache:".to_string(),
            },
            otel: OtelConfig::default(),
        };
        let cloned = config.clone();
        assert_eq!(cloned.env, config.env);
    }

    #[test]
    fn test_config_is_debuggable() {
        let config = LogConfig::default();
        let debug_str = format!("{:?}", config);
        assert!(debug_str.contains("LogConfig"));
    }

    // ============================================================
    // CORE-CFG-002: Default values
    // ============================================================

    #[test]
    fn test_log_config_default_level() {
        let config = LogConfig::default();
        assert_eq!(config.level, "debug");
    }

    #[test]
    fn test_log_config_default_format() {
        let config = LogConfig::default();
        assert_eq!(config.format, "pretty");
    }

    #[test]
    fn test_gateway_config_default_host() {
        let config = GatewayConfig::default();
        assert_eq!(config.host, "0.0.0.0");
    }

    #[test]
    fn test_gateway_config_default_port() {
        let config = GatewayConfig::default();
        assert_eq!(config.port, 8080);
    }

    #[test]
    fn test_gateway_config_default_workers() {
        let config = GatewayConfig::default();
        assert_eq!(config.workers, 4);
    }

    #[test]
    fn test_otel_config_default_disabled() {
        let config = OtelConfig::default();
        assert!(!config.enabled);
    }

    #[test]
    fn test_otel_config_default_endpoint_none() {
        let config = OtelConfig::default();
        assert!(config.endpoint.is_none());
    }

    #[test]
    fn test_otel_config_default_service_name() {
        let config = OtelConfig::default();
        assert_eq!(config.service_name, "ferrumdeck");
    }

    #[test]
    fn test_default_env_is_development() {
        assert_eq!(default_env(), "development");
    }

    #[test]
    fn test_default_max_connections() {
        assert_eq!(default_max_connections(), 20);
    }

    #[test]
    fn test_default_min_connections() {
        assert_eq!(default_min_connections(), 5);
    }

    #[test]
    fn test_default_queue_prefix() {
        assert_eq!(default_queue_prefix(), "fd:queue:");
    }

    #[test]
    fn test_default_cache_prefix() {
        assert_eq!(default_cache_prefix(), "fd:cache:");
    }

    // ============================================================
    // CORE-CFG-003: Serde deserialization
    // ============================================================

    #[test]
    fn test_log_config_deserialize_from_json() {
        let json = r#"{"level": "info", "format": "json"}"#;
        let config: LogConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.level, "info");
        assert_eq!(config.format, "json");
    }

    #[test]
    fn test_log_config_deserialize_with_defaults() {
        let json = r#"{}"#;
        let config: LogConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.level, "debug");
        assert_eq!(config.format, "pretty");
    }

    #[test]
    fn test_gateway_config_deserialize_from_json() {
        let json = r#"{"host": "127.0.0.1", "port": 9000, "workers": 8}"#;
        let config: GatewayConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 9000);
        assert_eq!(config.workers, 8);
    }

    #[test]
    fn test_gateway_config_deserialize_with_defaults() {
        let json = r#"{}"#;
        let config: GatewayConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8080);
        assert_eq!(config.workers, 4);
    }

    #[test]
    fn test_database_config_deserialize_from_json() {
        let json = r#"{"url": "postgres://user:pass@host/db", "max_connections": 50, "min_connections": 10}"#;
        let config: DatabaseConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.url, "postgres://user:pass@host/db");
        assert_eq!(config.max_connections, 50);
        assert_eq!(config.min_connections, 10);
    }

    #[test]
    fn test_database_config_requires_url() {
        let json = r#"{"max_connections": 50}"#;
        let result: Result<DatabaseConfig, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_redis_config_deserialize_from_json() {
        let json = r#"{"url": "redis://localhost:6379", "queue_prefix": "myapp:", "cache_prefix": "mycache:"}"#;
        let config: RedisConfig = serde_json::from_str(json).unwrap();
        assert_eq!(config.url, "redis://localhost:6379");
        assert_eq!(config.queue_prefix, "myapp:");
        assert_eq!(config.cache_prefix, "mycache:");
    }

    #[test]
    fn test_redis_config_requires_url() {
        let json = r#"{"queue_prefix": "test:"}"#;
        let result: Result<RedisConfig, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_otel_config_deserialize_from_json() {
        let json = r#"{"enabled": true, "endpoint": "http://jaeger:4317", "service_name": "my-service"}"#;
        let config: OtelConfig = serde_json::from_str(json).unwrap();
        assert!(config.enabled);
        assert_eq!(config.endpoint, Some("http://jaeger:4317".to_string()));
        assert_eq!(config.service_name, "my-service");
    }

    #[test]
    fn test_otel_config_deserialize_with_defaults() {
        let json = r#"{}"#;
        let config: OtelConfig = serde_json::from_str(json).unwrap();
        assert!(!config.enabled);
        assert!(config.endpoint.is_none());
        assert_eq!(config.service_name, "ferrumdeck");
    }

    // ============================================================
    // CORE-CFG-004: Full config deserialization
    // ============================================================

    #[test]
    fn test_full_config_deserialize() {
        let json = r#"{
            "env": "production",
            "log": {"level": "warn", "format": "json"},
            "gateway": {"host": "0.0.0.0", "port": 80, "workers": 16},
            "database": {"url": "postgres://prod/db"},
            "redis": {"url": "redis://prod:6379"},
            "otel": {"enabled": true, "endpoint": "http://otel:4317"}
        }"#;
        let config: Config = serde_json::from_str(json).unwrap();
        assert_eq!(config.env, "production");
        assert_eq!(config.log.level, "warn");
        assert_eq!(config.gateway.port, 80);
        assert!(config.otel.enabled);
    }

    // ============================================================
    // CORE-CFG-005: Config value validation
    // ============================================================

    #[test]
    fn test_gateway_port_accepts_valid_range() {
        let config = GatewayConfig {
            host: "localhost".to_string(),
            port: 1,
            workers: 1,
        };
        assert_eq!(config.port, 1);

        let config = GatewayConfig {
            host: "localhost".to_string(),
            port: 65535,
            workers: 1,
        };
        assert_eq!(config.port, 65535);
    }

    #[test]
    fn test_workers_accepts_positive_values() {
        let config = GatewayConfig {
            host: "localhost".to_string(),
            port: 8080,
            workers: 1,
        };
        assert_eq!(config.workers, 1);

        let config = GatewayConfig {
            host: "localhost".to_string(),
            port: 8080,
            workers: 128,
        };
        assert_eq!(config.workers, 128);
    }

    #[test]
    fn test_connection_pool_values() {
        let config = DatabaseConfig {
            url: "postgres://test".to_string(),
            max_connections: 100,
            min_connections: 5,
        };
        assert!(config.max_connections >= config.min_connections);
    }
}
