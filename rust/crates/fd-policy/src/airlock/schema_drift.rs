//! Schema-drift inspection — fourth Airlock RASP layer.
//!
//! Validates MCP tool-call payloads against the JSON Schema registered on
//! the `ToolVersion` in `fd-registry`. When the LLM constructs a payload
//! that drifts from the registered contract — missing required fields,
//! wrong types, unknown fields — the call is rejected (or shadow-logged)
//! before it ever reaches the MCP router.
//!
//! Motivated by recent agentic-AI failure-mode research showing systematic
//! payload-construction errors on MCP-accessed tools.

use super::config::SchemaDriftConfig;
use super::inspector::{AirlockViolation, RiskLevel, ViolationType};
use fd_core::ToolVersionId;
use jsonschema::JSONSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tracing::{debug, warn};

/// Categories of drift between an actual payload and the registered schema.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DriftKind {
    /// A required field is missing from the payload.
    MissingRequired,
    /// A field's value has the wrong JSON type.
    TypeMismatch,
    /// A field's value violates the schema in some other way (enum, format, etc).
    ConstraintViolation,
    /// The payload itself fails a top-level constraint (e.g. wrong root type).
    PayloadShape,
}

impl DriftKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            DriftKind::MissingRequired => "missing_required",
            DriftKind::TypeMismatch => "type_mismatch",
            DriftKind::ConstraintViolation => "constraint_violation",
            DriftKind::PayloadShape => "payload_shape",
        }
    }
}

/// A single field-level drift detected during validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DriftDelta {
    /// JSON pointer to the offending location (`/` for root, `/args/path` for nested).
    pub field: String,
    pub kind: DriftKind,
    /// Short human-readable description of the constraint that failed.
    pub message: String,
}

/// Structured payload encoded into `AirlockViolation.details` when a
/// schema-drift violation fires. Use `serde_json::from_str` on `details`
/// to recover this on the consuming side.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SchemaDriftDetails {
    pub tool_version_id: String,
    pub deltas: Vec<DriftDelta>,
}

/// Cache of compiled JSON Schemas, keyed by `ToolVersionId`.
///
/// Build once at gateway startup from `fd_registry::ToolVersion.input_schema`,
/// then share via `Arc` to every inspection.
pub struct SchemaDriftGuard {
    schemas: HashMap<ToolVersionId, Arc<JSONSchema>>,
}

impl SchemaDriftGuard {
    /// Build a new guard from `(ToolVersionId, schema)` pairs. Schemas that
    /// fail to compile are logged and skipped — they will never raise a
    /// false-positive `SchemaDrift` violation, but they also won't catch
    /// real drift. Surface compile failures at registration time, not here.
    pub fn new<I>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (ToolVersionId, serde_json::Value)>,
    {
        let mut schemas = HashMap::new();
        for (id, value) in pairs {
            match JSONSchema::compile(&value) {
                Ok(compiled) => {
                    schemas.insert(id, Arc::new(compiled));
                }
                Err(err) => {
                    warn!(
                        tool_version_id = %id,
                        error = %err,
                        "skipping uncompilable input schema; payloads for this tool version will not be drift-checked",
                    );
                }
            }
        }
        Self { schemas }
    }

    /// Empty guard — used when schema-drift is disabled or no tool versions
    /// have been registered yet.
    pub fn empty() -> Self {
        Self {
            schemas: HashMap::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.schemas.len()
    }

    pub fn is_empty(&self) -> bool {
        self.schemas.is_empty()
    }

    /// Returns `None` when the payload conforms to the registered schema
    /// (or no schema is registered for this tool version), and
    /// `Some(violation)` otherwise. The violation's `details` field carries
    /// a JSON-encoded [`SchemaDriftDetails`] for the dashboard / worker to
    /// surface to the LLM.
    pub fn check(
        &self,
        tool_version_id: &ToolVersionId,
        payload: &serde_json::Value,
        config: &SchemaDriftConfig,
    ) -> Option<AirlockViolation> {
        if !config.enabled {
            return None;
        }
        let schema = self.schemas.get(tool_version_id)?;
        let validation = schema.validate(payload);
        let errors = match validation {
            Ok(()) => return None,
            Err(errors) => errors,
        };

        let mut deltas: Vec<DriftDelta> = errors
            .map(|err| {
                let pointer = err.instance_path.to_string();
                let field = if pointer.is_empty() {
                    "/".to_string()
                } else {
                    pointer
                };
                let kind = classify_kind(&err.kind);
                DriftDelta {
                    field,
                    kind,
                    message: err.to_string(),
                }
            })
            .collect();

        if deltas.is_empty() {
            // jsonschema reported an error but yielded no iterator items —
            // be conservative and treat as a generic shape violation.
            deltas.push(DriftDelta {
                field: "/".to_string(),
                kind: DriftKind::PayloadShape,
                message: "payload failed schema validation".to_string(),
            });
        }

        let risk_score = config.risk_score.min(100);
        let details = SchemaDriftDetails {
            tool_version_id: tool_version_id.to_string(),
            deltas: deltas.clone(),
        };
        let serialized = serde_json::to_string(&details).unwrap_or_else(|_| {
            format!(
                "schema_drift: {} delta(s) for tool_version {}",
                deltas.len(),
                tool_version_id
            )
        });

        debug!(
            tool_version_id = %tool_version_id,
            delta_count = deltas.len(),
            "schema drift detected"
        );

        Some(AirlockViolation {
            violation_type: ViolationType::SchemaDrift,
            risk_score,
            risk_level: RiskLevel::from_score(risk_score),
            details: serialized,
            trigger: format!("schema_drift:{}", deltas[0].kind.as_str()),
        })
    }
}

fn classify_kind(kind: &jsonschema::error::ValidationErrorKind) -> DriftKind {
    use jsonschema::error::ValidationErrorKind;
    match kind {
        ValidationErrorKind::Required { .. } => DriftKind::MissingRequired,
        ValidationErrorKind::Type { .. } => DriftKind::TypeMismatch,
        _ => DriftKind::ConstraintViolation,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn person_schema() -> serde_json::Value {
        json!({
            "type": "object",
            "required": ["name", "age"],
            "additionalProperties": false,
            "properties": {
                "name": { "type": "string" },
                "age": { "type": "integer", "minimum": 0 }
            }
        })
    }

    fn config() -> SchemaDriftConfig {
        SchemaDriftConfig {
            enabled: true,
            risk_score: 70,
        }
    }

    #[test]
    fn valid_payload_passes() {
        let tv_id = ToolVersionId::new();
        let guard = SchemaDriftGuard::new([(tv_id, person_schema())]);
        let result = guard.check(&tv_id, &json!({"name": "Ada", "age": 36}), &config());
        assert!(result.is_none());
    }

    #[test]
    fn missing_required_field_is_caught() {
        let tv_id = ToolVersionId::new();
        let guard = SchemaDriftGuard::new([(tv_id, person_schema())]);
        let violation = guard
            .check(&tv_id, &json!({"name": "Ada"}), &config())
            .expect("should detect missing required field");
        assert_eq!(violation.violation_type, ViolationType::SchemaDrift);

        let details: SchemaDriftDetails = serde_json::from_str(&violation.details).unwrap();
        assert_eq!(details.tool_version_id, tv_id.to_string());
        assert!(
            details
                .deltas
                .iter()
                .any(|d| d.kind == DriftKind::MissingRequired),
            "expected MissingRequired delta, got {:?}",
            details.deltas
        );
    }

    #[test]
    fn type_mismatch_is_caught() {
        let tv_id = ToolVersionId::new();
        let guard = SchemaDriftGuard::new([(tv_id, person_schema())]);
        let violation = guard
            .check(&tv_id, &json!({"name": "Ada", "age": "thirty"}), &config())
            .expect("should detect type mismatch");
        let details: SchemaDriftDetails = serde_json::from_str(&violation.details).unwrap();
        assert!(
            details
                .deltas
                .iter()
                .any(|d| d.kind == DriftKind::TypeMismatch),
            "expected TypeMismatch delta, got {:?}",
            details.deltas
        );
    }

    #[test]
    fn unknown_field_is_caught_as_constraint() {
        let tv_id = ToolVersionId::new();
        let guard = SchemaDriftGuard::new([(tv_id, person_schema())]);
        let violation = guard
            .check(
                &tv_id,
                &json!({"name": "Ada", "age": 36, "ssn": "leaked"}),
                &config(),
            )
            .expect("additionalProperties:false should reject unknown field");
        let details: SchemaDriftDetails = serde_json::from_str(&violation.details).unwrap();
        // additionalProperties violations classify as ConstraintViolation in our mapping.
        assert!(!details.deltas.is_empty());
    }

    #[test]
    fn no_schema_for_tool_version_is_skipped() {
        let known = ToolVersionId::new();
        let unknown = ToolVersionId::new();
        let guard = SchemaDriftGuard::new([(known, person_schema())]);
        assert!(guard
            .check(&unknown, &json!({"name": "Ada", "age": 36}), &config())
            .is_none());
    }

    #[test]
    fn disabled_config_short_circuits() {
        let tv_id = ToolVersionId::new();
        let guard = SchemaDriftGuard::new([(tv_id, person_schema())]);
        let mut cfg = config();
        cfg.enabled = false;
        // Even a clearly-drifted payload should pass when disabled.
        assert!(guard.check(&tv_id, &json!({"name": "Ada"}), &cfg).is_none());
    }

    #[test]
    fn risk_score_is_clamped_to_100() {
        let tv_id = ToolVersionId::new();
        let guard = SchemaDriftGuard::new([(tv_id, person_schema())]);
        let mut cfg = config();
        cfg.risk_score = 200;
        let violation = guard
            .check(&tv_id, &json!({"name": "Ada"}), &cfg)
            .expect("should violate");
        assert_eq!(violation.risk_score, 100);
        assert_eq!(violation.risk_level, RiskLevel::Critical);
    }

    #[test]
    fn empty_guard_skips_all() {
        let guard = SchemaDriftGuard::empty();
        let tv_id = ToolVersionId::new();
        assert!(guard.is_empty());
        assert!(guard
            .check(&tv_id, &json!({"anything": "goes"}), &config())
            .is_none());
    }

    #[test]
    fn invalid_schema_is_skipped_at_compile_time() {
        let tv_id = ToolVersionId::new();
        // Pass a syntactically valid JSON value that is not a valid schema.
        // `{"type": 42}` — the `type` keyword expects a string or array.
        let bad_schema = json!({"type": 42});
        let guard = SchemaDriftGuard::new([(tv_id, bad_schema)]);
        // Bad schemas are logged and skipped; the tool version simply has no
        // drift-check coverage.
        assert!(guard.is_empty() || !guard.schemas.contains_key(&tv_id));
    }
}
