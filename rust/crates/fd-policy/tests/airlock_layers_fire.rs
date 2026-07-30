//! The two "double-dead" Airlock layers, wired end-to-end.
//!
//! Schema-drift (Layer 0) and behavioral-drift (Layer -1) were previously inert
//! in the running gateway for two independent reasons: the inspector held no
//! guard/monitor, AND the per-call `InspectionContext` carried
//! `tool_version_id: None` / `agent_id: None`. #4 wires BOTH ends — the gateway
//! attaches a boot-populated [`SchemaDriftGuard`] + a shared
//! [`BehavioralDriftMonitor`] (`state.rs`), and `check_tool_policy` populates the
//! two ids (`handlers/runs.rs`).
//!
//! This test drives the **real** `AirlockInspector::inspect` and asserts each
//! layer fires when its id is `Some` and stays silent when it is `None` — i.e.
//! it pins the exact wiring #4 fixed, at the inspector boundary, with no gateway
//! / DB. RCE, velocity, and exfiltration are disabled so only the layer under
//! test can produce a verdict. Shadow mode is asserted to record-but-allow.

use std::sync::Arc;

use fd_core::{AgentId, RunId, ToolVersionId};
use fd_policy::airlock::config::{
    BehavioralDriftConfig, ExfiltrationConfig, RceConfig, SchemaDriftConfig, VelocityConfig,
};
use fd_policy::airlock::{BehavioralDriftMonitor, SchemaDriftGuard};
use fd_policy::{AirlockConfig, AirlockInspector, AirlockMode, InspectionContext, ViolationType};
use serde_json::json;

/// The schema a registered tool version was published with. A payload missing
/// `age`, or carrying an unknown field, is schema drift.
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

/// An inspector with ONLY the two drift layers live (RCE / velocity / exfil off)
/// so a verdict can come from nothing else. The guard + monitor are attached
/// exactly as `AppState::new` does at boot.
fn inspector(
    mode: AirlockMode,
    guard: Arc<SchemaDriftGuard>,
    monitor: Arc<BehavioralDriftMonitor>,
) -> AirlockInspector {
    let config = AirlockConfig {
        mode,
        rce: RceConfig {
            enabled: false,
            ..RceConfig::default()
        },
        velocity: VelocityConfig {
            enabled: false,
            ..VelocityConfig::default()
        },
        exfiltration: ExfiltrationConfig {
            enabled: false,
            ..ExfiltrationConfig::default()
        },
        schema_drift: SchemaDriftConfig::default(),
        behavioral_drift: BehavioralDriftConfig::default(),
    };
    AirlockInspector::new(config)
        .with_schema_drift_guard(guard)
        .with_behavioral_drift_monitor(monitor)
}

fn ctx(
    tool_input: serde_json::Value,
    tool_version_id: Option<ToolVersionId>,
    agent_id: Option<AgentId>,
    estimated_cost_cents: Option<u64>,
) -> InspectionContext {
    InspectionContext {
        run_id: RunId::new(),
        tool_name: "person.upsert".to_string(),
        tool_input,
        estimated_cost_cents,
        tool_version_id,
        agent_id,
    }
}

// ---------------------------------------------------------------------------
// Schema-drift (Layer 0): fires with tool_version_id Some, silent with None.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn schema_drift_fires_when_tool_version_id_is_some() {
    let tv_id = ToolVersionId::new();
    let guard = Arc::new(SchemaDriftGuard::new([(tv_id, person_schema())]));
    let monitor = Arc::new(BehavioralDriftMonitor::new());
    let airlock = inspector(AirlockMode::Enforce, guard, monitor);

    // Drifted payload (missing required `age`) WITH the version id → the guard
    // has this schema, so Layer 0 fires.
    let result = airlock
        .inspect(&ctx(json!({ "name": "Ada" }), Some(tv_id), None, None))
        .await;

    let violation = result
        .violation
        .expect("schema drift must fire when tool_version_id is Some and the payload drifts");
    assert_eq!(violation.violation_type, ViolationType::SchemaDrift);
    assert!(
        !result.allowed,
        "enforce mode blocks a schema-drift violation"
    );
    assert!(!result.shadow_mode);
}

#[tokio::test]
async fn schema_drift_silent_when_tool_version_id_is_none() {
    let tv_id = ToolVersionId::new();
    let guard = Arc::new(SchemaDriftGuard::new([(tv_id, person_schema())]));
    let monitor = Arc::new(BehavioralDriftMonitor::new());
    let airlock = inspector(AirlockMode::Enforce, guard, monitor);

    // Same drifted payload, but NO version id — the layer skips (fail-open for
    // the signal), and no other layer is live, so the call is clean.
    let result = airlock
        .inspect(&ctx(json!({ "name": "Ada" }), None, None, None))
        .await;

    assert!(
        result.violation.is_none(),
        "schema drift must NOT fire when tool_version_id is None: {:?}",
        result.violation
    );
    assert!(result.allowed);
}

// ---------------------------------------------------------------------------
// Behavioral-drift (Layer -1): fires with agent_id Some, silent with None.
// ---------------------------------------------------------------------------

/// Warm the monitor through the SAME inspect() path (agent_id Some, small cost)
/// past `min_observations`, then a large cost spike must fire behavioral drift.
#[tokio::test]
async fn behavioral_drift_fires_when_agent_id_is_some() {
    let guard = Arc::new(SchemaDriftGuard::empty());
    let monitor = Arc::new(BehavioralDriftMonitor::new());
    let airlock = inspector(AirlockMode::Enforce, guard, monitor);
    let agent = AgentId::new();

    // 30 cheap calls (tiny variance around 10) — well past min_observations=20.
    for i in 0..30 {
        let cost = if i % 2 == 0 { 10 } else { 11 };
        let r = airlock
            .inspect(&ctx(json!({}), None, Some(agent), Some(cost)))
            .await;
        assert!(
            r.violation.is_none(),
            "warmup traffic must not fire (i={i}): {:?}",
            r.violation
        );
    }

    // A 5000-cent call is many σ from the ~10 baseline → behavioral drift.
    let spike = airlock
        .inspect(&ctx(json!({}), None, Some(agent), Some(5000)))
        .await;
    let violation = spike
        .violation
        .expect("behavioral drift must fire on a cost spike once agent_id is Some");
    assert_eq!(violation.violation_type, ViolationType::BehavioralDrift);
    assert!(
        !spike.allowed,
        "enforce mode blocks a behavioral-drift violation"
    );
}

/// The identical warmup + spike, but with `agent_id: None` throughout, never
/// touches the monitor, so the spike cannot fire.
#[tokio::test]
async fn behavioral_drift_silent_when_agent_id_is_none() {
    let guard = Arc::new(SchemaDriftGuard::empty());
    let monitor = Arc::new(BehavioralDriftMonitor::new());
    let airlock = inspector(AirlockMode::Enforce, guard, monitor);

    for i in 0..30 {
        let cost = if i % 2 == 0 { 10 } else { 11 };
        let r = airlock
            .inspect(&ctx(json!({}), None, None, Some(cost)))
            .await;
        assert!(r.violation.is_none(), "no agent id → never fires (i={i})");
    }

    let spike = airlock
        .inspect(&ctx(json!({}), None, None, Some(5000)))
        .await;
    assert!(
        spike.violation.is_none(),
        "behavioral drift must NOT fire when agent_id is None: {:?}",
        spike.violation
    );
    assert!(spike.allowed);
}

// ---------------------------------------------------------------------------
// Shadow mode records the violation but allows the call.
// ---------------------------------------------------------------------------

#[tokio::test]
async fn shadow_mode_records_schema_drift_but_allows() {
    let tv_id = ToolVersionId::new();
    let guard = Arc::new(SchemaDriftGuard::new([(tv_id, person_schema())]));
    let monitor = Arc::new(BehavioralDriftMonitor::new());
    let airlock = inspector(AirlockMode::Shadow, guard, monitor);

    let result = airlock
        .inspect(&ctx(json!({ "name": "Ada" }), Some(tv_id), None, None))
        .await;

    // Recorded...
    let violation = result
        .violation
        .expect("shadow mode still detects and records the violation");
    assert_eq!(violation.violation_type, ViolationType::SchemaDrift);
    // ...but not blocked.
    assert!(result.allowed, "shadow mode allows the call through");
    assert!(result.shadow_mode);
}
