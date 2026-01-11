// Import RiskLevel from utils (already re-exported from types/approval.ts)
import type { RiskLevel } from "@/lib/utils";

// Violation types - matches Rust ViolationType enum
export type ViolationType =
  | "rcepattern"
  | "velocitybreach"
  | "loopdetection"
  | "exfiltrationattempt"
  | "ipaddressused";

// Action taken on the threat
export type ThreatAction = "blocked" | "logged";

// Airlock mode
export type AirlockMode = "shadow" | "enforce";

// Threat record from database
export interface Threat {
  id: string;
  run_id: string;
  step_id?: string;
  tool_name: string;
  risk_score: number;
  risk_level: RiskLevel;
  violation_type: ViolationType;
  violation_details?: string;
  blocked_payload?: Record<string, unknown>;
  action: ThreatAction;
  shadow_mode: boolean;
  project_id?: string;
  tenant_id?: string;
  created_at: string;
}

// Airlock response from check-tool endpoint
export interface AirlockCheckResponse {
  allowed: boolean;
  requires_approval: boolean;
  decision_id: string;
  reason: string;
  risk_score: number;
  risk_level: RiskLevel;
  violation_type?: ViolationType;
  violation_details?: string;
  blocked_by_airlock: boolean;
  shadow_mode: boolean;
}

// Security violation attached to a step
export interface StepSecurityViolation {
  risk_score: number;
  risk_level: RiskLevel;
  violation_type: ViolationType;
  violation_details?: string;
}

// Threat list response
export interface ThreatsResponse {
  threats: Threat[];
  total: number;
  offset: number;
  limit: number;
}

// Threats query params
export interface ThreatsParams {
  limit?: number;
  offset?: number;
  run_id?: string;
  risk_level?: RiskLevel;
  violation_type?: ViolationType;
  action?: ThreatAction;
  created_after?: string;
  created_before?: string;
}

// Threat summary for a run
export interface ThreatSummary {
  total_threats: number;
  blocked_count: number;
  logged_count: number;
  highest_risk_level?: RiskLevel;
  violation_types: ViolationType[];
}

// Airlock configuration - matches Rust AirlockConfigResponse
export interface AirlockConfig {
  mode: AirlockMode;
  rce_detection_enabled: boolean;
  velocity_tracking_enabled: boolean;
  exfiltration_shield_enabled: boolean;
  max_cost_cents_per_window: number;
  velocity_window_seconds: number;
  loop_threshold: number;
  allowed_domains: string[];
  block_ip_addresses: boolean;
}

// Airlock settings update request
export interface AirlockConfigUpdate {
  mode?: AirlockMode;
}

// Helper to get human-readable violation type
export function getViolationTypeLabel(type: ViolationType): string {
  switch (type) {
    case "rcepattern":
      return "RCE Pattern";
    case "velocitybreach":
      return "Velocity Breach";
    case "loopdetection":
      return "Loop Detection";
    case "exfiltrationattempt":
      return "Exfiltration Attempt";
    case "ipaddressused":
      return "IP Address Used";
    default:
      return type;
  }
}

// Helper to get risk level color class
export function getRiskLevelColor(level: RiskLevel): string {
  switch (level) {
    case "critical":
      return "text-red-500";
    case "high":
      return "text-orange-500";
    case "medium":
      return "text-yellow-500";
    case "low":
      return "text-blue-500";
    default:
      return "text-muted-foreground";
  }
}

// Helper to get risk level background color class
export function getRiskLevelBgColor(level: RiskLevel): string {
  switch (level) {
    case "critical":
      return "bg-red-500/10 border-red-500/30";
    case "high":
      return "bg-orange-500/10 border-orange-500/30";
    case "medium":
      return "bg-yellow-500/10 border-yellow-500/30";
    case "low":
      return "bg-blue-500/10 border-blue-500/30";
    default:
      return "bg-muted/10";
  }
}
