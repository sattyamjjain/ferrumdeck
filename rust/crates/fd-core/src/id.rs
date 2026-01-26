//! Strongly-typed IDs for FerrumDeck entities
//!
//! All IDs use ULID (Universally Unique Lexicographically Sortable Identifier)
//! for time-ordered, collision-resistant identification.

use serde::{Deserialize, Serialize};
use std::fmt;
use ulid::Ulid;

/// Macro to generate strongly-typed ID wrappers
macro_rules! define_id {
    ($name:ident, $prefix:expr) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Ulid);

        impl $name {
            /// Create a new ID
            pub fn new() -> Self {
                Self(Ulid::new())
            }

            /// Create from an existing ULID
            pub fn from_ulid(ulid: Ulid) -> Self {
                Self(ulid)
            }

            /// Parse from string (with or without prefix)
            pub fn parse(s: &str) -> Result<Self, IdParseError> {
                let s = s.strip_prefix($prefix).unwrap_or(s);
                let s = s.strip_prefix('_').unwrap_or(s);
                let ulid = Ulid::from_string(s).map_err(|_| IdParseError::InvalidFormat)?;
                Ok(Self(ulid))
            }

            /// Get the inner ULID
            pub fn inner(&self) -> Ulid {
                self.0
            }

            /// Get the timestamp from the ID
            pub fn timestamp(&self) -> u64 {
                self.0.timestamp_ms()
            }

            /// Convert to prefixed string representation
            pub fn to_prefixed_string(&self) -> String {
                format!("{}_{}", $prefix, self.0)
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}_{}", $prefix, self.0)
            }
        }

        impl std::str::FromStr for $name {
            type Err = IdParseError;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Self::parse(s)
            }
        }
    };
}

/// Error parsing an ID
#[derive(Debug, Clone, thiserror::Error)]
pub enum IdParseError {
    #[error("invalid ID format")]
    InvalidFormat,
}

// Define all entity IDs
define_id!(TenantId, "ten");
define_id!(WorkspaceId, "wks");
define_id!(ProjectId, "prj");
define_id!(AgentId, "agt");
define_id!(AgentVersionId, "agv");
define_id!(ToolId, "tol");
define_id!(ToolVersionId, "tov");
define_id!(RunId, "run");
define_id!(StepId, "stp");
define_id!(PolicyRuleId, "pol");
define_id!(PolicyDecisionId, "pdc");
define_id!(ApprovalId, "apr");
define_id!(AuditEventId, "aud");
define_id!(ApiKeyId, "key");
define_id!(ArtifactId, "art");

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    // ==========================================================================
    // CORE-ID-001: RunId generates valid ULID with "run_" prefix
    // ==========================================================================
    #[test]
    fn test_run_id_generation() {
        let id = RunId::new();
        let s = id.to_string();
        assert!(s.starts_with("run_"));
        assert_eq!(s.len(), 30); // "run_" (4) + ULID (26)
    }

    // ==========================================================================
    // CORE-ID-002: StepId generates valid ULID with "stp_" prefix
    // ==========================================================================
    #[test]
    fn test_step_id_generation() {
        let id = StepId::new();
        let s = id.to_string();
        assert!(s.starts_with("stp_"));
        assert_eq!(s.len(), 30);
    }

    // ==========================================================================
    // CORE-ID-003: AgentId generates valid ULID with "agt_" prefix
    // ==========================================================================
    #[test]
    fn test_agent_id_generation() {
        let id = AgentId::new();
        let s = id.to_string();
        assert!(s.starts_with("agt_"));
        assert_eq!(s.len(), 30);
    }

    // ==========================================================================
    // CORE-ID-004: IDs can be parsed from valid strings
    // ==========================================================================
    #[test]
    fn test_id_parsing_valid() {
        let id = RunId::new();
        let s = id.to_string();
        let parsed = RunId::parse(&s).unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn test_run_id_parse_without_prefix() {
        let id = RunId::new();
        let ulid_str = id.inner().to_string();
        let parsed = RunId::parse(&ulid_str).unwrap();
        assert_eq!(id, parsed);
    }

    // ==========================================================================
    // CORE-ID-005: Parsing fails for wrong prefix
    // ==========================================================================
    #[test]
    fn test_id_parsing_different_prefix_fails() {
        // Implementation only strips its own prefix, so wrong prefix causes failure
        let id = RunId::new();
        let s = id.to_string();
        // Replace run_ with stp_ - this leaves "stp_" in the string
        let wrong_prefix = s.replace("run_", "stp_");
        // Should fail because "stp_<ULID>" is not a valid ULID
        let result = RunId::parse(&wrong_prefix);
        assert!(result.is_err());
    }

    #[test]
    fn test_id_parsing_with_correct_prefix_works() {
        // Parsing with correct prefix should work
        let id = RunId::new();
        let prefixed = id.to_prefixed_string();
        let result = RunId::parse(&prefixed);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), id);
    }

    // ==========================================================================
    // CORE-ID-006: Parsing fails for invalid ULID portion
    // ==========================================================================
    #[test]
    fn test_id_parsing_invalid_ulid() {
        let result = RunId::parse("run_INVALID_ULID_STRING!!!");
        assert!(result.is_err());
        match result {
            Err(IdParseError::InvalidFormat) => {}
            _ => panic!("Expected InvalidFormat error"),
        }
    }

    #[test]
    fn test_id_parsing_empty_string() {
        let result = RunId::parse("");
        assert!(result.is_err());
    }

    #[test]
    fn test_id_parsing_too_short() {
        let result = RunId::parse("run_ABC");
        assert!(result.is_err());
    }

    // ==========================================================================
    // CORE-ID-007: Generated IDs are unique
    // ==========================================================================
    #[test]
    fn test_id_uniqueness() {
        let mut ids = HashSet::new();
        for _ in 0..1000 {
            let id = RunId::new();
            assert!(ids.insert(id), "Duplicate ID generated");
        }
        assert_eq!(ids.len(), 1000);
    }

    // ==========================================================================
    // CORE-ID-008: IDs are time-ordered
    // ==========================================================================
    #[test]
    fn test_id_ordering() {
        let id1 = RunId::new();
        std::thread::sleep(std::time::Duration::from_millis(2));
        let id2 = RunId::new();

        // ULID timestamps should be ordered
        assert!(id2.timestamp() >= id1.timestamp());

        // String comparison should also preserve order
        assert!(id2.to_string() > id1.to_string());
    }

    // ==========================================================================
    // CORE-ID-009: IDs serialize/deserialize correctly
    // ==========================================================================
    #[test]
    fn test_id_serialization() {
        let id = RunId::new();

        // Serialize to JSON
        let json = serde_json::to_string(&id).unwrap();

        // Should be a quoted ULID string
        assert!(json.starts_with('"'));
        assert!(json.ends_with('"'));

        // Deserialize back
        let parsed: RunId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn test_id_serialization_in_struct() {
        #[derive(serde::Serialize, serde::Deserialize, PartialEq, Debug)]
        struct TestStruct {
            id: RunId,
            name: String,
        }

        let original = TestStruct {
            id: RunId::new(),
            name: "test".to_string(),
        };

        let json = serde_json::to_string(&original).unwrap();
        let parsed: TestStruct = serde_json::from_str(&json).unwrap();
        assert_eq!(original, parsed);
    }

    // ==========================================================================
    // CORE-ID-010: Same ID strings are equal
    // ==========================================================================
    #[test]
    fn test_id_equality() {
        let id1 = RunId::new();
        let id2 = RunId::parse(&id1.to_string()).unwrap();
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_id_hash_consistency() {
        use std::hash::{Hash, Hasher};
        use std::collections::hash_map::DefaultHasher;

        let id1 = RunId::new();
        let id2 = RunId::parse(&id1.to_string()).unwrap();

        let hash1 = {
            let mut h = DefaultHasher::new();
            id1.hash(&mut h);
            h.finish()
        };
        let hash2 = {
            let mut h = DefaultHasher::new();
            id2.hash(&mut h);
            h.finish()
        };
        assert_eq!(hash1, hash2);
    }

    // ==========================================================================
    // Additional ID type tests
    // ==========================================================================
    #[test]
    fn test_all_id_types_have_correct_prefix() {
        assert!(TenantId::new().to_string().starts_with("ten_"));
        assert!(WorkspaceId::new().to_string().starts_with("wks_"));
        assert!(ProjectId::new().to_string().starts_with("prj_"));
        assert!(AgentVersionId::new().to_string().starts_with("agv_"));
        assert!(ToolId::new().to_string().starts_with("tol_"));
        assert!(ToolVersionId::new().to_string().starts_with("tov_"));
        assert!(PolicyRuleId::new().to_string().starts_with("pol_"));
        assert!(PolicyDecisionId::new().to_string().starts_with("pdc_"));
        assert!(ApprovalId::new().to_string().starts_with("apr_"));
        assert!(AuditEventId::new().to_string().starts_with("aud_"));
        assert!(ApiKeyId::new().to_string().starts_with("key_"));
        assert!(ArtifactId::new().to_string().starts_with("art_"));
    }

    #[test]
    fn test_id_from_ulid() {
        let ulid = Ulid::new();
        let id = RunId::from_ulid(ulid);
        assert_eq!(id.inner(), ulid);
    }

    #[test]
    fn test_id_default() {
        let id: RunId = Default::default();
        assert!(id.to_string().starts_with("run_"));
    }

    #[test]
    fn test_id_from_str_trait() {
        let id = RunId::new();
        let s = id.to_string();
        let parsed: RunId = s.parse().unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn test_id_display_and_to_prefixed_string() {
        let id = RunId::new();
        // Display should equal to_prefixed_string
        assert_eq!(id.to_string(), id.to_prefixed_string());
    }

    #[test]
    fn test_id_timestamp_extraction() {
        let before = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        let id = RunId::new();

        let after = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        assert!(id.timestamp() >= before);
        assert!(id.timestamp() <= after);
    }
}
