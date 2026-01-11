//! Data exfiltration shield
//!
//! Protects against unauthorized network access:
//! - Domain whitelist for network tools
//! - Blocks raw IP addresses (prevents C2 connections)
//! - Detects suspicious URL patterns

use super::config::ExfiltrationConfig;
use super::inspector::{AirlockViolation, RiskLevel, ViolationType};
use regex::Regex;
use std::net::IpAddr;
use std::sync::OnceLock;
use tracing::debug;

/// Get URL extraction regex (compiled once)
fn get_url_regex() -> &'static Regex {
    static URL_REGEX: OnceLock<Regex> = OnceLock::new();
    URL_REGEX.get_or_init(|| {
        // Match http:// or https:// URLs
        Regex::new(r#"https?://([^/\s:'"]+)(:\d+)?(/[^\s'"]*)?"#).unwrap()
    })
}

/// Get IP address regex (compiled once)
fn get_ip_regex() -> &'static Regex {
    static IP_REGEX: OnceLock<Regex> = OnceLock::new();
    IP_REGEX.get_or_init(|| {
        // Match IPv4 addresses
        Regex::new(r#"^(\d{1,3}\.){3}\d{1,3}$"#).unwrap()
    })
}

/// Data exfiltration shield
pub struct ExfiltrationShield {
    target_tools: Vec<String>,
    allowed_domains: Vec<String>,
    block_ip_addresses: bool,
}

impl ExfiltrationShield {
    /// Create a new exfiltration shield from config
    pub fn new(config: &ExfiltrationConfig) -> Self {
        Self {
            target_tools: config.target_tools.clone(),
            allowed_domains: config
                .allowed_domains
                .iter()
                .map(|d| d.to_lowercase())
                .collect(),
            block_ip_addresses: config.block_ip_addresses,
        }
    }

    /// Check if this tool should be inspected
    fn should_inspect(&self, tool_name: &str) -> bool {
        self.target_tools.iter().any(|t| t == tool_name)
    }

    /// Check if a domain is allowed
    fn is_domain_allowed(&self, domain: &str) -> bool {
        let domain = domain.to_lowercase();

        // If no whitelist configured, allow all domains
        if self.allowed_domains.is_empty() {
            return true;
        }

        // Check exact match and subdomain match
        self.allowed_domains
            .iter()
            .any(|allowed| domain == *allowed || domain.ends_with(&format!(".{}", allowed)))
    }

    /// Check if a string is an IP address
    fn is_ip_address(host: &str) -> bool {
        // Try to parse as IP address
        host.parse::<IpAddr>().is_ok() || get_ip_regex().is_match(host)
    }

    /// Extract URLs from JSON value
    fn extract_urls(value: &serde_json::Value) -> Vec<String> {
        let mut urls = Vec::new();

        match value {
            serde_json::Value::String(s) => {
                // Extract URLs from string content
                for cap in get_url_regex().captures_iter(s) {
                    urls.push(cap[0].to_string());
                }
            }
            serde_json::Value::Array(arr) => {
                for item in arr {
                    urls.extend(Self::extract_urls(item));
                }
            }
            serde_json::Value::Object(obj) => {
                // Special handling for common URL fields
                if let Some(serde_json::Value::String(url)) = obj.get("url") {
                    urls.push(url.clone());
                }
                if let Some(serde_json::Value::String(url)) = obj.get("endpoint") {
                    urls.push(url.clone());
                }
                if let Some(serde_json::Value::String(url)) = obj.get("webhook") {
                    urls.push(url.clone());
                }
                if let Some(serde_json::Value::String(url)) = obj.get("callback") {
                    urls.push(url.clone());
                }

                // Recursively check all values
                for v in obj.values() {
                    urls.extend(Self::extract_urls(v));
                }
            }
            _ => {}
        }

        urls
    }

    /// Extract domain from URL
    fn extract_domain(url: &str) -> Option<String> {
        // Strip protocol
        let url = url
            .strip_prefix("http://")
            .or_else(|| url.strip_prefix("https://"))?;

        // Get host part (before path)
        let host = url.split('/').next()?;

        // Remove port
        let host = host.split(':').next()?;

        Some(host.to_string())
    }

    /// Check tool input for exfiltration attempts
    pub fn check(
        &self,
        tool_name: &str,
        tool_input: &serde_json::Value,
    ) -> Option<AirlockViolation> {
        if !self.should_inspect(tool_name) {
            return None;
        }

        let urls = Self::extract_urls(tool_input);

        for url in urls {
            if let Some(domain) = Self::extract_domain(&url) {
                // Check for IP address (potential C2 connection)
                if self.block_ip_addresses && Self::is_ip_address(&domain) {
                    debug!(
                        tool = tool_name,
                        ip = domain,
                        "IP address detected in network call"
                    );

                    return Some(AirlockViolation {
                        violation_type: ViolationType::IpAddressUsed,
                        risk_score: 80,
                        risk_level: RiskLevel::High,
                        details: format!(
                            "Direct IP address used instead of domain: {}. \
                             This could be an attempt to bypass DNS-based security controls.",
                            domain
                        ),
                        trigger: format!("ip_address:{}", domain),
                    });
                }

                // Check domain whitelist
                if !self.is_domain_allowed(&domain) {
                    debug!(
                        tool = tool_name,
                        domain = domain,
                        "Unauthorized domain detected"
                    );

                    return Some(AirlockViolation {
                        violation_type: ViolationType::ExfiltrationAttempt,
                        risk_score: 85,
                        risk_level: RiskLevel::Critical,
                        details: format!(
                            "Unauthorized network destination: {}. \
                             Add this domain to the allowed list if this is expected behavior.",
                            domain
                        ),
                        trigger: format!("unauthorized_domain:{}", domain),
                    });
                }
            }
        }

        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_shield_with_whitelist(domains: Vec<&str>) -> ExfiltrationShield {
        ExfiltrationShield::new(&ExfiltrationConfig {
            enabled: true,
            target_tools: vec![
                "http_get".to_string(),
                "curl".to_string(),
                "fetch".to_string(),
            ],
            allowed_domains: domains.into_iter().map(String::from).collect(),
            block_ip_addresses: true,
        })
    }

    fn create_shield_no_whitelist() -> ExfiltrationShield {
        ExfiltrationShield::new(&ExfiltrationConfig {
            enabled: true,
            target_tools: vec!["http_get".to_string()],
            allowed_domains: vec![],
            block_ip_addresses: true,
        })
    }

    #[test]
    fn test_allowed_domain() {
        let shield = create_shield_with_whitelist(vec!["github.com", "api.anthropic.com"]);

        let input = serde_json::json!({
            "url": "https://api.github.com/repos/test/repo"
        });

        let result = shield.check("http_get", &input);
        assert!(result.is_none());
    }

    #[test]
    fn test_subdomain_allowed() {
        let shield = create_shield_with_whitelist(vec!["github.com"]);

        let input = serde_json::json!({
            "url": "https://api.github.com/v1/test"
        });

        let result = shield.check("http_get", &input);
        assert!(result.is_none());
    }

    #[test]
    fn test_unauthorized_domain() {
        let shield = create_shield_with_whitelist(vec!["github.com"]);

        let input = serde_json::json!({
            "url": "https://evil-server.com/steal-data"
        });

        let result = shield.check("http_get", &input);
        assert!(result.is_some());

        let violation = result.unwrap();
        assert_eq!(violation.violation_type, ViolationType::ExfiltrationAttempt);
        assert!(violation.details.contains("evil-server.com"));
    }

    #[test]
    fn test_ip_address_blocked() {
        let shield = create_shield_no_whitelist();

        let input = serde_json::json!({
            "url": "http://192.168.1.100:8080/api"
        });

        let result = shield.check("http_get", &input);
        assert!(result.is_some());

        let violation = result.unwrap();
        assert_eq!(violation.violation_type, ViolationType::IpAddressUsed);
    }

    #[test]
    fn test_localhost_ip_blocked() {
        let shield = create_shield_no_whitelist();

        let input = serde_json::json!({
            "endpoint": "http://127.0.0.1:3000/internal"
        });

        let result = shield.check("http_get", &input);
        assert!(result.is_some());

        let violation = result.unwrap();
        assert_eq!(violation.violation_type, ViolationType::IpAddressUsed);
    }

    #[test]
    fn test_no_whitelist_allows_domains() {
        let shield = create_shield_no_whitelist();

        let input = serde_json::json!({
            "url": "https://any-domain.com/api"
        });

        let result = shield.check("http_get", &input);
        // Should be None because no whitelist means all domains allowed
        assert!(result.is_none());
    }

    #[test]
    fn test_non_target_tool_skipped() {
        let shield = create_shield_with_whitelist(vec!["github.com"]);

        let input = serde_json::json!({
            "url": "https://evil.com/data"
        });

        // read_file is not a target tool
        let result = shield.check("read_file", &input);
        assert!(result.is_none());
    }

    #[test]
    fn test_url_extraction_from_nested_json() {
        let shield = create_shield_with_whitelist(vec!["allowed.com"]);

        let input = serde_json::json!({
            "config": {
                "endpoints": [
                    {"url": "https://blocked.io/api"}
                ]
            }
        });

        let result = shield.check("curl", &input);
        assert!(result.is_some());
    }

    #[test]
    fn test_multiple_urls_first_violation() {
        let shield = create_shield_with_whitelist(vec!["allowed.com"]);

        let input = serde_json::json!({
            "urls": [
                "https://allowed.com/ok",
                "https://blocked.io/bad",
                "https://also-blocked.io/bad"
            ]
        });

        let result = shield.check("http_get", &input);
        assert!(result.is_some());

        // Should catch the first violation
        let violation = result.unwrap();
        assert!(violation.details.contains("blocked.io"));
    }

    #[test]
    fn test_domain_extraction() {
        assert_eq!(
            ExfiltrationShield::extract_domain("https://example.com/path"),
            Some("example.com".to_string())
        );

        assert_eq!(
            ExfiltrationShield::extract_domain("http://api.example.com:8080/v1"),
            Some("api.example.com".to_string())
        );

        assert_eq!(
            ExfiltrationShield::extract_domain("https://192.168.1.1/api"),
            Some("192.168.1.1".to_string())
        );

        assert_eq!(ExfiltrationShield::extract_domain("not-a-url"), None);
    }

    #[test]
    fn test_is_ip_address() {
        assert!(ExfiltrationShield::is_ip_address("192.168.1.1"));
        assert!(ExfiltrationShield::is_ip_address("10.0.0.1"));
        assert!(ExfiltrationShield::is_ip_address("127.0.0.1"));
        assert!(ExfiltrationShield::is_ip_address("0.0.0.0"));

        assert!(!ExfiltrationShield::is_ip_address("example.com"));
        assert!(!ExfiltrationShield::is_ip_address("api.github.com"));
        assert!(!ExfiltrationShield::is_ip_address("192.168.1")); // Incomplete
    }

    #[test]
    fn test_case_insensitive_domain_matching() {
        let shield = create_shield_with_whitelist(vec!["GitHub.com"]);

        let input = serde_json::json!({
            "url": "https://GITHUB.COM/test"
        });

        let result = shield.check("http_get", &input);
        assert!(result.is_none()); // Should be allowed (case insensitive)
    }
}
