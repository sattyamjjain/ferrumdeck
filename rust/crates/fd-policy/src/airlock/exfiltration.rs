//! Data exfiltration shield
//!
//! Protects against unauthorized network access:
//! - Domain whitelist for network tools
//! - Blocks raw IP addresses (prevents C2 connections)
//! - Detects suspicious URL patterns
//! - **Credential DLP** scans outbound payloads for cloud keys / tokens /
//!   Luhn-valid PANs / mod-97-valid IBANs (see [`super::credential_dlp`]).
//! - **Per-domain data budget** caps cumulative outbound bytes per (run,
//!   domain) tuple; further dispatches to that domain are denied.

use super::config::ExfiltrationConfig;
use super::credential_dlp;
use super::inspector::{AirlockViolation, RiskLevel, ViolationType};
use regex::Regex;
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::OnceLock;
use tokio::sync::RwLock;
use tracing::{debug, warn};

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
    credential_dlp_enabled: bool,
    data_budget_per_domain_bytes: Option<u64>,
    /// Per-(run_id, domain) cumulative outbound bytes for the data budget.
    /// Reset via [`clear_run`](Self::clear_run) when a run finishes.
    egress: RwLock<HashMap<(String, String), u64>>,
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
            credential_dlp_enabled: config.credential_dlp_enabled,
            data_budget_per_domain_bytes: config.data_budget_per_domain_bytes,
            egress: RwLock::new(HashMap::new()),
        }
    }

    /// Estimate the outbound payload size in bytes — the serialised JSON
    /// length is a reasonable proxy for what a network tool would actually
    /// transmit. Counted at the boundary so the figure matches what an
    /// observer (gateway egress proxy, audit log) would see.
    pub fn estimate_payload_bytes(value: &serde_json::Value) -> u64 {
        serde_json::to_string(value)
            .map(|s| s.len() as u64)
            .unwrap_or(0)
    }

    /// Reads the cumulative bytes spent on (run, domain) without mutating.
    /// Tests + dashboard rollups can use this.
    pub async fn egress_bytes(&self, run_id: &str, domain: &str) -> u64 {
        self.egress
            .read()
            .await
            .get(&(run_id.to_string(), domain.to_string()))
            .copied()
            .unwrap_or(0)
    }

    /// Per-domain data budget check + record. Returns
    /// `Some(DataExfiltrationBudget)` violation when this call would push
    /// (run, domain) over budget; otherwise records the bytes and returns
    /// `None`. No-op (returns `None`) when no budget is configured.
    pub async fn check_and_record_egress(
        &self,
        run_id: &str,
        domain: &str,
        bytes: u64,
    ) -> Option<AirlockViolation> {
        let budget = self.data_budget_per_domain_bytes?;
        let key = (run_id.to_string(), domain.to_lowercase());
        let mut state = self.egress.write().await;
        let current = *state.get(&key).unwrap_or(&0);
        let prospective = current.saturating_add(bytes);
        if prospective > budget {
            warn!(
                run_id = run_id,
                domain = domain,
                current_bytes = current,
                pending_bytes = bytes,
                budget_bytes = budget,
                "egress data budget exceeded — denying further dispatches",
            );
            return Some(AirlockViolation {
                violation_type: ViolationType::DataExfiltrationBudget,
                risk_score: 80,
                risk_level: RiskLevel::High,
                details: format!(
                    "egress data budget exceeded for {} on run {}: {} (already sent) + {} (this call) > {} (budget)",
                    domain, run_id, current, bytes, budget
                ),
                trigger: format!("data_budget:{}", domain),
            });
        }
        state.insert(key, prospective);
        None
    }

    /// Clear per-run egress state. Call when a run terminates so the
    /// HashMap doesn't grow unbounded.
    pub async fn clear_run(&self, run_id: &str) {
        self.egress
            .write()
            .await
            .retain(|(rid, _), _| rid != run_id);
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
    pub(crate) fn extract_urls(value: &serde_json::Value) -> Vec<String> {
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
    pub(crate) fn extract_domain(url: &str) -> Option<String> {
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

    /// Check tool input for exfiltration attempts. Layered checks, returns
    /// the FIRST violation found:
    /// 1. Credential DLP (cloud key / token / Luhn PAN / mod-97 IBAN)
    /// 2. Raw IP destination
    /// 3. Unauthorized domain
    pub fn check(
        &self,
        tool_name: &str,
        tool_input: &serde_json::Value,
    ) -> Option<AirlockViolation> {
        if !self.should_inspect(tool_name) {
            return None;
        }

        // Layer 1 — credential DLP. Runs first so a leaked key never even
        // gets evaluated against the domain allowlist. If the LLM tries to
        // POST a Stripe key to an allow-listed host, this still fires.
        if self.credential_dlp_enabled {
            if let Some(cred) = credential_dlp::scan_json(tool_input) {
                warn!(
                    tool = tool_name,
                    credential_kind = cred.kind.as_str(),
                    redacted = %cred.redacted,
                    "credential DLP detected secret in outbound payload"
                );
                return Some(AirlockViolation {
                    violation_type: ViolationType::CredentialLeak,
                    risk_score: 95,
                    risk_level: RiskLevel::Critical,
                    details: format!(
                        "credential of kind `{}` detected in outbound payload (redacted: {}). \
                         Rotate the credential and remove it from the agent's reachable state.",
                        cred.kind.as_str(),
                        cred.redacted
                    ),
                    trigger: format!("credential_leak:{}", cred.kind.as_str()),
                });
            }
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
            credential_dlp_enabled: false,
            data_budget_per_domain_bytes: None,
        })
    }

    fn create_shield_no_whitelist() -> ExfiltrationShield {
        ExfiltrationShield::new(&ExfiltrationConfig {
            enabled: true,
            target_tools: vec!["http_get".to_string()],
            allowed_domains: vec![],
            block_ip_addresses: true,
            credential_dlp_enabled: false,
            data_budget_per_domain_bytes: None,
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

    // =========================================================================
    // Egress-DLP additions
    // =========================================================================

    fn shield_with_dlp_and_budget(domains: Vec<&str>, budget: Option<u64>) -> ExfiltrationShield {
        ExfiltrationShield::new(&ExfiltrationConfig {
            enabled: true,
            target_tools: vec!["http_post".to_string(), "http_get".to_string()],
            allowed_domains: domains.into_iter().map(String::from).collect(),
            block_ip_addresses: true,
            credential_dlp_enabled: true,
            data_budget_per_domain_bytes: budget,
        })
    }

    #[test]
    fn leaked_aws_key_denied_and_logged() {
        let shield = shield_with_dlp_and_budget(vec!["api.example.com"], None);
        // Allow-listed destination but payload contains a high-confidence
        // AWS access key id — credential DLP must fire BEFORE the domain
        // check would have approved.
        let input = serde_json::json!({
            "url": "https://api.example.com/v1/upload",
            "body": "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE"
        });

        let violation = shield
            .check("http_post", &input)
            .expect("AWS key in body must be caught");
        assert_eq!(violation.violation_type, ViolationType::CredentialLeak);
        assert_eq!(violation.risk_level, RiskLevel::Critical);
        assert!(violation.trigger.contains("aws_access_key_id"));
        // Audit detail must include the kind + redacted form, never the raw key.
        assert!(violation.details.contains("aws_access_key_id"));
        assert!(!violation.details.contains("IOSFODNN7"));
    }

    #[test]
    fn non_luhn_sixteen_digits_not_flagged_as_card() {
        let shield = shield_with_dlp_and_budget(vec!["api.example.com"], None);
        // 16 digits that fail Luhn — must NOT be flagged. The prompt's
        // explicit false-positive case for the credit-card pattern.
        let input = serde_json::json!({
            "url": "https://api.example.com/log",
            "body": "trace_id=1234567890123456 — arbitrary correlation id"
        });

        // The whole call should pass cleanly: clean payload + allowed domain.
        assert!(shield.check("http_post", &input).is_none());
    }

    #[tokio::test]
    async fn data_budget_exceedance_kills_the_run() {
        // 1 KiB budget. Each call uploads ~600 bytes. Second call exceeds.
        let shield = shield_with_dlp_and_budget(vec!["api.example.com"], Some(1024));
        let run = "run_01HABCDEFG";
        let domain = "api.example.com";

        // First call: 600 bytes → recorded, allowed.
        assert!(shield
            .check_and_record_egress(run, domain, 600)
            .await
            .is_none());
        assert_eq!(shield.egress_bytes(run, domain).await, 600);

        // Second call: 600 more bytes → 1200 > 1024 → DataExfiltrationBudget.
        let violation = shield
            .check_and_record_egress(run, domain, 600)
            .await
            .expect("budget should be exceeded");
        assert_eq!(
            violation.violation_type,
            ViolationType::DataExfiltrationBudget
        );
        assert!(violation.details.contains(domain));
        // The pending bytes are NOT recorded when the budget is exceeded.
        assert_eq!(shield.egress_bytes(run, domain).await, 600);

        // Different run → independent budget.
        assert!(shield
            .check_and_record_egress("run_other", domain, 600)
            .await
            .is_none());

        // Clear the original run and confirm the budget resets.
        shield.clear_run(run).await;
        assert_eq!(shield.egress_bytes(run, domain).await, 0);
        assert!(shield
            .check_and_record_egress(run, domain, 600)
            .await
            .is_none());
    }

    #[tokio::test]
    async fn no_budget_configured_is_noop() {
        let shield = shield_with_dlp_and_budget(vec!["api.example.com"], None);
        // No budget configured → record_egress always returns None.
        assert!(shield
            .check_and_record_egress("run_x", "api.example.com", 999_999)
            .await
            .is_none());
    }
}
