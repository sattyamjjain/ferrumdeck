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
