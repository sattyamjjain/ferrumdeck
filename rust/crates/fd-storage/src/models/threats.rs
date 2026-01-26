//! Airlock threat models

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Risk level for violations
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Critical,
}

impl RiskLevel {
    pub fn as_str(&self) -> &'static str {
        match self {
            RiskLevel::Low => "low",
            RiskLevel::Medium => "medium",
            RiskLevel::High => "high",
            RiskLevel::Critical => "critical",
        }
    }
}

impl std::fmt::Display for RiskLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Action taken for a threat
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum ThreatAction {
    Blocked,
    Logged,
}

impl ThreatAction {
    pub fn as_str(&self) -> &'static str {
        match self {
            ThreatAction::Blocked => "blocked",
            ThreatAction::Logged => "logged",
        }
    }
}

impl std::fmt::Display for ThreatAction {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Threat entity from database
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct Threat {
    pub id: String,
    pub run_id: String,
    pub step_id: Option<String>,
    pub tool_name: String,
    pub risk_score: i32,
    pub risk_level: String,
    pub violation_type: String,
    pub violation_details: Option<String>,
    pub blocked_payload: Option<serde_json::Value>,
    pub trigger_pattern: Option<String>,
    pub action: String,
    pub shadow_mode: bool,
    pub project_id: Option<String>,
    pub tenant_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

/// Request to create a new threat record
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateThreat {
    pub id: String,
    pub run_id: String,
    pub step_id: Option<String>,
    pub tool_name: String,
    pub risk_score: i32,
    pub risk_level: String,
    pub violation_type: String,
    pub violation_details: Option<String>,
    pub blocked_payload: Option<serde_json::Value>,
    pub trigger_pattern: Option<String>,
    pub action: String,
    pub shadow_mode: bool,
    pub project_id: Option<String>,
    pub tenant_id: Option<String>,
}

/// Velocity event for tracking tool call costs
#[derive(Debug, Clone, FromRow, Serialize, Deserialize)]
pub struct VelocityEvent {
    pub id: i32,
    pub run_id: String,
    pub tool_name: String,
    pub tool_input_hash: String,
    pub cost_cents: i32,
    pub created_at: DateTime<Utc>,
}

/// Request to create a velocity event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateVelocityEvent {
    pub run_id: String,
    pub tool_name: String,
    pub tool_input_hash: String,
    pub cost_cents: i32,
}

#[cfg(test)]
mod tests {
    use super::*;

    // ==========================================================================
    // STO-THR-001: RiskLevel enum values
    // ==========================================================================
    #[test]
    fn test_risk_level_low() {
        let level = RiskLevel::Low;
        assert_eq!(level.as_str(), "low");
        assert_eq!(level.to_string(), "low");
    }

    #[test]
    fn test_risk_level_medium() {
        let level = RiskLevel::Medium;
        assert_eq!(level.as_str(), "medium");
        assert_eq!(level.to_string(), "medium");
    }

    #[test]
    fn test_risk_level_high() {
        let level = RiskLevel::High;
        assert_eq!(level.as_str(), "high");
        assert_eq!(level.to_string(), "high");
    }

    #[test]
    fn test_risk_level_critical() {
        let level = RiskLevel::Critical;
        assert_eq!(level.as_str(), "critical");
        assert_eq!(level.to_string(), "critical");
    }

    // ==========================================================================
    // STO-THR-002: RiskLevel serialization
    // ==========================================================================
    #[test]
    fn test_risk_level_serialization() {
        let level = RiskLevel::High;
        let json = serde_json::to_string(&level).unwrap();
        assert_eq!(json, "\"high\"");
    }

    #[test]
    fn test_risk_level_deserialization() {
        let level: RiskLevel = serde_json::from_str("\"critical\"").unwrap();
        assert_eq!(level, RiskLevel::Critical);
    }

    #[test]
    fn test_risk_level_roundtrip() {
        let levels = vec![RiskLevel::Low, RiskLevel::Medium, RiskLevel::High, RiskLevel::Critical];
        for level in levels {
            let json = serde_json::to_string(&level).unwrap();
            let parsed: RiskLevel = serde_json::from_str(&json).unwrap();
            assert_eq!(level, parsed);
        }
    }

    // ==========================================================================
    // STO-THR-003: ThreatAction enum values
    // ==========================================================================
    #[test]
    fn test_threat_action_blocked() {
        let action = ThreatAction::Blocked;
        assert_eq!(action.as_str(), "blocked");
        assert_eq!(action.to_string(), "blocked");
    }

    #[test]
    fn test_threat_action_logged() {
        let action = ThreatAction::Logged;
        assert_eq!(action.as_str(), "logged");
        assert_eq!(action.to_string(), "logged");
    }

    // ==========================================================================
    // STO-THR-004: ThreatAction serialization
    // ==========================================================================
    #[test]
    fn test_threat_action_serialization() {
        let action = ThreatAction::Blocked;
        let json = serde_json::to_string(&action).unwrap();
        assert_eq!(json, "\"blocked\"");
    }

    #[test]
    fn test_threat_action_deserialization() {
        let action: ThreatAction = serde_json::from_str("\"logged\"").unwrap();
        assert_eq!(action, ThreatAction::Logged);
    }

    #[test]
    fn test_threat_action_roundtrip() {
        for action in [ThreatAction::Blocked, ThreatAction::Logged] {
            let json = serde_json::to_string(&action).unwrap();
            let parsed: ThreatAction = serde_json::from_str(&json).unwrap();
            assert_eq!(action, parsed);
        }
    }

    // ==========================================================================
    // STO-THR-005: CreateThreat serialization
    // ==========================================================================
    #[test]
    fn test_create_threat_serialization() {
        let create = CreateThreat {
            id: "thr_123".to_string(),
            run_id: "run_456".to_string(),
            step_id: Some("stp_789".to_string()),
            tool_name: "http_request".to_string(),
            risk_score: 85,
            risk_level: "high".to_string(),
            violation_type: "exfiltration".to_string(),
            violation_details: Some("Attempted connection to unauthorized domain".to_string()),
            blocked_payload: Some(serde_json::json!({"url": "http://evil.com"})),
            trigger_pattern: Some("ip_address".to_string()),
            action: "blocked".to_string(),
            shadow_mode: false,
            project_id: Some("prj_1".to_string()),
            tenant_id: Some("ten_1".to_string()),
        };

        let json = serde_json::to_string(&create).unwrap();
        assert!(json.contains("thr_123"));
        assert!(json.contains("exfiltration"));
        assert!(json.contains("evil.com"));
    }

    #[test]
    fn test_create_threat_minimal() {
        let create = CreateThreat {
            id: "thr_min".to_string(),
            run_id: "run_1".to_string(),
            step_id: None,
            tool_name: "execute_code".to_string(),
            risk_score: 95,
            risk_level: "critical".to_string(),
            violation_type: "rce".to_string(),
            violation_details: None,
            blocked_payload: None,
            trigger_pattern: None,
            action: "blocked".to_string(),
            shadow_mode: false,
            project_id: None,
            tenant_id: None,
        };

        let json = serde_json::to_string(&create).unwrap();
        let parsed: CreateThreat = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.risk_score, 95);
        assert!(parsed.step_id.is_none());
    }

    // ==========================================================================
    // STO-THR-006: CreateVelocityEvent
    // ==========================================================================
    #[test]
    fn test_create_velocity_event_serialization() {
        let event = CreateVelocityEvent {
            run_id: "run_vel".to_string(),
            tool_name: "api_call".to_string(),
            tool_input_hash: "hash_abc123".to_string(),
            cost_cents: 50,
        };

        let json = serde_json::to_string(&event).unwrap();
        let parsed: CreateVelocityEvent = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.cost_cents, 50);
        assert_eq!(parsed.tool_input_hash, "hash_abc123");
    }

    // ==========================================================================
    // STO-THR-007: Equality and clone
    // ==========================================================================
    #[test]
    fn test_risk_level_equality() {
        assert_eq!(RiskLevel::High, RiskLevel::High);
        assert_ne!(RiskLevel::High, RiskLevel::Low);
    }

    #[test]
    fn test_threat_action_equality() {
        assert_eq!(ThreatAction::Blocked, ThreatAction::Blocked);
        assert_ne!(ThreatAction::Blocked, ThreatAction::Logged);
    }

    #[test]
    fn test_risk_level_copy() {
        let level = RiskLevel::Critical;
        let copied = level;
        assert_eq!(level, copied);
    }

    #[test]
    fn test_threat_action_clone() {
        let action = ThreatAction::Logged;
        let cloned = action.clone();
        assert_eq!(action, cloned);
    }

    // ==========================================================================
    // STO-THR-008: Debug formatting
    // ==========================================================================
    #[test]
    fn test_risk_level_debug() {
        let level = RiskLevel::Medium;
        let debug = format!("{:?}", level);
        assert_eq!(debug, "Medium");
    }

    #[test]
    fn test_threat_action_debug() {
        let action = ThreatAction::Blocked;
        let debug = format!("{:?}", action);
        assert_eq!(debug, "Blocked");
    }

    #[test]
    fn test_create_threat_debug() {
        let create = CreateThreat {
            id: "thr_debug".to_string(),
            run_id: "run_1".to_string(),
            step_id: None,
            tool_name: "test".to_string(),
            risk_score: 50,
            risk_level: "medium".to_string(),
            violation_type: "test".to_string(),
            violation_details: None,
            blocked_payload: None,
            trigger_pattern: None,
            action: "logged".to_string(),
            shadow_mode: true,
            project_id: None,
            tenant_id: None,
        };
        let debug = format!("{:?}", create);
        assert!(debug.contains("thr_debug"));
    }
}
