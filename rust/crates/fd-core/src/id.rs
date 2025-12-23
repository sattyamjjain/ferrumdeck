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

    #[test]
    fn test_run_id_creation() {
        let id = RunId::new();
        let s = id.to_string();
        assert!(s.starts_with("run_"));
    }

    #[test]
    fn test_run_id_parse() {
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
}
