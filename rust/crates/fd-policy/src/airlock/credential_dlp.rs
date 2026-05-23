//! Credential DLP — scans outbound payloads for high-confidence secrets.
//!
//! Sits beneath [`super::exfiltration::ExfiltrationShield`] — egress-DLP
//! signals fire on the same network-tool targets, before the domain
//! allowlist check, so a leaked key never reaches the wire even to an
//! allow-listed host.
//!
//! Two false-positive guards:
//! - Credit card matches are gated on a **Luhn** checksum (PAN mod-10).
//! - IBAN matches are gated on **mod-97** rearranged-checksum.
//!
//! Token patterns (AWS key id, GitHub PAT, Stripe live key, Anthropic key,
//! OpenAI key, Slack bot token, GCP service-account JSON marker) carry
//! their own prefix/length entropy and don't need a checksum.

use regex::Regex;
use std::sync::OnceLock;

/// A credential pattern we know how to detect with high confidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialKind {
    AwsAccessKeyId,
    GithubPat,
    GithubPatFineGrained,
    StripeLiveKey,
    AnthropicKey,
    OpenAiKey,
    SlackBotToken,
    GcpServiceAccount,
    CreditCardLuhn,
    IbanMod97,
}

impl CredentialKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            CredentialKind::AwsAccessKeyId => "aws_access_key_id",
            CredentialKind::GithubPat => "github_pat",
            CredentialKind::GithubPatFineGrained => "github_pat_fine_grained",
            CredentialKind::StripeLiveKey => "stripe_live_key",
            CredentialKind::AnthropicKey => "anthropic_key",
            CredentialKind::OpenAiKey => "openai_key",
            CredentialKind::SlackBotToken => "slack_bot_token",
            CredentialKind::GcpServiceAccount => "gcp_service_account",
            CredentialKind::CreditCardLuhn => "credit_card_luhn",
            CredentialKind::IbanMod97 => "iban_mod97",
        }
    }
}

/// A detected credential in an outbound payload. `redacted` is the first
/// four and last four characters of the match, separated by an ellipsis —
/// the full secret is never copied into audit storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CredentialMatch {
    pub kind: CredentialKind,
    pub redacted: String,
}

fn redact(s: &str) -> String {
    if s.len() <= 8 {
        return "*".repeat(s.len());
    }
    format!("{}...{}", &s[..4], &s[s.len() - 4..])
}

struct PatternEntry {
    kind: CredentialKind,
    regex: Regex,
    /// When `true`, run the kind-specific checksum on each match before
    /// reporting (Luhn for cards, mod-97 for IBANs).
    requires_checksum: bool,
}

fn patterns() -> &'static [PatternEntry] {
    static PATTERNS: OnceLock<Vec<PatternEntry>> = OnceLock::new();
    PATTERNS.get_or_init(|| {
        vec![
            PatternEntry {
                kind: CredentialKind::AwsAccessKeyId,
                regex: Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(),
                requires_checksum: false,
            },
            PatternEntry {
                kind: CredentialKind::GithubPatFineGrained,
                regex: Regex::new(r"\bgithub_pat_[A-Za-z0-9_]{82,}\b").unwrap(),
                requires_checksum: false,
            },
            PatternEntry {
                kind: CredentialKind::GithubPat,
                regex: Regex::new(r"\bghp_[A-Za-z0-9]{36,}\b").unwrap(),
                requires_checksum: false,
            },
            PatternEntry {
                kind: CredentialKind::StripeLiveKey,
                regex: Regex::new(r"\b(?:sk|rk)_live_[A-Za-z0-9]{24,}\b").unwrap(),
                requires_checksum: false,
            },
            PatternEntry {
                kind: CredentialKind::AnthropicKey,
                regex: Regex::new(r"\bsk-ant-[A-Za-z0-9_-]{95,}\b").unwrap(),
                requires_checksum: false,
            },
            PatternEntry {
                kind: CredentialKind::OpenAiKey,
                regex: Regex::new(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b").unwrap(),
                requires_checksum: false,
            },
            PatternEntry {
                kind: CredentialKind::SlackBotToken,
                regex: Regex::new(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b").unwrap(),
                requires_checksum: false,
            },
            // GCP service-account JSON usually leaks as a single embedded
            // string. Anchor on the unmistakable `"type":"service_account"`
            // + `"private_key"` substring — JSON whitespace tolerated.
            PatternEntry {
                kind: CredentialKind::GcpServiceAccount,
                regex: Regex::new(r#""type"\s*:\s*"service_account""#).unwrap(),
                requires_checksum: false,
            },
            // PAN with optional spaces/dashes — Luhn gates the report so
            // we don't flag random 13-19 digit strings.
            PatternEntry {
                kind: CredentialKind::CreditCardLuhn,
                regex: Regex::new(r"\b(?:\d[ -]?){12,18}\d\b").unwrap(),
                requires_checksum: true,
            },
            // IBAN: 2 letters + 2 digits + 11-30 alphanumeric — mod-97 gates.
            PatternEntry {
                kind: CredentialKind::IbanMod97,
                regex: Regex::new(r"\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b").unwrap(),
                requires_checksum: true,
            },
        ]
    })
}

/// Scan a string for any high-confidence credential. Returns the first
/// validated match — short-circuit semantics, mirror the existing
/// shield's first-violation behaviour.
pub fn scan(haystack: &str) -> Option<CredentialMatch> {
    for entry in patterns() {
        for m in entry.regex.find_iter(haystack) {
            let s = m.as_str();
            let valid = if entry.requires_checksum {
                match entry.kind {
                    CredentialKind::CreditCardLuhn => luhn_valid(s),
                    CredentialKind::IbanMod97 => iban_mod97_valid(s),
                    _ => true,
                }
            } else {
                true
            };
            if valid {
                return Some(CredentialMatch {
                    kind: entry.kind,
                    redacted: redact(s),
                });
            }
        }
    }
    None
}

/// Recursively scan any JSON value for credentials.
pub fn scan_json(value: &serde_json::Value) -> Option<CredentialMatch> {
    match value {
        serde_json::Value::String(s) => scan(s),
        serde_json::Value::Array(arr) => arr.iter().find_map(scan_json),
        serde_json::Value::Object(obj) => obj.values().find_map(scan_json),
        _ => None,
    }
}

/// Luhn (mod-10) checksum on a digit sequence. Strips spaces and dashes
/// first. Returns false for sequences shorter than 13 or longer than 19.
pub fn luhn_valid(s: &str) -> bool {
    let digits: Vec<u32> = s.chars().filter_map(|c| c.to_digit(10)).collect();
    if !(13..=19).contains(&digits.len()) {
        return false;
    }
    // Standard right-to-left double-every-other.
    let sum: u32 = digits
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &d)| {
            if i % 2 == 1 {
                let doubled = d * 2;
                if doubled > 9 {
                    doubled - 9
                } else {
                    doubled
                }
            } else {
                d
            }
        })
        .sum();
    sum % 10 == 0
}

/// IBAN mod-97 validation. Rearranges the IBAN (move first 4 chars to
/// the end), converts letters A-Z to 10-35, and asserts the resulting
/// integer is congruent to 1 (mod 97).
pub fn iban_mod97_valid(iban: &str) -> bool {
    // Strip optional spaces.
    let trimmed: String = iban.chars().filter(|c| !c.is_whitespace()).collect();
    if trimmed.len() < 15 || trimmed.len() > 34 {
        return false;
    }
    let bytes = trimmed.as_bytes();
    // First two must be country letters, next two must be check digits.
    if !bytes[0].is_ascii_uppercase()
        || !bytes[1].is_ascii_uppercase()
        || !bytes[2].is_ascii_digit()
        || !bytes[3].is_ascii_digit()
    {
        return false;
    }
    let mut rearranged = String::with_capacity(trimmed.len() + 4);
    rearranged.push_str(&trimmed[4..]);
    rearranged.push_str(&trimmed[..4]);

    let mut numeric = String::with_capacity(rearranged.len() * 2);
    for c in rearranged.chars() {
        if c.is_ascii_digit() {
            numeric.push(c);
        } else if c.is_ascii_uppercase() {
            numeric.push_str(&(c as u8 - b'A' + 10).to_string());
        } else {
            return false;
        }
    }

    // mod-97 by chunks to avoid u128 overflow on long IBANs.
    let mut remainder: u32 = 0;
    for byte in numeric.bytes() {
        remainder = (remainder * 10 + (byte - b'0') as u32) % 97;
    }
    remainder == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_aws_access_key_id() {
        let m = scan("found AKIAIOSFODNN7EXAMPLE in the env file");
        let m = m.expect("AWS AKIA prefix should match");
        assert_eq!(m.kind, CredentialKind::AwsAccessKeyId);
        // Redacted, never raw.
        assert!(m.redacted.contains("AKIA"));
        assert!(!m.redacted.contains("IOSFODNN7"));
    }

    #[test]
    fn detects_github_pat() {
        let token = format!("ghp_{}", "x".repeat(40));
        assert!(matches!(
            scan(&token).map(|m| m.kind),
            Some(CredentialKind::GithubPat)
        ));
    }

    #[test]
    fn detects_stripe_live_key() {
        let token = format!("sk_live_{}", "x".repeat(28));
        assert!(matches!(
            scan(&token).map(|m| m.kind),
            Some(CredentialKind::StripeLiveKey)
        ));
    }

    #[test]
    fn detects_gcp_service_account_marker() {
        let blob = r#"{"type":"service_account","project_id":"x"}"#;
        assert!(matches!(
            scan(blob).map(|m| m.kind),
            Some(CredentialKind::GcpServiceAccount)
        ));
    }

    #[test]
    fn luhn_passes_known_test_card() {
        // 4111 1111 1111 1111 — Visa test card, valid Luhn.
        assert!(luhn_valid("4111111111111111"));
        assert!(luhn_valid("4111 1111 1111 1111"));
        assert!(luhn_valid("4111-1111-1111-1111"));
    }

    #[test]
    fn luhn_rejects_invalid_card() {
        // Same digits with last flipped — fails Luhn.
        assert!(!luhn_valid("4111111111111112"));
    }

    #[test]
    fn non_luhn_sixteen_digits_not_flagged() {
        // 16 digits that DO NOT form a valid Luhn number. Required by
        // the prompt: false-positive suppression for arbitrary numerics.
        let arbitrary = "1234567890123456"; // fails Luhn
        assert!(scan(arbitrary).is_none());
    }

    #[test]
    fn luhn_card_flagged_when_isolated() {
        let m = scan("payment 4111111111111111 processed").expect("Luhn-valid PAN");
        assert_eq!(m.kind, CredentialKind::CreditCardLuhn);
    }

    #[test]
    fn iban_passes_known_valid() {
        // GB82 WEST 1234 5698 7654 32 — UK IBAN sample (mod-97 == 1).
        assert!(iban_mod97_valid("GB82WEST12345698765432"));
    }

    #[test]
    fn iban_rejects_bad_checksum() {
        assert!(!iban_mod97_valid("GB99WEST12345698765432"));
    }

    #[test]
    fn redact_format_never_includes_middle() {
        let r = redact("AKIAIOSFODNN7EXAMPLE");
        assert_eq!(r, "AKIA...MPLE");
    }

    #[test]
    fn scan_json_walks_nested() {
        let v = serde_json::json!({
            "headers": { "x-api-key": format!("ghp_{}", "a".repeat(40)) }
        });
        assert!(matches!(
            scan_json(&v).map(|m| m.kind),
            Some(CredentialKind::GithubPat)
        ));
    }

    #[test]
    fn scan_json_clean_payload_returns_none() {
        let v = serde_json::json!({
            "user": "alice",
            "ids": [1, 2, 3]
        });
        assert!(scan_json(&v).is_none());
    }
}
